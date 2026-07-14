import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClaudeRunner } from './claude-runner.js'
import { createCollaborationDispatcher } from './dispatcher.js'
import { createCollaborationProcessManager } from './process-manager.js'

const REQUIRED_HELP = ['--print', '--model', '--effort', '--permission-mode', '--output-format', '--allowedTools', '--disallowedTools', '--setting-sources']

export function createLiveCollaborationDispatch({ repositoryRoot, taskStore, worktreeManager, enabled = false, environment = process.env, workerContract = null } = {}) {
  if (!enabled) return { enabled: false, reason: 'OWNER_OPT_IN_REQUIRED', dispatcher: null }
  if (worktreeManager?.available === false || !worktreeManager?.repositoryRoot) return { enabled: false, reason: 'COLLABORATION_WORKTREE_UNAVAILABLE', dispatcher: null }
  try {
    const configured = String(environment.ACC_CLAUDE_PATH || '').trim()
    const discovered = configured || execFileSync('/usr/bin/which', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const claudePath = fs.realpathSync(discovered)
    const version = execFileSync(claudePath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (!/^2\.1\.207(?:\s|$)/.test(version)) throw Object.assign(new Error('the reviewed Claude Code 2.1.207 build is required'), { code: 'COLLABORATION_CLAUDE_VERSION_MISMATCH' })
    const help = execFileSync(claudePath, ['--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 2 * 1024 * 1024 })
    const missing = REQUIRED_HELP.filter(flag => !help.includes(flag))
    if (missing.length || !help.includes('stream-json') || !help.includes('fable')) throw Object.assign(new Error('installed Claude capability surface does not match the reviewed dispatcher contract'), { code: 'COLLABORATION_CLAUDE_CAPABILITY_MISMATCH' })
    const flags = Object.fromEntries(['print', 'model', 'effort', 'permissionMode', 'outputFormat', 'verbose', 'allowedTools', 'disallowedTools', 'settingSources', 'fallbackModel', 'jsonSchema', 'strictMcpConfig', 'mcpConfig'].map(key => [key, true]))
    const processManager = createCollaborationProcessManager({ repositoryRoot, allowedExecutables: [claudePath] })
    const runner = createClaudeRunner({
      repositoryRoot, claudePath, processManager,
      capabilityProfile: { version: '2.1.207', flags },
      workerContract: workerContract || fs.readFileSync(path.join(repositoryRoot, 'scripts', 'collaboration', 'claude-worker-contract.md'), 'utf8'),
    })
    return { enabled: true, reason: null, version, dispatcher: createCollaborationDispatcher({ taskStore, worktreeManager, runner }) }
  } catch (error) {
    return { enabled: false, reason: error.code || 'COLLABORATION_CLAUDE_UNAVAILABLE', dispatcher: null }
  }
}
