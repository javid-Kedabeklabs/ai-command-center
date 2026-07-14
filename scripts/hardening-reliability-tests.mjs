import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { atomicWriteFileSync, atomicWriteJsonSync } from '../server/storage/atomic-json.js'
import { createCheckpoint, claimNode, completeNode } from '../server/runtime/checkpoint-state.js'
import { dependencyLayers, runDependencyGraph } from '../server/runtime/scheduler.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hardening-'))
let passed = 0
const test = async (name, fn) => {
  await fn()
  passed += 1
  console.log(`  PASS  ${name}`)
}
const enospc = stage => Object.assign(new Error(`fixture disk full at ${stage}`), { code: 'ENOSPC' })
const wrappedFs = overrides => new Proxy(fs, { get(target, property) { return overrides[property] || Reflect.get(target, property) } })
const temporaryFiles = directory => fs.readdirSync(directory).filter(name => name.endsWith('.tmp'))

console.log('== enterprise hardening reliability ==')

await test('disk exhaustion before rename preserves the authoritative file and removes temporary state', () => {
  const target = path.join(root, 'before-rename.json')
  atomicWriteJsonSync(target, { revision: 1 })
  const original = fs.readFileSync(target, 'utf8')
  const fsModule = wrappedFs({
    writeFileSync(descriptor, content, options) {
      if (typeof descriptor === 'number') throw enospc('write')
      return fs.writeFileSync(descriptor, content, options)
    },
  })
  assert.throws(() => atomicWriteJsonSync(target, { revision: 2 }, { fsModule }), error => error.code === 'ENOSPC' && !error.atomicWriteCommitted)
  assert.equal(fs.readFileSync(target, 'utf8'), original)
  assert.deepEqual(temporaryFiles(root), [])
})

await test('disk exhaustion while syncing content preserves the old authoritative file', () => {
  const target = path.join(root, 'content-sync.json')
  atomicWriteJsonSync(target, { revision: 1 })
  const original = fs.readFileSync(target, 'utf8')
  let syncCalls = 0
  const fsModule = wrappedFs({ fsyncSync(descriptor) { syncCalls += 1; if (syncCalls === 1) throw enospc('content-fsync'); return fs.fsyncSync(descriptor) } })
  assert.throws(() => atomicWriteJsonSync(target, { revision: 2 }, { fsModule }), error => error.code === 'ENOSPC' && !error.atomicWriteCommitted)
  assert.equal(fs.readFileSync(target, 'utf8'), original)
  assert.deepEqual(temporaryFiles(root), [])
})

await test('failure after rename is explicitly tagged as commit-uncertain and leaves valid new JSON', () => {
  const target = path.join(root, 'directory-sync.json')
  atomicWriteJsonSync(target, { revision: 1 })
  let syncCalls = 0
  const fsModule = wrappedFs({ fsyncSync(descriptor) { syncCalls += 1; if (syncCalls === 2) throw enospc('directory-fsync'); return fs.fsyncSync(descriptor) } })
  assert.throws(() => atomicWriteJsonSync(target, { revision: 2 }, { fsModule }), error => error.code === 'ENOSPC' && error.atomicWriteCommitted === true && error.atomicWriteDurability === 'uncertain' && error.atomicWriteTarget === target)
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { revision: 2 })
  assert.deepEqual(temporaryFiles(root), [])
})

await test('sustained bounded parallel scheduling never crosses its concurrency ceiling or dependency order', async () => {
  const width = 12, rounds = 80
  const nodes = [{ id: 'start' }, ...Array.from({ length: width }, (_, index) => ({ id: `branch-${index}` })), { id: 'join' }]
  const edges = [
    ...Array.from({ length: width }, (_, index) => ({ source: 'start', target: `branch-${index}` })),
    ...Array.from({ length: width }, (_, index) => ({ source: `branch-${index}`, target: 'join' })),
  ]
  for (let round = 0; round < rounds; round += 1) {
    let active = 0, maximum = 0
    const completed = new Set()
    await runDependencyGraph(nodes, edges, { parallelism: 4, execute: async nodeId => {
      if (nodeId === 'join') assert.equal(completed.size, width + 1)
      active += 1; maximum = Math.max(maximum, active)
      await new Promise(resolve => setImmediate(resolve))
      active -= 1; completed.add(nodeId)
    } })
    assert(maximum <= 4)
    assert.equal(completed.size, nodes.length)
  }
})

await test('checkpoint transition soak remains valid and within a regression ceiling', () => {
  const started = performance.now()
  for (let run = 0; run < 250; run += 1) {
    let checkpoint = createCheckpoint({ logicalRunId: `soak-${run}`, workflowVersion: 'v1', workflowVersionHash: 'a'.repeat(64), nodeIds: ['a'], runtimeEpoch: `epoch-${run}` })
    checkpoint = claimNode(checkpoint, 'a', { inputHash: `input-${run}`, attemptId: `attempt-${run}` })
    checkpoint = completeNode(checkpoint, 'a', `attempt-${run}`, { output: `output-${run}` })
    assert.equal(checkpoint.nodes.a.state, 'succeeded')
  }
  const durationMs = performance.now() - started
  assert(durationMs < 2_500, `checkpoint transition soak exceeded 2500ms: ${durationMs.toFixed(1)}ms`)
  console.log(`    checkpoint transitions: ${durationMs.toFixed(1)}ms / 250 runs`)
})

await test('large DAG planning and repeated atomic replacement stay within measured ceilings without descriptor leaks', () => {
  const nodes = Array.from({ length: 2_000 }, (_, index) => ({ id: `node-${index}` }))
  const edges = nodes.slice(1).map((node, index) => ({ source: `node-${index}`, target: node.id }))
  let started = performance.now()
  const layers = dependencyLayers(nodes, edges)
  const planningMs = performance.now() - started
  assert.equal(layers.length, nodes.length)
  assert(planningMs < 1_500, `large DAG planning exceeded 1500ms: ${planningMs.toFixed(1)}ms`)

  const descriptorRoot = fs.existsSync('/proc/self/fd') ? '/proc/self/fd' : fs.existsSync('/dev/fd') ? '/dev/fd' : null
  const beforeDescriptors = descriptorRoot ? fs.readdirSync(descriptorRoot).length : null
  const target = path.join(root, 'replacement.json')
  started = performance.now()
  for (let revision = 0; revision < 300; revision += 1) atomicWriteFileSync(target, `${JSON.stringify({ revision, payload: 'x'.repeat(128) })}\n`, { encoding: 'utf8' })
  const writeMs = performance.now() - started
  const afterDescriptors = descriptorRoot ? fs.readdirSync(descriptorRoot).length : null
  assert(writeMs < 5_000, `atomic replacement exceeded 5000ms: ${writeMs.toFixed(1)}ms`)
  if (beforeDescriptors != null) assert(afterDescriptors <= beforeDescriptors + 2, `file descriptors grew from ${beforeDescriptors} to ${afterDescriptors}`)
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).revision, 299)
  assert.deepEqual(temporaryFiles(root), [])
  console.log(`    DAG planning: ${planningMs.toFixed(1)}ms / 2000 nodes; atomic replacement: ${writeMs.toFixed(1)}ms / 300 writes`)
})

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
