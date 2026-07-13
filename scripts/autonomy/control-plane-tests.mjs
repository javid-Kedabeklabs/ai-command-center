import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blockerFingerprint, createAutonomyControlPlane } from '../../server/autonomy/control-plane.js'
import { createHostOperationStore, validateHostOperationRequest } from '../../server/autonomy/host-operation-store.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
const fixture = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-control-')); fs.mkdirSync(path.join(root, 'state')); return root }

console.log('== Autonomy control plane ==')
await test('blocker fingerprints are stable and omit transient prose metadata', () => {
  const base = { taskId: 'phase-5t-c', blockerClass: 'HOST_CAPABILITY', operation: 'service.reload', resource: 'command-center', baseSha: 'abc', environment: 'sandbox' }
  assert.equal(blockerFingerprint(base), blockerFingerprint({ ...base }))
  assert.notEqual(blockerFingerprint(base), blockerFingerprint({ ...base, operation: 'backup.create' }))
})
await test('host blocker is persisted and immediately prevents ordinary continuation', () => {
  const root = fixture(), control = createAutonomyControlPlane({ root, clock: () => 1000 })
  const result = control.evaluate({ iterationId: 'i-1', taskId: 'phase-5t-c', baseSha: 'abc', progressMaterial: { diff: 'one' }, blocker: { blockerClass: 'HOST_CAPABILITY', operation: 'service.reload', resource: 'command-center' } })
  assert.equal(result.action, 'WAITING_HOST_OPERATION'); assert.equal(control.inspect().blockers[result.blocker.fingerprint].occurrences, 1)
})
await test('three identical semantic states trigger the no-progress circuit breaker', () => {
  const root = fixture(), control = createAutonomyControlPlane({ root, noProgressLimit: 3 })
  const input = { taskId: 'task-one', baseSha: 'abc', progressMaterial: { diff: 'same' } }
  assert.equal(control.evaluate({ ...input, iterationId: 'i-1' }).action, 'CONTINUE')
  assert.equal(control.evaluate({ ...input, iterationId: 'i-2' }).action, 'CONTINUE')
  assert.equal(control.evaluate({ ...input, iterationId: 'i-3' }).action, 'CONTINUE')
  assert.equal(control.evaluate({ ...input, iterationId: 'i-4' }).action, 'HALT_NO_PROGRESS')
})
await test('resolved blocker remains auditable after restart', () => {
  const root = fixture(), first = createAutonomyControlPlane({ root })
  const result = first.evaluate({ iterationId: 'i-1', taskId: 'task-one', baseSha: 'abc', progressMaterial: {}, blocker: { blockerClass: 'HOST_CAPABILITY', operation: 'backup.create' } })
  first.resolveBlocker(result.blocker.fingerprint, 'receipt-one')
  const second = createAutonomyControlPlane({ root }); assert.equal(second.inspect().blockers[result.blocker.fingerprint].status, 'RESOLVED')
})
await test('host request validation rejects unknown operations and arbitrary resources', () => {
  const base = { schemaVersion: 1, requestId: 'request-one', taskId: 'task-one', operation: 'shell.execute', resource: 'command-center-repository', params: {}, idempotencyKey: 'a'.repeat(64), createdAt: 1, expiresAt: Date.now() + 1000 }
  assert.throws(() => validateHostOperationRequest(base), /not allowlisted/)
  assert.throws(() => validateHostOperationRequest({ ...base, operation: 'git.status', resource: '/tmp' }), /not allowlisted/)
})
await test('host request store is idempotent and rejects request id collisions', () => {
  const root = fixture(), now = Date.now(), store = createHostOperationStore({ root, clock: () => now })
  const request = { schemaVersion: 1, requestId: 'request-one', taskId: 'task-one', operation: 'git.status', resource: 'command-center-repository', params: {}, idempotencyKey: 'a'.repeat(64), createdAt: now, expiresAt: now + 1000 }
  store.enqueue(request); store.enqueue(request); assert.equal(store.list().length, 1)
  assert.throws(() => store.enqueue({ ...request, idempotencyKey: 'b'.repeat(64) }), /collision/)
})
await test('host request lifecycle survives claim and completion', () => {
  const root = fixture(), now = Date.now(), store = createHostOperationStore({ root, clock: () => now })
  const request = { schemaVersion: 1, requestId: 'request-one', taskId: 'task-one', operation: 'git.status', resource: 'command-center-repository', params: {}, idempotencyKey: 'a'.repeat(64), createdAt: now, expiresAt: now + 1000 }
  store.enqueue(request); store.claim('request-one'); store.finish('request-one', { ok: true, receipt: { receiptSha256: 'ok' } })
  assert.equal(store.find('request-one').status, 'COMPLETED')
})
await test('failed host requests require an explicit existing replacement before superseding', () => {
  const root = fixture(), now = Date.now(), store = createHostOperationStore({ root, clock: () => now })
  const base = { schemaVersion: 1, taskId: 'task-one', operation: 'git.status', resource: 'command-center-repository', params: {}, createdAt: now, expiresAt: now + 1000 }
  store.enqueue({ ...base, requestId: 'request-one', idempotencyKey: 'a'.repeat(64) })
  store.claim('request-one'); store.finish('request-one', { ok: false, error: 'bad request' })
  assert.throws(() => store.supersede('request-one', 'request-two'), /must exist/)
  store.enqueue({ ...base, requestId: 'request-two', idempotencyKey: 'b'.repeat(64) })
  store.supersede('request-one', 'request-two', 'corrected parameters')
  assert.equal(store.find('request-one').status, 'SUPERSEDED')
  assert.equal(store.find('request-one').value.replacementRequestId, 'request-two')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
