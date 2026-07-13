import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createCollaborationProcessManager } from '../server/collaboration/process-manager.js'
import { createCollaborationTaskStore } from '../server/collaboration/task-store.js'

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  PASS  ${name}`)
}

const tempRepository = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-collaboration-'))
  fs.mkdirSync(path.join(root, 'state'), { recursive: true })
  return root
}

const packet = (taskId = 'claude-state-pilot', overrides = {}) => ({
  schemaVersion: 1,
  taskId,
  title: 'Persist collaboration task',
  status: 'QUEUED',
  phase: 'PHASE B',
  priority: 50,
  createdBy: 'codex',
  assignedWorker: 'claude-fable',
  taskType: 'IMPLEMENTATION',
  objective: 'Implement one bounded collaboration persistence capability.',
  background: 'Remain inside the declared files and preserve repository safety.',
  acceptanceCriteria: ['Task state survives a process restart.'],
  filesAllowed: ['server/collaboration/**'],
  filesForbidden: ['data/**'],
  readOnlyContextFiles: ['docs/MASTER_PLAN.md'],
  dependencies: [],
  requiredTests: ['node scripts/collaboration-state-tests.mjs'],
  permissionProfile: 'WORKTREE_IMPLEMENTATION',
  modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' },
  maxTurns: 20,
  timeoutSeconds: 600,
  allowSubagents: false,
  allowNetwork: false,
  requiresCommit: true,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
  ...overrides,
})

console.log('== collaboration task persistence ==')

await test('constrains the state root to the configured repository', async () => {
  const root = tempRepository()
  assert.throws(() => createCollaborationTaskStore({ repositoryRoot: root, storeRoot: path.join(root, '..', 'outside') }), error => error.code === 'COLLABORATION_PATH_OUTSIDE_REPOSITORY')
  fs.rmSync(root, { recursive: true, force: true })
})

await test('creates a stable index and moves records through valid state directories', async () => {
  const root = tempRepository(), storeRoot = path.join(root, 'state', 'collaboration')
  let tick = 1_000
  const store = createCollaborationTaskStore({ repositoryRoot: root, storeRoot, now: () => ++tick })
  await store.initialize()
  const created = await store.createTask(packet())
  assert.equal(created.duplicate, false)
  assert(fs.existsSync(path.join(storeRoot, 'queue', 'claude-state-pilot.json')))
  const claimed = await store.claimTask('claude-state-pilot', { dispatchId: 'dispatch-one', workerId: 'claude', pid: 123, processGroup: 123 })
  assert.equal(claimed.duplicate, false)
  assert(fs.existsSync(path.join(storeRoot, 'running', 'claude-state-pilot.json')))
  const completed = await store.transitionTask('claude-state-pilot', 'COMPLETED', { evidence: { summary: 'passed' } })
  assert.equal(completed.status, 'COMPLETED')
  assert(fs.existsSync(path.join(storeRoot, 'completed', 'claude-state-pilot.json')))
  const index = JSON.parse(fs.readFileSync(path.join(storeRoot, 'task-index.json'), 'utf8'))
  assert.equal(index.schemaVersion, 1)
  assert.equal(index.tasks['claude-state-pilot'].relativePath, 'completed/claude-state-pilot.json')
  assert.throws(() => fs.accessSync(path.join(storeRoot, 'running', 'claude-state-pilot.json')))
  fs.rmSync(root, { recursive: true, force: true })
})

await test('prevents duplicate creation and duplicate dispatch atomically', async () => {
  const root = tempRepository(), store = createCollaborationTaskStore({ repositoryRoot: root })
  const creations = await Promise.all([store.createTask(packet()), store.createTask(packet())])
  assert.equal(creations.filter(item => !item.duplicate).length, 1)
  const claims = await Promise.all([
    store.claimTask('claude-state-pilot', { dispatchId: 'dispatch-one' }),
    store.claimTask('claude-state-pilot', { dispatchId: 'dispatch-two' }),
  ])
  assert.equal(claims.filter(item => !item.duplicate).length, 1)
  assert.equal((await store.getTask('claude-state-pilot')).dispatch.dispatchId, 'dispatch-one')
  fs.rmSync(root, { recursive: true, force: true })
})

await test('rejects invalid terminal transitions', async () => {
  const root = tempRepository(), store = createCollaborationTaskStore({ repositoryRoot: root })
  await store.createTask(packet())
  await store.claimTask('claude-state-pilot', { dispatchId: 'dispatch-one' })
  await store.transitionTask('claude-state-pilot', 'COMPLETED')
  await assert.rejects(() => store.transitionTask('claude-state-pilot', 'RUNNING'), error => error.code === 'COLLABORATION_INVALID_TRANSITION')
  fs.rmSync(root, { recursive: true, force: true })
})

await test('restart recovery blocks orphaned RUNNING tasks with failed-safe evidence and never respawns', async () => {
  const root = tempRepository(), storeRoot = path.join(root, 'state', 'collaboration')
  const first = createCollaborationTaskStore({ repositoryRoot: root, storeRoot })
  await first.createTask(packet())
  await first.claimTask('claude-state-pilot', { dispatchId: 'dispatch-one', pid: 999_999, processGroup: 999_999 })
  const second = createCollaborationTaskStore({ repositoryRoot: root, storeRoot })
  const initialized = await second.initialize()
  assert.deepEqual(initialized.recovered, ['claude-state-pilot'])
  const recovered = await second.getTask('claude-state-pilot')
  assert.equal(recovered.status, 'BLOCKED')
  assert.equal(recovered.recovery.status, 'FAILED_SAFELY')
  assert.equal(recovered.recovery.reason, 'ORPHANED_AFTER_RESTART')
  assert(fs.existsSync(path.join(storeRoot, 'blocked', 'claude-state-pilot.json')))
  fs.rmSync(root, { recursive: true, force: true })
})

await test('corrupt state disables the store and fails closed', async () => {
  const root = tempRepository(), storeRoot = path.join(root, 'state', 'collaboration')
  fs.mkdirSync(storeRoot, { recursive: true })
  fs.writeFileSync(path.join(storeRoot, 'task-index.json'), '{not-json', { mode: 0o600 })
  const store = createCollaborationTaskStore({ repositoryRoot: root, storeRoot })
  await assert.rejects(() => store.initialize(), error => error.code === 'COLLABORATION_STORE_CORRUPT')
  await assert.rejects(() => store.createTask(packet()), error => error.code === 'COLLABORATION_STORE_CORRUPT')
  assert.equal(store.status().enabled, false)
  fs.rmSync(root, { recursive: true, force: true })
})

await test('unindexed partial-write records fail closed after restart', async () => {
  const root = tempRepository(), storeRoot = path.join(root, 'state', 'collaboration')
  const first = createCollaborationTaskStore({ repositoryRoot: root, storeRoot })
  await first.initialize()
  fs.writeFileSync(path.join(storeRoot, 'queue', 'orphan-task.json'), '{}\n', { mode: 0o600 })
  const restarted = createCollaborationTaskStore({ repositoryRoot: root, storeRoot })
  await assert.rejects(() => restarted.initialize(), error => error.code === 'COLLABORATION_STORE_CORRUPT' && /unindexed/.test(error.message))
  fs.rmSync(root, { recursive: true, force: true })
})

await test('redacts and bounds stored evidence without persisting environment or authentication values', async () => {
  const root = tempRepository(), store = createCollaborationTaskStore({ repositoryRoot: root })
  await store.createTask(packet(), { authorization: 'Bearer raw-auth-value', message: `token=raw-token ${'x'.repeat(20_000)}`, env: { API_KEY: 'raw-key' } })
  const stored = JSON.stringify(await store.getTask('claude-state-pilot'))
  assert(!stored.includes('raw-auth-value'))
  assert(!stored.includes('raw-token'))
  assert(!stored.includes('raw-key'))
  assert(stored.length < 30_000)
  fs.rmSync(root, { recursive: true, force: true })
})

console.log('\n== owned collaboration processes ==')

await test('cancels only a registered owned fixture process and records its lifecycle', async () => {
  let tick = 5_000
  const root = tempRepository()
  const manager = createCollaborationProcessManager({ repositoryRoot: root, allowedExecutables: [process.execPath], now: () => ++tick })
  const fixture = new URL('./fixtures/collaboration-state/wait-for-signal.mjs', import.meta.url)
  const { child, record } = manager.spawnOwned({ taskId: 'fixture-worker', command: process.execPath, args: [fixture.pathname], cwd: root })
  assert(record.pid > 0)
  assert.equal(record.state, 'RUNNING')
  assert.throws(() => manager.cancelOwned('unknown-worker', { pid: child.pid }), error => error.code === 'COLLABORATION_PROCESS_NOT_OWNED')
  assert.throws(() => manager.cancelOwned('fixture-worker', { pid: child.pid + 1 }), error => error.code === 'COLLABORATION_PROCESS_NOT_OWNED')
  manager.cancelOwned('fixture-worker', { pid: child.pid })
  await once(child, 'close')
  const final = manager.get('fixture-worker')
  assert.equal(final.state, 'CANCELLED')
  assert(final.endedAt >= final.startedAt)
  assert.equal(final.executable, path.basename(process.execPath))
  assert(!JSON.stringify(final).includes(fixture.pathname))
  fs.rmSync(root, { recursive: true, force: true })
})

await test('constrains cwd, executable, environment, and stored process evidence', async () => {
  const root = tempRepository()
  const manager = createCollaborationProcessManager({ repositoryRoot: root, allowedExecutables: [process.execPath] })
  assert.throws(() => manager.spawnOwned({ taskId: 'outside-cwd', command: process.execPath, args: ['-e', '0'], cwd: os.tmpdir() }), error => error.code === 'COLLABORATION_PATH_OUTSIDE_REPOSITORY')
  assert.throws(() => manager.spawnOwned({ taskId: 'wrong-command', command: '/bin/echo', args: ['no'], cwd: root }), error => error.code === 'COLLABORATION_EXECUTABLE_DENIED')
  const { child } = manager.spawnOwned({
    taskId: 'secret-fixture',
    command: process.execPath,
    args: ['-e', 'if (!process.env.USER || !process.env.LOGNAME || !process.env.SHELL || process.env.API_KEY) process.exit(2); setTimeout(() => {}, 10000)', 'token=do-not-store'],
    cwd: root,
    env: { ...process.env, API_KEY: 'do-not-store' },
  })
  const running = JSON.stringify(manager.get('secret-fixture'))
  assert(!running.includes('do-not-store'))
  assert(!running.includes('setTimeout'))
  manager.cancelOwned('secret-fixture', { pid: child.pid })
  await once(child, 'close')
  fs.rmSync(root, { recursive: true, force: true })
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
