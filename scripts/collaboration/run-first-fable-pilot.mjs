#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClaudeRunner } from '../../server/collaboration/claude-runner.js'
import { createCollaborationProcessManager } from '../../server/collaboration/process-manager.js'
import { createWorktreeManager } from '../../server/collaboration/worktree-manager.js'

const root = fs.realpathSync(path.resolve(new URL('../..', import.meta.url).pathname))
const claude = fs.realpathSync(execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim())
const task = {
  schemaVersion: 1,
  taskId: 'fable-group-tests-pilot-001',
  title: 'Harden workflow group helper tests',
  status: 'QUEUED',
  phase: 'FACTORY-PILOT',
  priority: 60,
  createdBy: 'codex',
  assignedWorker: 'claude-fable',
  taskType: 'TEST_CREATION',
  objective: 'Add deterministic adversarial tests for workflow hierarchy helpers without changing production code.',
  background: 'This is the first modifying Fable pilot. Exercise existing hierarchy helper behavior at malformed ancestry, invalid destination, immutability, and absolute-position boundaries. Keep the patch test-only and consistent with the current helper contract.',
  acceptanceCriteria: [
    'Tests cover a missing or non-group reparent destination and assert the existing actionable rejection.',
    'Tests prove cyclic or missing ancestry terminates deterministically without mutating the fixture.',
    'Tests prove reparenting preserves the input array and absolute canvas positions.',
    'Only scripts/group-ui-helper-tests.mjs changes and all required tests pass.',
  ],
  filesAllowed: ['scripts/group-ui-helper-tests.mjs'],
  filesForbidden: ['server/**', 'web/**', 'docs/**', 'data/**', 'state/**', 'package.json', 'package-lock.json'],
  readOnlyContextFiles: ['web/src/workflowGroupHelpers.ts'],
  dependencies: [],
  requiredTests: ['node scripts/group-ui-helper-tests.mjs', 'npm run build'],
  permissionProfile: 'WORKTREE_IMPLEMENTATION',
  modelPolicy: { primary: 'fable', fallback: null, effort: 'high' },
  maxTurns: 12,
  timeoutSeconds: 600,
  allowSubagents: false,
  allowNetwork: false,
  requiresCommit: true,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
}
const profile = {
  version: '2.1.207',
  flags: { print: true, model: true, fallbackModel: true, effort: true, permissionMode: true, outputFormat: true, verbose: true, jsonSchema: true, allowedTools: true, disallowedTools: true, settingSources: true, strictMcpConfig: true, mcpConfig: true },
}

const manager = createWorktreeManager({ repositoryRoot: root })
const baseSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const worktree = manager.create({ taskId: task.taskId, baseSha, branchName: `claude/${task.taskId}`, refuseDirtyPrimary: false, requireHeadBase: true })
const processes = createCollaborationProcessManager({ repositoryRoot: root, allowedExecutables: [claude] })
const runner = createClaudeRunner({
  repositoryRoot: root,
  claudePath: claude,
  processManager: processes,
  capabilityProfile: profile,
  workerContract: fs.readFileSync(path.join(root, 'scripts/collaboration/claude-worker-contract.md'), 'utf8'),
})

try {
  const result = await runner.run(task, { worktree: { ...worktree, verified: true } })
  const inspection = manager.inspect(task.taskId, { taskPacket: task, requireCommit: true })
  if (result.result.commitSha !== inspection.headSha && !inspection.headSha.startsWith(result.result.commitSha)) throw Object.assign(new Error('Claude-reported commit SHA does not match inspected worktree HEAD'), { code: 'COLLABORATION_COMMIT_MISMATCH' })
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), task, result: { ...result, events: undefined }, inspection }
  const output = path.join(root, 'logs/collaboration/claude', `${task.taskId}.json`)
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ status: 'PILOT_READY_FOR_CODEX_REVIEW', output, inspection, modelProvenance: result.modelProvenance }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'FAILED_SAFELY', code: error.code || 'PILOT_FAILED', message: error.message, worktree }, null, 2)}\n`)
  process.exitCode = 1
}
