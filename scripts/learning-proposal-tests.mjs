import assert from 'node:assert/strict'
import { decideLearningProposal, learningProposalFingerprint, mergeLearningProposals, normalizeLearningProposal, verifyLearningProposal } from '../server/learning/proposals.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`) }
const raw = { id: 'proposal-123456789abc', workflowId: 'workflow', sourceWorkflowHash: 'source-hash', kind: 'retry-policy', findingKey: 'repeated-failure-rate', title: 'Bound retries', rationale: 'Two exact runs failed.', patch: { settings: { retries: 2 } }, evidence: ['run-b', 'run-a'] }

test('fingerprints are stable as new evidence accumulates', () => {
  assert.equal(learningProposalFingerprint(raw), learningProposalFingerprint({ ...raw, evidence: ['run-c'] }))
})
test('normalization creates versioned expiring evidence records', () => {
  const item = normalizeLearningProposal(raw, { now: 100 })
  assert.equal(item.schemaVersion, 1); assert.equal(item.status, 'proposed'); assert.deepEqual(item.evidence, ['run-a', 'run-b']); assert.ok(item.expiresAt > 100)
})
test('repeated analysis deduplicates the same evidence fingerprint', () => {
  const first = normalizeLearningProposal(raw, { now: 100 }), result = mergeLearningProposals([first], [{ ...raw, id: 'different' }], { now: 200 })
  assert.equal(result.proposals.length, 1); assert.equal(result.emitted[0].id, first.id); assert.equal(result.emitted[0].updatedAt, 200); assert.deepEqual(result.emitted[0].evidence, ['run-a', 'run-b'])
})
test('approval produces a stable separate candidate identity', () => {
  const item = normalizeLearningProposal(raw, { now: 100 }), result = decideLearningProposal(item, { decision: 'approved', commandId: 'approve-1', actor: 'owner', now: 200 })
  assert.equal(result.proposal.status, 'approved'); assert.equal(result.proposal.candidateWorkflowId, 'workflow-learning-123456789abc'); assert.equal(result.proposal.applied, false)
})
test('identical decision replay returns the original receipt', () => {
  const item = normalizeLearningProposal(raw, { now: 100 }), first = decideLearningProposal(item, { decision: 'approved', commandId: 'approve-1', actor: 'owner', now: 200 })
  const replay = decideLearningProposal(first.proposal, { decision: 'approved', commandId: 'approve-1', actor: 'owner', now: 300 })
  assert.equal(replay.replay, true); assert.deepEqual(replay.proposal, first.proposal)
})
test('conflicting command reuse and terminal decisions fail closed', () => {
  const item = normalizeLearningProposal(raw, { now: 100 }), first = decideLearningProposal(item, { decision: 'approved', commandId: 'decision', actor: 'owner', now: 200 }).proposal
  assert.throws(() => decideLearningProposal(first, { decision: 'rejected', commandId: 'decision', actor: 'owner' }), error => error.code === 'LEARNING_COMMAND_CONFLICT')
  assert.throws(() => decideLearningProposal(first, { decision: 'rejected', commandId: 'other', actor: 'owner' }), error => error.code === 'LEARNING_DECISION_CONFLICT')
})
test('exact candidate regression evidence advances only the matching approved proposal', () => {
  const approved = decideLearningProposal(normalizeLearningProposal(raw, { now: 100 }), { decision: 'approved', commandId: 'approve', actor: 'owner', now: 200 }).proposal
  const candidate = { id: 'candidate', workflowId: approved.candidateWorkflowId, workflowVersion: 'v1' }, suite = { id: 'suite' }, record = { id: 'record', recordHash: 'a'.repeat(64) }
  const first = verifyLearningProposal(approved, { suite, record, candidate, commandId: 'verify', actor: 'owner', now: 300 })
  assert.equal(first.proposal.status, 'verified'); assert.equal(first.proposal.verification.recordId, 'record')
  assert.equal(verifyLearningProposal(first.proposal, { suite, record, candidate, commandId: 'verify', actor: 'owner', now: 400 }).replay, true)
  assert.throws(() => verifyLearningProposal(approved, { suite, record, candidate: { ...candidate, workflowId: 'other' }, commandId: 'wrong' }), error => error.code === 'LEARNING_CANDIDATE_EVIDENCE_MISMATCH')
})

console.log(`\nlearning proposal tests: ${passed}/${passed} passed`)
