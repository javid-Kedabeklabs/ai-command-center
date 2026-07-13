import assert from 'node:assert/strict'
import { dependencyLayers, runDependencyGraph } from '../server/runtime/scheduler.js'

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS  ${name}`) }
const nodes = ['in','a','b','merge','out'].map(id => ({ id }))
const edges = [{ source: 'in', target: 'a' }, { source: 'in', target: 'b' }, { source: 'a', target: 'merge' }, { source: 'b', target: 'merge' }, { source: 'merge', target: 'out' }]

console.log('== dependency scheduler ==')

await test('fan-out and fan-in form deterministic dependency layers', async () => {
  assert.deepEqual(dependencyLayers(nodes, edges), [['in'], ['a','b'], ['merge'], ['out']])
})

await test('independent branches execute concurrently within the bound', async () => {
  const times = {}, started = Date.now()
  await runDependencyGraph(nodes, edges, { parallelism: 2, execute: async id => { times[id] = { start: Date.now() }; if (id === 'a' || id === 'b') await new Promise(resolve => setTimeout(resolve, 120)); times[id].end = Date.now() } })
  assert(Math.abs(times.a.start - times.b.start) < 60)
  assert(times.merge.start >= times.a.end && times.merge.start >= times.b.end)
  assert(Date.now() - started < 230)
})

await test('parallelism one remains serial', async () => {
  let active = 0, maximum = 0
  await runDependencyGraph(nodes, edges, { parallelism: 1, execute: async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active-- } })
  assert.equal(maximum, 1)
})

await test('first branch failure prevents downstream scheduling', async () => {
  const executed = []
  await assert.rejects(runDependencyGraph(nodes, edges, { parallelism: 2, execute: async id => { executed.push(id); if (id === 'a') throw new Error('branch failed') } }), /branch failed/)
  assert(!executed.includes('merge'))
})

await test('cycles are rejected', async () => {
  assert.throws(() => dependencyLayers([{ id: 'a' }, { id: 'b' }], [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]), /cycle/)
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
