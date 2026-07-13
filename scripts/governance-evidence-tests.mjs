import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCandidateRecord, createCandidateStore, workflowOperationalEvidence } from '../server/governance/candidates.js'
import { assertExactEvaluationEvidence, createEvaluationRecord, normalizeEvaluationSuite } from '../server/governance/evaluations.js'
import { workflowContentHash } from '../server/workflows/versions.js'

let passed = 0
function test(name, fn) { fn(); passed++; console.log(`  PASS ${name}`) }

const workflow = {
  schemaVersion: 2,
  id: 'evidence-workflow',
  name: 'Display name',
  environment: 'development',
  nodes: [{ id: 'in', type: 'input', data: { label: 'Input' }, position: { x: 0, y: 0 } }],
  edges: [],
  groups: [],
  comments: [{ id: 'comment', body: 'non-operational' }],
  variables: {},
  settings: { retries: 1 },
  permissions: { network: false },
  secretReferences: [{ id: 'named-ref', purpose: 'generic', revision: 1 }],
  triggers: [],
  evaluations: ['suite'],
  governance: { status: 'draft', locked: false },
}
const candidate = createCandidateRecord({ id: 'candidate-one', workflow, workflowVersion: 'version-abc', sourceHash: workflowContentHash(workflow), now: 10 })
const run = { id: 'run-one', status: 'done', candidateId: candidate.id, workflowId: candidate.workflowId, workflowVersion: candidate.workflowVersion, environment: candidate.environment, operationalHash: candidate.operationalHash, permissionHash: candidate.permissionHash, secretManifestHash: candidate.secretManifestHash, dependencyHash: candidate.dependencyHash }
const suite = normalizeEvaluationSuite({ id: 'suite', name: 'Suite', workflowId: workflow.id, checks: [{ type: 'contains', value: 'ok' }] }, null, { now: 20 })

console.log('== immutable governance evidence ==')
test('operational hash ignores display-only fields and key insertion order', () => {
  const renamed = { governance: { locked: true }, ...workflow, name: 'Other display name', comments: [] }
  assert.equal(workflowOperationalEvidence(renamed).operationalHash, candidate.operationalHash)
})
test('operational hash changes for executable, policy, secret, and dependency state', () => {
  for (const changed of [
    { ...workflow, settings: { retries: 2 } },
    { ...workflow, permissions: { network: true } },
    { ...workflow, secretReferences: [{ id: 'other', purpose: 'generic' }] },
    { ...workflow, nodes: [{ ...workflow.nodes[0], data: { label: 'Input', pluginId: 'plugin', pluginVersion: '2' } }] },
  ]) assert.notEqual(workflowOperationalEvidence(changed).operationalHash, candidate.operationalHash)
})
test('candidate records are content-bound and tampered records are quarantined on read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-candidates-')), file = path.join(root, 'candidates.json'), store = createCandidateStore({ file })
  store.add(candidate)
  assert.equal(store.find(candidate.id).recordHash, candidate.recordHash)
  const records = JSON.parse(fs.readFileSync(file, 'utf8')); records[0].operationalHash = 'tampered'; fs.writeFileSync(file, JSON.stringify(records))
  assert.equal(store.find(candidate.id), null)
  fs.rmSync(root, { recursive: true, force: true })
})
test('empty and unknown suites are rejected', () => {
  assert.throws(() => normalizeEvaluationSuite({ id: 'empty', checks: [] }), error => error.code === 'EMPTY_EVALUATION_SUITE')
  assert.throws(() => normalizeEvaluationSuite({ id: 'unknown', checks: [{ type: 'model-vote' }] }), error => error.code === 'UNKNOWN_EVALUATION_CHECK')
})
test('ad hoc evidence is explicitly non-promotable', () => {
  const record = createEvaluationRecord({ suite, value: 'ok' })
  assert.equal(record.passed, true)
  assert.equal(record.promotable, false)
  assert.equal(record.nonPromotableReason, 'persisted-run-required')
})
test('exact persisted run evidence is promotable and integrity-bound', () => {
  const record = createEvaluationRecord({ suite, value: 'ok', run, candidate, now: 30 })
  assert.equal(record.promotable, true)
  assert.doesNotThrow(() => assertExactEvaluationEvidence({ suite, record, candidate }))
  assert.throws(() => assertExactEvaluationEvidence({ suite, record: { ...record, score: 0 }, candidate }), error => error.code === 'STALE_EVALUATION_EVIDENCE')
})
test('cross-candidate and suite-change evidence fails closed', () => {
  const other = { ...candidate, id: 'candidate-two' }
  assert.throws(() => createEvaluationRecord({ suite, value: 'ok', run, candidate: other }), error => error.code === 'CROSS_CANDIDATE_EVIDENCE')
  const record = createEvaluationRecord({ suite, value: 'ok', run, candidate })
  const changedSuite = normalizeEvaluationSuite({ id: 'suite', name: 'Changed', workflowId: workflow.id, checks: [{ type: 'contains', value: 'ok' }] }, suite)
  assert.throws(() => assertExactEvaluationEvidence({ suite: changedSuite, record, candidate }), error => error.code === 'STALE_EVALUATION_EVIDENCE')
})

console.log(`governance evidence tests: ${passed}/7 passed`)
