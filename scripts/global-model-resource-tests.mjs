import assert from 'node:assert/strict'
import { GlobalModelCoordinator, explicitModelBytes, globalModelPolicyFromEnv } from '../server/runtime/global-model-resources.js'

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

console.log('== global model resource coordinator ==')

await test('uses safe concurrency defaults and only explicit byte estimates', async () => {
  assert.deepEqual(globalModelPolicyFromEnv({}), { maxConcurrentCalls: 2, memoryBudgetBytes: null })
  assert.deepEqual(globalModelPolicyFromEnv({ CC_GLOBAL_MODEL_CALLS: '3', CC_GLOBAL_MODEL_MEMORY_GB: '2' }), { maxConcurrentCalls: 3, memoryBudgetBytes: 2 * 1024 ** 3 })
  assert.equal(explicitModelBytes({ estimated_memory_bytes: 1234, params_string: '30B' }), 1234)
  assert.equal(explicitModelBytes({ size_bytes: 1234, file_size_bytes: 1234, params_string: '30B', quantization: 'Q4', max_context_length: 131072 }), null)
})

await test('enforces the process-global bound across runs', async () => {
  let active = 0, peak = 0
  const coordinator = new GlobalModelCoordinator({ maxConcurrentCalls: 2 })
  await Promise.all(Array.from({ length: 6 }, (_, index) => coordinator.withModel({ runId: `run-${index}` }, async () => {
    active++; peak = Math.max(peak, active)
    await delay(4)
    active--
  })))
  assert.equal(peak, 2)
  assert.equal(coordinator.snapshot().active, 0)
})

await test('preserves fair FIFO acquisition across runs', async () => {
  const order = []
  const coordinator = new GlobalModelCoordinator({ maxConcurrentCalls: 1 })
  const calls = ['run-a', 'run-b', 'run-c'].map((runId, index) => coordinator.withModel({ runId }, async () => {
    order.push(runId)
    await delay(index === 0 ? 15 : 1)
  }))
  await Promise.all(calls)
  assert.deepEqual(order, ['run-a', 'run-b', 'run-c'])
  assert.equal(coordinator.snapshot().active, 0)
})

await test('known estimates respect the memory budget while unknown estimates use concurrency only', async () => {
  const coordinator = new GlobalModelCoordinator({ maxConcurrentCalls: 2, memoryBudgetBytes: 100 })
  const first = await coordinator.acquire({ runId: 'known-a', estimatedBytes: 70 })
  let knownAcquired = false
  const known = coordinator.withModel({ runId: 'known-b', estimatedBytes: 40 }, async () => { knownAcquired = true })
  await delay(5)
  assert.equal(knownAcquired, false)
  first()
  await known
  const unknownRelease = await coordinator.acquire({ runId: 'unknown' })
  assert.equal(coordinator.snapshot().activeUnknownEstimates, 1)
  unknownRelease()
  await assert.rejects(coordinator.acquire({ estimatedBytes: 101 }), error => error.code === 'MODEL_MEMORY_BUDGET_EXCEEDED')
})

await test('queued cancellation is prompt', async () => {
  const coordinator = new GlobalModelCoordinator({ maxConcurrentCalls: 1 })
  const release = await coordinator.acquire({ runId: 'holder' })
  const controller = new AbortController()
  const queued = coordinator.acquire({ runId: 'cancelled', signal: controller.signal })
  controller.abort(new Error('stop requested'))
  await assert.rejects(queued, error => error.name === 'AbortError')
  release()
  assert.deepEqual({ active: coordinator.snapshot().active, queued: coordinator.snapshot().queued }, { active: 0, queued: 0 })
})

await test('failure releases its lease for the next run', async () => {
  const coordinator = new GlobalModelCoordinator({ maxConcurrentCalls: 1 })
  await assert.rejects(coordinator.withModel({ runId: 'failure' }, async () => { throw new Error('fixture failure') }), /fixture failure/)
  assert.equal(await coordinator.withModel({ runId: 'next' }, async () => 'ok'), 'ok')
  assert.equal(coordinator.snapshot().active, 0)
})

await test('nests with per-run acquisition without deadlock', async () => {
  const { ResourceCoordinator } = await import('../server/runtime/resources.js')
  const global = new GlobalModelCoordinator({ maxConcurrentCalls: 1 })
  const runA = new ResourceCoordinator({ maxModelCalls: 1 })
  const runB = new ResourceCoordinator({ maxModelCalls: 1 })
  await Promise.all([runA, runB].map((local, index) => local.withResource('model', { nodeId: `node-${index}` }, () => global.withModel({ runId: `run-${index}` }, () => delay(5)))))
  assert.equal(global.snapshot().active, 0)
})

await test('shutdown cancels queued work and clears active leases', async () => {
  const global = new GlobalModelCoordinator({ maxConcurrentCalls: 1 })
  const held = await global.acquire({ runId: 'active' })
  const queued = global.acquire({ runId: 'queued' })
  global.shutdown()
  await assert.rejects(queued, error => error.name === 'AbortError')
  held()
  assert.deepEqual({ active: global.snapshot().active, queued: global.snapshot().queued }, { active: 0, queued: 0 })
})

console.log(`${passed}/${passed} global model resource tests passed`)
