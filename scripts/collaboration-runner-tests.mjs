import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createClaudeRunner, buildClaudeArgv } from '../server/collaboration/claude-runner.js'
import { createCollaborationProcessManager } from '../server/collaboration/process-manager.js'

const root = fs.realpathSync(new URL('..', import.meta.url).pathname)
const fixture = fs.realpathSync(new URL('./fixtures/collaboration-runner/fixture-claude.mjs', import.meta.url).pathname)
fs.chmodSync(fixture, 0o700)

const profile = {
  version: '2.1.207',
  flags: { print: true, model: true, fallbackModel: true, effort: true, permissionMode: true, outputFormat: true, verbose: true, jsonSchema: true, allowedTools: true, disallowedTools: true, settingSources: true, strictMcpConfig: true, mcpConfig: true },
}
const schema = JSON.parse(fs.readFileSync(new URL('../server/collaboration/result-schema.json', import.meta.url), 'utf8'))
assert.equal(schema.$schema, undefined)
const readOnlyTask = (taskId = 'runner-success', overrides = {}) => ({
  schemaVersion: 1, taskId, title: 'Review fixture safely', status: 'QUEUED', phase: 'PHASE C', priority: 50,
  createdBy: 'codex', assignedWorker: 'claude-fable', taskType: 'READ_ONLY_AUDIT',
  objective: 'Inspect one fixture and return a structured read-only result.', background: 'Do not modify any repository files.',
  acceptanceCriteria: ['Return one normalized result.'], filesAllowed: [], filesForbidden: ['data/**'], readOnlyContextFiles: ['docs/MASTER_PLAN.md'], dependencies: [], requiredTests: ['fixture'],
  permissionProfile: 'READ_ONLY_ADVISOR', modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' },
  maxTurns: 12, timeoutSeconds: 30, allowSubagents: false, allowNetwork: false, requiresCommit: false,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: false, risks: true }, ...overrides,
})
const implementationTask = taskId => ({ ...readOnlyTask(taskId), taskType: 'IMPLEMENTATION', permissionProfile: 'WORKTREE_IMPLEMENTATION', filesAllowed: ['web/src/components/Pilot/**'], requiresCommit: true, expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true } })
const manager = () => createCollaborationProcessManager({ repositoryRoot: root, allowedExecutables: [fixture] })
const runner = options => createClaudeRunner({ repositoryRoot: root, claudePath: fixture, processManager: manager(), capabilityProfile: profile, workerContract: 'FIXTURE CONTRACT', resultSchema: schema, ...options })

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== Claude runner capability contract ==')

await test('builds exact supported 2.1.207 read-only argv and omits unsupported flags', () => {
  const args = buildClaudeArgv({ taskPacket: readOnlyTask(), capabilityProfile: profile, resultSchema: schema })
  assert.deepEqual(args.slice(0, 13), ['--print', '--model', 'fable', '--fallback-model', 'sonnet', '--effort', 'max', '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose', '--json-schema'])
  assert.equal(args[13], JSON.stringify(schema))
  assert.deepEqual(args.slice(14), ['--allowedTools', 'Read', 'Grep', 'Glob', '--disallowedTools', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'Edit', 'Write', 'Bash', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'])
  assert(!args.includes('--max-turns'))
  assert(!args.includes('--append-system-prompt-file'))
  assert(!args.includes('--append-subagent-system-prompt'))
})

await test('makes model fallback and implementation permissions explicit', () => {
  const args = buildClaudeArgv({ taskPacket: implementationTask('runner-implementation'), capabilityProfile: profile, resultSchema: schema })
  assert.equal(args[args.indexOf('--model') + 1], 'fable')
  assert.equal(args[args.indexOf('--fallback-model') + 1], 'sonnet')
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits')
  assert(args.includes('Edit')); assert(args.includes('Bash(git status:*)')); assert(args.includes('Bash(git commit:*)')); assert(!args.includes('Bash(git:*)')); assert(!args.includes('--max-turns'))
  assert(args.includes('Agent')); assert(args.includes('Task'))
})

await test('rejects subagent-enabled packets until recursion limits are enforced', () => {
  assert.throws(() => buildClaudeArgv({ taskPacket: readOnlyTask('runner-subagents', { allowSubagents: true }), capabilityProfile: profile, resultSchema: schema }), /subagents are disabled/)
})

await test('refuses implementation execution without verified caller worktree metadata', async () => {
  await assert.rejects(() => runner().run(implementationTask('runner-implementation')), error => error.code === 'COLLABORATION_WORKTREE_REQUIRED')
})

console.log('\n== fixture-only runner behavior ==')

await test('runs fixture CLI through stdin and parses a normalized result', async () => {
  const result = await runner().run(readOnlyTask())
  assert.equal(result.result.status, 'COMPLETED')
  assert.equal(result.requestedModel, 'fable')
  assert.equal(result.actualModel, 'claude-fable-5')
  assert.equal(result.fallbackUsed, false)
  assert.equal(result.fallbackModel, 'sonnet')
  assert.equal(result.process.state, 'COMPLETED')
})

await test('fails closed when the event stream reports an unapproved model', async () => {
  const task = readOnlyTask('runner-unapproved-model', { modelPolicy: { primary: 'fable', fallback: null, effort: 'max' } })
  await assert.rejects(() => runner().run(task), error => error.code === 'MODEL_FALLBACK_REJECTED')
})

await test('cancels an owned process when the dispatcher timeout fires', async () => {
  const timers = new Set()
  const setTimer = callback => { const timer = setTimeout(callback, 20); timers.add(timer); return timer }
  const clearTimer = timer => { clearTimeout(timer); timers.delete(timer) }
  await assert.rejects(() => runner({ setTimer, clearTimer }).run(readOnlyTask('runner-timeout')), error => error.code === 'COLLABORATION_WORKER_TIMEOUT' && error.process.state === 'CANCELLED')
  for (const timer of timers) clearTimeout(timer)
})

await test('escalates timeout cancellation to SIGKILL when a fixture ignores SIGTERM', async () => {
  const timers = new Set()
  let timerCount = 0
  const setTimer = callback => { const timer = setTimeout(callback, timerCount++ === 0 ? 100 : 20); timers.add(timer); return timer }
  const clearTimer = timer => { clearTimeout(timer); timers.delete(timer) }
  await assert.rejects(() => runner({ setTimer, clearTimer, killEscalationMs: 100 }).run(readOnlyTask('runner-timeout-ignore')), error => error.code === 'COLLABORATION_WORKER_TIMEOUT' && error.process.state === 'CANCELLED' && error.process.signal === 'SIGKILL')
  for (const timer of timers) clearTimeout(timer)
})

await test('rejects malformed stream output with structured failure evidence', async () => {
  await assert.rejects(() => runner().run(readOnlyTask('runner-malformed')), error => error.code === 'MALFORMED_WORKER_OUTPUT' && error.output.totalBytes > 0)
})

await test('classifies authentication and capacity failures independently', async () => {
  await assert.rejects(() => runner().run(readOnlyTask('runner-auth')), error => error.code === 'AUTH_REQUIRED')
  await assert.rejects(() => runner().run(readOnlyTask('runner-capacity')), error => error.code === 'RATE_LIMITED')
})

await test('bounds retained and private-sink output while preserving the final result', async () => {
  let sinkBytes = 0
  const privateSink = { write: event => { sinkBytes += Buffer.byteLength(event.chunk) } }
  const result = await runner({ maxOutputBytes: 4_096, privateSink }).run(readOnlyTask('runner-bounded'))
  assert.equal(result.output.truncated, true)
  assert(result.output.totalBytes > 20_000)
  assert(sinkBytes <= 4_096)
  assert.equal(result.result.status, 'COMPLETED')
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
