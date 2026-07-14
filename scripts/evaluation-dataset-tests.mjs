import assert from 'node:assert/strict'
import { createDatasetEvaluationRecord, evaluateDatasetCase, normalizeEvaluationDataset } from '../server/governance/evaluation-datasets.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`) }
const dataset = normalizeEvaluationDataset({ id: 'quality-cases', name: 'Quality cases', cases: [{ id: 'exact', input: 'A', expected: 'A' }, { id: 'contains', input: 'B', expected: 'needle', match: 'contains' }, { id: 'json', input: 'C', expected: { ok: true }, match: 'json-equals' }] }, null, { now: 1 })
const candidate = { id: 'candidate', workflowId: 'workflow', workflowVersion: 'v1', operationalHash: 'o', permissionHash: 'p', secretManifestHash: 's', dependencyHash: 'd', environment: 'testing' }
const run = (id, result) => ({ id, result, status: 'done', candidateId: candidate.id, workflowId: candidate.workflowId, workflowVersion: candidate.workflowVersion, operationalHash: candidate.operationalHash, permissionHash: candidate.permissionHash, secretManifestHash: candidate.secretManifestHash, dependencyHash: candidate.dependencyHash, environment: candidate.environment })

test('dataset normalization is versioned and immutable by content hash', () => { assert.match(dataset.definitionHash, /^[a-f0-9]{64}$/); assert.equal(dataset.cases.length, 3) })
test('case matchers are deterministic', () => { assert.equal(evaluateDatasetCase(dataset.cases[0], 'A').passed, true); assert.equal(evaluateDatasetCase(dataset.cases[1], 'hay needle stack').passed, true); assert.equal(evaluateDatasetCase(dataset.cases[2], '{"ok":true}').passed, true) })
test('aggregate evidence binds every case to exact persisted candidate runs', () => {
  const suite = { id: 'suite', definitionHash: 'suite-hash' }, record = createDatasetEvaluationRecord({ suite, dataset, candidate, caseRuns: [{ caseId: 'exact', run: run('r1', 'A') }, { caseId: 'contains', run: run('r2', 'needle') }, { caseId: 'json', run: run('r3', '{"ok":true}') }], now: 2 })
  assert.equal(record.passed, true); assert.equal(record.promotable, true); assert.equal(record.runIds.length, 3); assert.match(record.recordHash, /^[a-f0-9]{64}$/)
})
test('missing and cross-candidate cases fail closed', () => {
  const suite = { id: 'suite', definitionHash: 'suite-hash' }
  assert.throws(() => createDatasetEvaluationRecord({ suite, dataset, candidate, caseRuns: [] }), error => error.code === 'INCOMPLETE_DATASET_EVIDENCE')
  const wrong = { ...run('r1', 'A'), candidateId: 'other' }
  assert.throws(() => createDatasetEvaluationRecord({ suite, dataset: normalizeEvaluationDataset({ id: 'one', name: 'One', cases: [{ id: 'one', input: 'A', expected: 'A' }] }), candidate, caseRuns: [{ caseId: 'one', run: wrong }] }), error => error.code === 'CROSS_CANDIDATE_DATASET_EVIDENCE')
})

console.log(`\nevaluation dataset tests: ${passed}/${passed} passed`)
