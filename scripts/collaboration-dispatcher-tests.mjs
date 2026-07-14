import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { createClaudeRunner } from '../server/collaboration/claude-runner.js'
import { createCollaborationDispatcher } from '../server/collaboration/dispatcher.js'
import { createLiveCollaborationDispatch } from '../server/collaboration/live-dispatch.js'
import { createCollaborationProcessManager } from '../server/collaboration/process-manager.js'
import { createCollaborationTaskStore } from '../server/collaboration/task-store.js'
import { createWorktreeManager } from '../server/collaboration/worktree-manager.js'

const fixture = fs.realpathSync(new URL('./fixtures/collaboration-runner/fixture-claude.mjs', import.meta.url).pathname)
fs.chmodSync(fixture, 0o700)
const schema = JSON.parse(fs.readFileSync(new URL('../server/collaboration/result-schema.json', import.meta.url), 'utf8'))
const profile = { version: '2.1.207', flags: { print: true, model: true, fallbackModel: true, effort: true, permissionMode: true, outputFormat: true, verbose: true, jsonSchema: true, allowedTools: true, disallowedTools: true, settingSources: true, strictMcpConfig: true, mcpConfig: true } }
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const repository = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-dispatcher-'))
  fs.mkdirSync(path.join(root, 'web', 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), '.claude/worktrees/\nstate/collaboration/\n')
  fs.writeFileSync(path.join(root, 'web', 'src', 'components', '.gitkeep'), '')
  git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'base'])
  return root
}
const task = (root, taskId, readOnly = false, overrides = {}) => {
  const baseSha = git(root, ['rev-parse', 'HEAD']), contractPath = '.gitignore'
  const contractHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, contractPath))).digest('hex')
  return ({
  schemaVersion: 2, taskId, title: 'Dispatcher fixture', status: 'QUEUED', phase: 'COLLABORATION', priority: 50,
  createdBy: 'codex', assignedWorker: 'claude-fable', taskType: readOnly ? 'READ_ONLY_AUDIT' : 'IMPLEMENTATION',
  objective: readOnly ? 'Inspect the bounded fixture without changing files.' : 'Create one bounded fixture file and commit it.',
  background: 'The deterministic fixture proves dispatch receipts without consuming model capacity.', acceptanceCriteria: ['Return one provenance-bound result.'],
  filesAllowed: readOnly ? [] : ['web/src/components/Pilot/**'], filesForbidden: ['data/**'], readOnlyContextFiles: [contractPath], dependencies: [], requiredTests: ['fixture'],
  permissionProfile: readOnly ? 'READ_ONLY_ADVISOR' : 'WORKTREE_IMPLEMENTATION', modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' },
  maxTurns: 12, timeoutSeconds: 30, allowSubagents: false, allowNetwork: false, requiresCommit: !readOnly,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: !readOnly, risks: true },
  contractPack: { reviewedBaseSha: baseSha, acceptanceTestCommitSha: baseSha, contractFiles: [{ path: contractPath, sha256: contractHash }], scenarioIds: ['DISPATCH-01'], maxChangedFiles: readOnly ? 0 : 25, estimatedCodexSeconds: 3600, stopConditions: ['Stop outside the leased paths.', 'Stop when a frozen contract changes.', 'Stop rather than weaken acceptance tests.'] },
  ...overrides,
}) }
const harness = root => {
  const taskStore = createCollaborationTaskStore({ repositoryRoot: root })
  const worktreeManager = createWorktreeManager({ repositoryRoot: root })
  const processManager = createCollaborationProcessManager({ repositoryRoot: root, allowedExecutables: [fixture] })
  const runner = createClaudeRunner({ repositoryRoot: root, claudePath: fixture, processManager, capabilityProfile: profile, workerContract: 'FIXTURE CONTRACT', resultSchema: schema })
  const dispatcher = createCollaborationDispatcher({ taskStore, worktreeManager, runner, randomId: () => 'fixed-dispatch' })
  return { taskStore, worktreeManager, processManager, dispatcher }
}
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== collaboration dispatcher receipts ==')
await test('requires explicit host opt-in and an exact reviewed Claude capability surface', async () => {
  const root = repository(), h = harness(root)
  const disabled = createLiveCollaborationDispatch({ repositoryRoot: root, taskStore: h.taskStore, worktreeManager: h.worktreeManager })
  assert.equal(disabled.enabled, false); assert.equal(disabled.reason, 'OWNER_OPT_IN_REQUIRED')
  const enabled = createLiveCollaborationDispatch({ repositoryRoot: root, taskStore: h.taskStore, worktreeManager: h.worktreeManager, enabled: true, environment: { ACC_CLAUDE_PATH: fixture }, workerContract: 'FIXTURE CONTRACT' })
  assert.equal(enabled.enabled, true); assert.match(enabled.version, /^2\.1\.207/); assert(enabled.dispatcher)
  fs.rmSync(root, { recursive: true, force: true })
})
await test('binds a modifying task, lease, owned process, model, commit inspection, and terminal receipt', async () => {
  const root = repository(), h = harness(root), packet = task(root, 'dispatcher-implementation')
  await h.taskStore.createTask(packet)
  const receipt = await h.dispatcher.dispatch(packet.taskId, { baseSha: git(root, ['rev-parse', 'HEAD']) })
  assert.equal(receipt.status, 'COMPLETED'); assert.equal(receipt.actualModel, 'claude-fable-5'); assert.equal(receipt.fallbackUsed, false)
  assert.equal(receipt.process.state, 'COMPLETED'); assert.equal(receipt.inspection.commitCount, 1); assert.deepEqual(receipt.inspection.filesChanged, ['web/src/components/Pilot/fixture.txt'])
  assert.equal(receipt.lease.state, 'ACTIVE'); assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/)
  assert.equal(Object.hasOwn(receipt.lease, 'path'), false); assert.equal(Object.hasOwn(receipt.inspection, 'path'), false)
  const stored = await h.taskStore.getTask(packet.taskId)
  assert.equal(stored.status, 'COMPLETED'); assert.equal(stored.dispatch.dispatchId, receipt.dispatchId); assert(stored.dispatch.pid > 0)
  assert.equal(stored.evidence.dispatchReceipt.receiptSha256, receipt.receiptSha256)
  assert.equal(h.worktreeManager.get(packet.taskId).state, 'INACTIVE')
  await assert.rejects(() => h.dispatcher.dispatch(packet.taskId, { baseSha: git(root, ['rev-parse', 'HEAD']) }), /cannot dispatch from COMPLETED/)
  h.worktreeManager.cleanup(packet.taskId, { rejected: true }); fs.rmSync(root, { recursive: true, force: true })
})

await test('records model capacity failure as blocked and never leaves a running task', async () => {
  const root = repository(), h = harness(root), packet = task(root, 'runner-auth', true)
  await h.taskStore.createTask(packet)
  await assert.rejects(() => h.dispatcher.dispatch(packet.taskId, { baseSha: packet.contractPack.reviewedBaseSha }), error => error.code === 'AUTH_REQUIRED' && error.dispatchReceipt.status === 'BLOCKED')
  const stored = await h.taskStore.getTask(packet.taskId)
  assert.equal(stored.status, 'BLOCKED'); assert.equal(stored.evidence.dispatchReceipt.code, 'AUTH_REQUIRED'); assert(stored.dispatch.pid > 0)
  fs.rmSync(root, { recursive: true, force: true })
})

await test('fails before reservation when a modifying dispatch lacks a reviewed base', async () => {
  const root = repository(), h = harness(root), packet = task(root, 'missing-reviewed-base')
  await h.taskStore.createTask(packet)
  await assert.rejects(() => h.dispatcher.dispatch(packet.taskId), error => error.code === 'COLLABORATION_BASE_REQUIRED')
  assert.equal((await h.taskStore.getTask(packet.taskId)).status, 'QUEUED')
  assert.equal(h.worktreeManager.list().length, 0); fs.rmSync(root, { recursive: true, force: true })
})

await test('rejects unreviewed primary source changes before a read-only task is claimed', async () => {
  const root = repository(), h = harness(root), packet = task(root, 'dirty-read-only', true)
  await h.taskStore.createTask(packet)
  fs.writeFileSync(path.join(root, 'unreviewed.txt'), 'unreviewed\n')
  await assert.rejects(() => h.dispatcher.dispatch(packet.taskId, { baseSha: packet.contractPack.reviewedBaseSha }), error => error.code === 'COLLABORATION_DIRTY_PRIMARY')
  assert.equal((await h.taskStore.getTask(packet.taskId)).status, 'QUEUED')
  fs.rmSync(root, { recursive: true, force: true })
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
