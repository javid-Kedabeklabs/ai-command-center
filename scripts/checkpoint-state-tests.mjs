import assert from 'node:assert/strict'
import {
  claimNode,
  completeNode,
  confirmEffect,
  createCheckpoint,
  effectOperationKey,
  failNode,
  logicalExecutionKey,
  markEffectInflight,
  migrateLegacyCheckpoint,
  prepareEffect,
  recoverCheckpoint,
  validateCheckpoint,
} from '../server/runtime/checkpoint-state.js'

let passed = 0
const check = (condition, label) => { assert.ok(condition, label); passed += 1; console.log(`✓ ${label}`) }
const identity = { logicalRunId: 'run-logical-1', workflowVersion: 'version-1', workflowVersionHash: 'a'.repeat(64), nodeIds: ['in', 'a', 'b', 'out'], runtimeEpoch: 'epoch-1' }

let checkpoint = createCheckpoint(identity)
check(checkpoint.schemaVersion === 2 && Object.keys(checkpoint.nodes).length === 4, 'creates a versioned per-node checkpoint')
check(logicalExecutionKey({ logicalRunId: identity.logicalRunId, workflowVersionHash: identity.workflowVersionHash, nodeId: 'a' }) === checkpoint.nodes.a.execKey, 'logical execution key is deterministic')
check(effectOperationKey(checkpoint.nodes.a.execKey) === effectOperationKey(checkpoint.nodes.a.execKey), 'operation key is stable across physical attempts')

checkpoint = claimNode(checkpoint, 'a', { inputHash: 'input-a', attemptId: 'attempt-a1' })
checkpoint = prepareEffect(checkpoint, 'a', 'attempt-a1', { requestHash: 'request-a' })
checkpoint = markEffectInflight(checkpoint, 'a', 'attempt-a1')
const recoveredAmbiguous = recoverCheckpoint(checkpoint, { runtimeEpoch: 'epoch-2' })
check(recoveredAmbiguous.nodes.a.state === 'needs_review' && recoveredAmbiguous.nodes.a.effect.state === 'ambiguous', 'an unreconciled in-flight effect stops for review')

const recoveredAbsent = recoverCheckpoint(checkpoint, { runtimeEpoch: 'epoch-2', reconcile: { a: 'absent' } })
check(recoveredAbsent.nodes.a.state === 'pending' && !recoveredAbsent.nodes.a.activeAttempt, 'authoritative absence permits a safe retry')

let confirmed = confirmEffect(checkpoint, 'a', 'attempt-a1', 'receipt:a')
confirmed = completeNode(confirmed, 'a', 'attempt-a1', { output: 'done-a' })
check(confirmed.nodes.a.state === 'succeeded' && confirmed.outputs.a === 'done-a', 'confirmed effect and output commit atomically as succeeded')

let computational = claimNode(createCheckpoint(identity), 'b', { inputHash: 'input-b', attemptId: 'attempt-b1' })
computational = recoverCheckpoint(computational, { runtimeEpoch: 'epoch-2' })
check(computational.nodes.b.state === 'pending', 'crashed computation without an external effect can retry')
computational = claimNode(computational, 'b', { inputHash: 'input-b', attemptId: 'attempt-b2' })
check(computational.nodes.b.attemptsStarted === 2 && computational.nodes.b.execKey === createCheckpoint(identity).nodes.b.execKey, 'retry changes attempt identity without changing logical execution identity')

let failed = claimNode(createCheckpoint(identity), 'a', { inputHash: 'input-a', attemptId: 'attempt-a1' })
failed = failNode(failed, 'a', 'attempt-a1', 'error:fixture')
check(failed.nodes.a.state === 'failed' && failed.nodes.a.lastErrorRef === 'error:fixture', 'ordinary failure is recorded without ambiguity')

const legacy = migrateLegacyCheckpoint({ outputs: { in: 'value', b: '' }, routes: {}, skipped: ['a'], lastNodeId: 'out' }, identity)
check(legacy.nodes.in.state === 'succeeded' && legacy.nodes.a.state === 'skipped' && legacy.nodes.b.state === 'succeeded', 'legacy migration trusts exact output and skip evidence')
check(legacy.nodes.out.state === 'pending' && legacy.legacyLastNodeId === 'out', 'legacy lastNodeId is not mistaken for completion evidence')

assert.throws(() => completeNode(checkpoint, 'a', 'stale-attempt', { output: 'unsafe' }), /stale or inactive attempt/)
passed += 1; console.log('✓ stale worker completion is fenced')
assert.throws(() => validateCheckpoint({ ...createCheckpoint(identity), runtimeEpoch: '' }), /identity is incomplete/)
passed += 1; console.log('✓ malformed checkpoint identity fails closed')

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
