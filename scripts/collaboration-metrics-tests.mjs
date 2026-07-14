import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDeliveryMetricsStore } from '../server/collaboration/delivery-metrics.js'

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-delivery-metrics-'))
const task = (taskId, clock, { worker = 'claude-fable', taskType = 'UX_IMPLEMENTATION', readOnly = false } = {}) => ({
  taskId, status: 'COMPLETED', createdAt: clock - 100_000, updatedAt: clock - 10_000,
  task: { taskId, assignedWorker: worker, taskType, permissionProfile: readOnly ? 'READ_ONLY_ADVISOR' : 'WORKTREE_IMPLEMENTATION' },
  dispatch: { startedAt: clock - 90_000 }, evidence: { dispatchReceipt: { completedAt: clock - 20_000 } },
})
const outcome = (taskId, commandId, overrides = {}) => ({
  schemaVersion: 1, commandId, taskId, outcome: 'accepted', firstPassAccepted: true,
  reviewActiveSeconds: 600, reworkActiveSeconds: 0, reworkCycles: 0, automatedGateFailures: 0,
  boundaryViolations: 0, codexBaselineSeconds: 200,
  qwenReview: { verdict: 'PASS', reviewSeconds: 60, materialFindings: 2, acceptedFindings: 1, falseBlockingFindings: 0 },
  ...overrides,
})

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS  ${name}`) }
console.log('== accepted delivery metrics ==')

await test('records one provenance-derived outcome and replays the exact command idempotently', async () => {
  const dir = root(), clock = 2_000_000, store = createDeliveryMetricsStore({ repositoryRoot: dir, now: () => clock })
  const record = task('metric-task-one', clock), input = outcome(record.taskId, 'metric-command-one')
  const first = await store.recordOutcome(input, { taskRecord: record, lease: { state: 'INTEGRATED' } })
  const replay = await store.recordOutcome(input, { taskRecord: record, lease: { state: 'INTEGRATED' } })
  assert.equal(first.duplicate, false); assert.equal(replay.duplicate, true); assert.equal(first.observation.calendarLeadSeconds, 100)
  assert.equal(first.observation.startedAt, clock - 90_000); assert.equal((await store.list()).length, 1)
  assert.equal((await createDeliveryMetricsStore({ repositoryRoot: dir, now: () => clock }).list()).length, 1)
  await assert.rejects(() => store.recordOutcome({ ...input, reviewActiveSeconds: 601 }, { taskRecord: record, lease: { state: 'INTEGRATED' } }), error => error.code === 'COLLABORATION_METRICS_COMMAND_CONFLICT')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('requires terminal task provenance and explicit modifying-work disposition', async () => {
  const dir = root(), clock = 3_000_000, store = createDeliveryMetricsStore({ repositoryRoot: dir, now: () => clock }), record = task('metric-task-two', clock)
  await assert.rejects(() => store.recordOutcome(outcome(record.taskId, 'metric-command-two'), { taskRecord: { ...record, status: 'RUNNING' }, lease: { state: 'INTEGRATED' } }), /terminal task record/)
  await assert.rejects(() => store.recordOutcome(outcome(record.taskId, 'metric-command-three'), { taskRecord: record, lease: { state: 'INACTIVE' } }), error => error.code === 'COLLABORATION_METRICS_INTEGRATION_REQUIRED')
  const rejected = outcome(record.taskId, 'metric-command-four', { outcome: 'rejected', firstPassAccepted: false })
  await assert.rejects(() => store.recordOutcome(rejected, { taskRecord: record, lease: { state: 'INTEGRATED' } }), error => error.code === 'COLLABORATION_METRICS_REJECTION_REQUIRED')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('keeps routing in shadow mode until measured thresholds pass', async () => {
  const dir = root(), clock = 4_000_000, store = createDeliveryMetricsStore({ repositoryRoot: dir, now: () => clock })
  for (let index = 0; index < 20; index++) {
    const id = `metric-sample-${String(index).padStart(2, '0')}`
    await store.recordOutcome(outcome(id, `metric-sample-command-${String(index).padStart(2, '0')}`), { taskRecord: task(id, clock), lease: { state: 'INTEGRATED' } })
  }
  const summary = await store.summary(), group = summary.byTaskClass[0]
  assert.equal(summary.mode, 'SHADOW_ONLY'); assert.equal(group.recommendation, 'ELIGIBLE_FOR_FABLE_DEFAULT_REVIEW'); assert.equal(group.automaticAuthority, false)
  assert.equal(summary.qwen.recommendation, 'ELIGIBLE_FOR_QWEN_PREFLIGHT_REVIEW'); assert.equal(summary.qwen.automaticAuthority, false)
  await store.recordDefect({ schemaVersion: 1, commandId: 'metric-defect-command', taskId: 'metric-sample-00', severity: 'S2', attributed: true })
  assert.equal((await store.summary()).byTaskClass[0].recommendation, 'INSUFFICIENT_OR_NONQUALIFYING_EVIDENCE')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('fails closed on corrupt persisted metrics', async () => {
  const dir = root(), file = path.join(dir, 'state', 'collaboration', 'delivery-metrics.json')
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{broken')
  const store = createDeliveryMetricsStore({ repositoryRoot: dir })
  assert.deepEqual(store.status(), { enabled: false, error: { code: 'COLLABORATION_METRICS_CORRUPT' } })
  assert.equal((await store.summary()).mode, 'DISABLED_CORRUPT')
  await assert.rejects(() => store.recordDefect({ schemaVersion: 1, commandId: 'corrupt-metric-command', taskId: 'corrupt-metric-task', severity: 'S1', attributed: true }), error => error.code === 'COLLABORATION_METRICS_CORRUPT')
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('rejects a metrics parent that resolves outside the repository', async () => {
  const dir = root(), outside = root()
  fs.symlinkSync(outside, path.join(dir, 'state'))
  assert.throws(() => createDeliveryMetricsStore({ repositoryRoot: dir }), /parent resolves outside/)
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true })
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
