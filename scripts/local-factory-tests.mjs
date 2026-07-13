import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadLocalFactoryContext } from '../server/local-factory/context-loader.js'
import { createLmStudioFactoryClient, validateLocalModelEndpoint } from '../server/local-factory/lmstudio-client.js'
import { parseLocalFactoryResult } from '../server/local-factory/result-parser.js'
import { verifyAndDeduplicateFindings } from '../server/local-factory/finding-verifier.js'
import { validateLocalFactoryTask } from '../server/local-factory/task-schema.js'
import { createLocalFactoryTaskStore } from '../server/local-factory/task-store.js'
import { LocalFactoryWorkerPool } from '../server/local-factory/worker-pool.js'

let passed = 0
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed} - ${name}`) } catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1 } }
const task = overrides => ({ schemaVersion: 1, taskId: 'factory-task-001', status: 'QUEUED', taskType: 'CODE_REVIEW', workerRole: 'REVIEWER', title: 'Review module', objective: 'Review this bounded module for correctness.', background: 'Read-only review.', contextFiles: ['src/example.js'], acceptanceCriteria: ['Return actionable findings.'], priority: 50, timeoutSeconds: 30, maxInputBytes: 100_000, maxOutputTokens: 1_024, temperature: 0.1, model: 'qwen-coder-factory', ...overrides })

await test('validates strict approved task packets', () => assert.equal(validateLocalFactoryTask(task()).model, 'qwen-coder-factory'))
await test('rejects protected context paths', () => assert.throws(() => validateLocalFactoryTask(task({ contextFiles: ['data/profiles.json'] })), /protected/))
await test('rejects unapproved models', () => assert.throws(() => validateLocalFactoryTask(task({ model: 'deepseek-r1' })), /approved/))
await test('requires a loopback LM Studio endpoint', () => {
  assert.equal(validateLocalModelEndpoint('http://127.0.0.1:1234'), 'http://127.0.0.1:1234')
  assert.throws(() => validateLocalModelEndpoint('https://example.com'), /loopback/)
})
await test('loads bounded regular repository files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-local-factory-'))
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/example.js'), 'export const value = 1\n')
  const loaded = loadLocalFactoryContext({ repositoryRoot: root, files: ['src/example.js'], maxInputBytes: 1_024 })
  assert.equal(loaded.documents[0].path, 'src/example.js')
  fs.rmSync(root, { recursive: true, force: true })
})
await test('rejects symlink context files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-local-factory-'))
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'real.js'), 'x'); fs.symlinkSync(path.join(root, 'real.js'), path.join(root, 'src/example.js'))
  assert.throws(() => loadLocalFactoryContext({ repositoryRoot: root, files: ['src/example.js'], maxInputBytes: 1_024 }), /non-symlink/)
  fs.rmSync(root, { recursive: true, force: true })
})
await test('parses and redacts structured worker results', () => {
  const content = 'const token="abc123456789"\n'
  const result = parseLocalFactoryResult('{"status":"COMPLETED","summary":"ok","findings":[{"category":"SECURITY","severity":"HIGH","confidence":0.9,"file":"src/example.js","startLine":1,"endLine":1,"symbol":null,"quote":"token=\\\"abc123456789\\\"","claim":"hard-coded token","validation":"inspect line 1"}],"proposedChanges":[],"tests":[],"risks":[],"recommendedAction":"USE_AS_ADVICE"}', { documents: [{ path: 'src/example.js', content }] })
  assert.match(JSON.stringify(result.findings[0]), /REDACTED/)
})
await test('mechanically rejects false citations and deduplicates exact evidence', () => {
  const base = { category: 'CORRECTNESS', severity: 'MEDIUM', confidence: 0.5, file: 'src/example.js', startLine: 1, endLine: 1, symbol: 'value', quote: 'export const value = 1', claim: 'review value', validation: 'run a focused test' }
  const result = verifyAndDeduplicateFindings([base, { ...base, confidence: 0.9 }, { ...base, file: 'src/missing.js' }], { documents: [{ path: 'src/example.js', content: 'export const value = 1\n' }] })
  assert.equal(result.findings.length, 1); assert.equal(result.findings[0].confidence, 0.9); assert.equal(result.findings[0].duplicateCount, 2)
  assert.deepEqual(result.telemetry, { submitted: 3, accepted: 1, rejected: 1, duplicates: 1, rejectionReasons: { FILE_NOT_IN_CONTEXT: 1 } })
})
await test('rejects a quote that exists outside the cited line range', () => {
  const finding = { category: 'TESTING', severity: 'LOW', confidence: 0.8, file: 'src/example.js', startLine: 1, endLine: 1, symbol: null, quote: 'target line', claim: 'wrong range', validation: 'inspect range' }
  const result = verifyAndDeduplicateFindings([finding], { documents: [{ path: 'src/example.js', content: 'first line\ntarget line\n' }] })
  assert.equal(result.findings.length, 0); assert.equal(result.telemetry.rejectionReasons.QUOTE_NOT_FOUND_IN_RANGE, 1)
})
await test('sends bounded non-streaming requests to the approved model', async () => {
  let request
  const client = createLmStudioFactoryClient({ fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ model: 'qwen-coder-factory', choices: [{ message: { content: '{"status":"COMPLETED","summary":"reviewed","findings":[],"proposedChanges":[],"tests":[],"risks":[],"recommendedAction":"USE_AS_ADVICE"}' } }] }) } } })
  const normalized = validateLocalFactoryTask(task({ contextFiles: [] }))
  const result = await client.run(normalized, { documents: [] })
  assert.equal(result.result.status, 'COMPLETED')
  assert.equal(JSON.parse(request.options.body).model, 'qwen-coder-factory')
})
await test('rejects oversized and malformed LM Studio responses', async () => {
  const normalized = validateLocalFactoryTask(task({ contextFiles: [] }))
  const oversized = createLmStudioFactoryClient({ fetchImpl: async () => ({ ok: true, headers: { get: () => '2000001' }, text: async () => '{}' }) })
  await assert.rejects(oversized.run(normalized, { documents: [] }), /byte limit/)
  const malformed = createLmStudioFactoryClient({ fetchImpl: async () => ({ ok: true, headers: { get: () => null }, text: async () => 'not-json' }) })
  await assert.rejects(malformed.run(normalized, { documents: [] }), /malformed/)
  const fallback = createLmStudioFactoryClient({ fetchImpl: async () => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ model: 'unexpected-model', choices: [{ message: { content: '{}' } }] }) }) })
  await assert.rejects(fallback.run(normalized, { documents: [] }), /pinned/)
})
await test('enforces concurrency and priority in the worker pool', async () => {
  const order = [], releases = []
  const pool = new LocalFactoryWorkerPool({ concurrency: 1, maxQueue: 5, runTask: async current => { order.push(current.taskId); await new Promise(resolve => releases.push(resolve)); return current.taskId } })
  const first = pool.submit(task({ taskId: 'factory-first', priority: 1 }))
  const low = pool.submit(task({ taskId: 'factory-low', priority: 1 }))
  const high = pool.submit(task({ taskId: 'factory-high', priority: 100 }))
  await new Promise(resolve => setImmediate(resolve)); releases.shift()(); await first
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, ['factory-first', 'factory-high'])
  releases.shift()(); await high; await new Promise(resolve => setImmediate(resolve)); releases.shift()(); await low
})
await test('cancels queued work and rejects duplicate task ids', async () => {
  let release
  const pool = new LocalFactoryWorkerPool({ concurrency: 1, maxQueue: 3, runTask: () => new Promise(resolve => { release = resolve }) })
  const active = pool.submit(task({ taskId: 'factory-active' }))
  const queued = pool.submit(task({ taskId: 'factory-queued' }))
  await assert.rejects(pool.submit(task({ taskId: 'factory-queued' })), /already/)
  assert.equal(pool.cancel('factory-queued'), true)
  await assert.rejects(queued, /cancelled/)
  release('done'); await active
})
await test('persists transitions and recovers orphaned running tasks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-local-factory-store-'))
  const storeRoot = path.join(root, 'state/local-factory')
  let clock = 100
  const first = createLocalFactoryTaskStore({ repositoryRoot: root, storeRoot, now: () => ++clock })
  await first.initialize(); await first.createTask(task({ contextFiles: [] })); await first.transitionTask('factory-task-001', 'RUNNING')
  const restarted = createLocalFactoryTaskStore({ repositoryRoot: root, storeRoot, now: () => ++clock })
  const recovery = await restarted.initialize()
  assert.deepEqual(recovery.recovered, ['factory-task-001'])
  assert.equal((await restarted.getTask('factory-task-001')).status, 'BLOCKED')
  await restarted.transitionTask('factory-task-001', 'QUEUED', { reason: 'REVIEWED_RETRY' })
  assert.equal((await restarted.getTask('factory-task-001')).status, 'QUEUED')
  fs.rmSync(root, { recursive: true, force: true })
})

if (!process.exitCode) console.log(`1..${passed}`)
