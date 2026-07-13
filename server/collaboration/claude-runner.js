import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertClaudeModelPolicy, classifyClaudeFailure, extractNormalizedResult, redactSensitive } from './result-parser.js'
import { isReadOnlyTaskType, validateTaskPacket } from './task-schema.js'

const SUPPORTED_EFFORT = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const READ_ONLY_TOOLS = Object.freeze(['Read', 'Grep', 'Glob'])
const IMPLEMENTATION_TOOLS = Object.freeze([
  'Read', 'Grep', 'Glob', 'Edit', 'Write',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
  'Bash(git rev-parse:*)', 'Bash(git branch --show-current:*)',
  'Bash(node scripts/*-tests.mjs:*)', 'Bash(npm test:*)', 'Bash(npm run build:*)',
  'Bash(npx tsc --noEmit:*)',
])
const ALWAYS_DISALLOWED = Object.freeze(['WebFetch', 'WebSearch', 'Agent', 'Task'])
const flag = (profile, key) => profile?.flags?.[key] === true

export function validateClaudeCapabilityProfile(profile) {
  if (!profile || typeof profile !== 'object' || profile.version !== '2.1.207' || !profile.flags || typeof profile.flags !== 'object') throw new Error('a verified Claude Code 2.1.207 capability profile is required')
  for (const required of ['print', 'model', 'effort', 'permissionMode', 'outputFormat', 'verbose', 'allowedTools', 'disallowedTools', 'settingSources']) if (!flag(profile, required)) throw new Error(`Claude capability profile is missing required flag: ${required}`)
  return profile
}

export function buildClaudeArgv({ taskPacket, capabilityProfile, resultSchema, readOnly = isReadOnlyTaskType(taskPacket.taskType) }) {
  const task = validateTaskPacket(taskPacket), profile = validateClaudeCapabilityProfile(capabilityProfile)
  if (task.allowSubagents) throw new Error('Claude subagents are disabled until dispatcher depth and concurrency enforcement is implemented')
  if (!SUPPORTED_EFFORT.has(task.modelPolicy.effort)) throw new Error('unsupported Claude effort')
  const args = ['--print', '--model', task.modelPolicy.primary]
  if (task.modelPolicy.fallback && flag(profile, 'fallbackModel')) args.push('--fallback-model', task.modelPolicy.fallback)
  args.push('--effort', task.modelPolicy.effort)
  args.push('--permission-mode', readOnly ? 'plan' : 'acceptEdits')
  args.push('--output-format', 'stream-json', '--verbose')
  if (resultSchema && flag(profile, 'jsonSchema')) args.push('--json-schema', JSON.stringify(resultSchema))
  args.push('--allowedTools', ...(readOnly ? READ_ONLY_TOOLS : IMPLEMENTATION_TOOLS))
  args.push('--disallowedTools', ...ALWAYS_DISALLOWED, ...(readOnly ? ['Edit', 'Write', 'Bash'] : []))
  args.push('--setting-sources', 'project')
  if (flag(profile, 'strictMcpConfig') && flag(profile, 'mcpConfig')) args.push('--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }))
  return args
}

function verifiedImplementationWorktree(repositoryRoot, task, metadata) {
  if (!metadata || metadata.verified !== true || metadata.active !== true || metadata.taskId !== task.taskId || typeof metadata.path !== 'string' || typeof metadata.branch !== 'string' || typeof metadata.baseSha !== 'string') throw Object.assign(new Error('implementation tasks require caller-supplied verified worktree metadata'), { code: 'COLLABORATION_WORKTREE_REQUIRED' })
  const root = fs.realpathSync(path.resolve(repositoryRoot)), worktree = fs.realpathSync(path.resolve(metadata.path))
  const expectedRoot = path.join(root, '.claude', 'worktrees')
  if (!(worktree.startsWith(`${expectedRoot}${path.sep}`))) throw Object.assign(new Error('verified worktree is outside the collaboration worktree root'), { code: 'COLLABORATION_WORKTREE_REQUIRED' })
  const branch = execFileSync('git', ['-C', worktree, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (branch !== metadata.branch || !branch.includes(task.taskId)) throw Object.assign(new Error('worktree branch marker does not match the task'), { code: 'COLLABORATION_WORKTREE_REQUIRED' })
  return worktree
}

function composePrompt(contract, task) {
  const safeTask = redactSensitive(task)
  return `${String(contract || '').trim()}\n\n## Enforced iteration limits\nThe dispatcher limits this assignment to ${task.maxTurns} turns and ${task.timeoutSeconds} seconds. Stop safely before either boundary.\n\n## Validated task packet\n${JSON.stringify(safeTask, null, 2)}\n`
}

export function createClaudeRunner({ repositoryRoot, claudePath, processManager, capabilityProfile, workerContract, resultSchema = JSON.parse(fs.readFileSync(new URL('./result-schema.json', import.meta.url), 'utf8')), privateSink = null, maxOutputBytes = 256 * 1024, killEscalationMs = 5_000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!repositoryRoot || !claudePath || !processManager) throw new Error('repositoryRoot, claudePath, and processManager are required')
  validateClaudeCapabilityProfile(capabilityProfile)
  const outputLimit = Math.max(4_096, Math.min(4 * 1024 * 1024, Number(maxOutputBytes) || 256 * 1024))

  async function run(taskPacket, { worktree = null } = {}) {
    const task = validateTaskPacket(taskPacket), readOnly = isReadOnlyTaskType(task.taskType)
    const cwd = readOnly ? fs.realpathSync(path.resolve(repositoryRoot)) : verifiedImplementationWorktree(repositoryRoot, task, worktree)
    const args = buildClaudeArgv({ taskPacket: task, capabilityProfile, resultSchema, readOnly })
    const { child, record } = processManager.spawnOwned({ taskId: task.taskId, command: claudePath, args, cwd, env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', TMPDIR: process.env.TMPDIR || '', LANG: process.env.LANG || 'C', LC_ALL: process.env.LC_ALL || '' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', totalBytes = 0, sinkBytes = 0, truncated = false, timedOut = false, killTimer = null
    const capture = (stream, chunk) => {
      totalBytes += chunk.length
      const safe = String(redactSensitive(chunk.toString('utf8')))
      if (privateSink?.write && sinkBytes < outputLimit) {
        const delivered = safe.slice(0, Math.min(8_192, outputLimit - sinkBytes))
        sinkBytes += Buffer.byteLength(delivered)
        if (delivered) privateSink.write({ taskId: task.taskId, stream, chunk: delivered })
      }
      if (stream === 'stdout') stdout = `${stdout}${safe}`.slice(-outputLimit)
      else stderr = `${stderr}${safe}`.slice(-outputLimit)
      if (totalBytes > outputLimit) truncated = true
    }
    child.stdout?.on('data', chunk => capture('stdout', chunk))
    child.stderr?.on('data', chunk => capture('stderr', chunk))
    child.stdin.end(composePrompt(workerContract, task))
    const timer = setTimer(() => {
      timedOut = true
      try { processManager.cancelOwned(task.taskId, { pid: record.pid, signal: 'SIGTERM' }) } catch {}
      killTimer = setTimer(() => {
        try { processManager.cancelOwned(task.taskId, { pid: record.pid, signal: 'SIGKILL' }) } catch {}
      }, Math.max(100, Math.min(30_000, Number(killEscalationMs) || 5_000)))
      killTimer.unref?.()
    }, task.timeoutSeconds * 1_000)
    timer.unref?.()
    const completion = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
    clearTimer(timer)
    if (killTimer) clearTimer(killTimer)
    privateSink?.close?.({ taskId: task.taskId, totalBytes, truncated })
    if (timedOut) throw Object.assign(new Error('Claude worker exceeded its dispatcher-enforced timeout and was cancelled'), { code: 'COLLABORATION_WORKER_TIMEOUT', process: processManager.get(task.taskId), totalBytes, truncated })
    if (completion.code !== 0) {
      const failureClass = classifyClaudeFailure(`${stderr}\n${stdout}`)
      throw Object.assign(new Error(`Claude worker failed safely: ${failureClass}`), { code: failureClass, process: processManager.get(task.taskId), totalBytes, truncated })
    }
    try {
      const parsed = extractNormalizedResult(stdout, { requiresCommit: task.requiresCommit })
      const modelProvenance = assertClaudeModelPolicy({ requestedModel: task.modelPolicy.primary, fallbackModel: task.modelPolicy.fallback || null, events: parsed.events, requirePrimary: !task.modelPolicy.fallback })
      return { taskId: task.taskId, requestedModel: task.modelPolicy.primary, actualModel: modelProvenance.actualModel, fallbackModel: task.modelPolicy.fallback || null, fallbackUsed: modelProvenance.fallbackUsed, modelProvenance, args: [...args], result: parsed.result, events: parsed.events, malformed: parsed.malformed, output: { totalBytes, truncated }, process: processManager.get(task.taskId) }
    } catch (error) {
      error.output = { totalBytes, truncated }; error.process = processManager.get(task.taskId)
      throw error
    }
  }

  return { run }
}

export { READ_ONLY_TOOLS, IMPLEMENTATION_TOOLS, ALWAYS_DISALLOWED }
