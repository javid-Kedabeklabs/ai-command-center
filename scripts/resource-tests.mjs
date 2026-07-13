import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ResourceCoordinator, normalizeResourcePolicy, resourcePolicyErrors } from '../server/runtime/resources.js'
import { runDependencyGraph } from '../server/runtime/scheduler.js'

let passed = 0
async function test(name, fn) {
  await fn(); passed++; console.log(`PASS ${name}`)
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const execFileAsync = promisify(execFile)

console.log('== resource coordinator ==')

await test('normalizes safe defaults and rejects invalid limits', async () => {
  assert.deepEqual(normalizeResourcePolicy(), { maxModelCalls: 2, maxSubprocesses: 4, maxHttpRequests: 8, maxMcpCalls: 4 })
  assert.deepEqual(resourcePolicyErrors({ maxModelCalls: 0, maxSubprocesses: 33 }), [
    'workflow settings.resources.maxModelCalls must be an integer from 1 to 32',
    'workflow settings.resources.maxSubprocesses must be an integer from 1 to 32',
  ])
})

await test('enforces global and per-node bounds', async () => {
  const resources = new ResourceCoordinator({ maxModelCalls: 2 })
  let active = 0, maximum = 0, perNode = 0, perNodeMaximum = 0
  await Promise.all(Array.from({ length: 6 }, () => resources.withResource('model', { nodeId: 'map', limit: 1 }, async () => {
    active++; perNode++; maximum = Math.max(maximum, active); perNodeMaximum = Math.max(perNodeMaximum, perNode)
    await delay(10); active--; perNode--
  })))
  assert.equal(maximum, 1)
  assert.equal(perNodeMaximum, 1)
  assert.equal(resources.snapshot().active.model, 0)
})

await test('queued cancellation is prompt and does not consume a permit', async () => {
  const resources = new ResourceCoordinator({ maxSubprocesses: 1 })
  const release = await resources.acquire('subprocess', { nodeId: 'first' })
  const controller = new AbortController()
  const queued = resources.acquire('subprocess', { nodeId: 'second', signal: controller.signal })
  controller.abort(new Error('stop requested'))
  await assert.rejects(queued, error => error.name === 'AbortError')
  assert.equal(resources.snapshot().active.subprocess, 1)
  assert.equal(resources.snapshot().queued.subprocess, 0)
  release()
})

await test('failure releases a permit for the next operation', async () => {
  const resources = new ResourceCoordinator({ maxHttpRequests: 1 })
  await assert.rejects(resources.withResource('http', { nodeId: 'fail' }, async () => { throw new Error('fixture failure') }), /fixture failure/)
  const value = await resources.withResource('http', { nodeId: 'next' }, async () => 'ok')
  assert.equal(value, 'ok')
  assert.equal(resources.snapshot().active.http, 0)
})

await test('real subprocesses stay bounded and do not deadlock dependency fan-in', async () => {
  let active = 0, maximum = 0
  const resources = new ResourceCoordinator({ maxSubprocesses: 1 }, {
    onAcquire: lease => { if (lease.kind === 'subprocess') { active++; maximum = Math.max(maximum, active) } },
    onRelease: lease => { if (lease.kind === 'subprocess') active-- },
  })
  const nodes = ['in', 'a', 'b', 'out'].map(id => ({ id }))
  const edges = [{ source: 'in', target: 'a' }, { source: 'in', target: 'b' }, { source: 'a', target: 'out' }, { source: 'b', target: 'out' }]
  const completed = []
  await runDependencyGraph(nodes, edges, { parallelism: 4, execute: async id => {
    if (id === 'a' || id === 'b') await resources.withResource('subprocess', { nodeId: id }, async () => execFileAsync(process.execPath, ['-e', 'setTimeout(() => process.stdout.write("ok"), 25)']))
    completed.push(id)
  } })
  assert.equal(completed.at(-1), 'out')
  assert.deepEqual(new Set(completed.slice(1, 3)), new Set(['a', 'b']))
  assert.equal(maximum, 1)
  assert.equal(active, 0)
})

console.log(`${passed}/${passed} resource tests passed`)
