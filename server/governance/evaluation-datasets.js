import crypto from 'node:crypto'

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

export function evaluationDatasetHash(dataset) {
  return digest({ schemaVersion: 1, id: dataset.id, name: dataset.name, cases: dataset.cases })
}

export function normalizeEvaluationDataset(input, previous = null, { now = Date.now() } = {}) {
  const id = String(input?.id || input?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!id) throw Object.assign(new Error('dataset id or name required'), { code: 'INVALID_EVALUATION_DATASET', status: 400 })
  const cases = (Array.isArray(input.cases) ? input.cases : []).slice(0, 200).map((item, index) => {
    const caseId = String(item?.id || `case-${index + 1}`).slice(0, 100), match = ['equals', 'contains', 'json-equals'].includes(item?.match) ? item.match : 'equals'
    if (!caseId || item?.input === undefined || item?.expected === undefined) throw Object.assign(new Error(`dataset case ${index + 1} requires id, input, and expected`), { code: 'INVALID_EVALUATION_CASE', status: 400 })
    return { id: caseId, input: String(item.input), expected: typeof item.expected === 'string' ? item.expected : JSON.stringify(item.expected), match }
  })
  if (!cases.length || new Set(cases.map(item => item.id)).size !== cases.length) throw Object.assign(new Error('dataset requires unique cases'), { code: 'INVALID_EVALUATION_CASES', status: 400 })
  const definition = { schemaVersion: 1, id, name: String(input.name || id).slice(0, 120), cases }, definitionHash = evaluationDatasetHash(definition)
  return { ...definition, definitionHash, createdAt: previous?.createdAt || now, updatedAt: now }
}

export function evaluateDatasetCase(item, output) {
  const text = String(output ?? ''), expected = String(item.expected ?? '')
  if (item.match === 'contains') return { passed: text.includes(expected), detail: `contains expected value for ${item.id}` }
  if (item.match === 'json-equals') {
    try { return { passed: JSON.stringify(stable(JSON.parse(text))) === JSON.stringify(stable(JSON.parse(expected))), detail: `JSON equals expected value for ${item.id}` } }
    catch { return { passed: false, detail: `valid comparable JSON for ${item.id}` } }
  }
  return { passed: text === expected, detail: `equals expected value for ${item.id}` }
}

export function createDatasetEvaluationRecord({ suite, dataset, caseRuns, candidate, now = Date.now() } = {}) {
  if (!suite || !dataset || dataset.definitionHash !== evaluationDatasetHash(dataset)) throw Object.assign(new Error('exact versioned dataset required'), { code: 'STALE_EVALUATION_DATASET', status: 409 })
  const byCase = new Map((caseRuns || []).map(item => [String(item.caseId), item.run]))
  if ((caseRuns || []).length !== dataset.cases.length || byCase.size !== dataset.cases.length || dataset.cases.some(item => !byCase.has(item.id))) throw Object.assign(new Error('one exact persisted run is required for every dataset case'), { code: 'INCOMPLETE_DATASET_EVIDENCE', status: 409 })
  const caseResults = dataset.cases.map(item => {
    const run = byCase.get(item.id)
    const exact = run && candidate && run.status === 'done' && run.candidateId === candidate.id && run.workflowId === candidate.workflowId && run.workflowVersion === candidate.workflowVersion && run.operationalHash === candidate.operationalHash && run.permissionHash === candidate.permissionHash && run.secretManifestHash === candidate.secretManifestHash && run.dependencyHash === candidate.dependencyHash && run.environment === candidate.environment
    if (!exact) throw Object.assign(new Error(`dataset case ${item.id} is not bound to the exact candidate`), { code: 'CROSS_CANDIDATE_DATASET_EVIDENCE', status: 409 })
    const result = evaluateDatasetCase(item, run.result)
    return { caseId: item.id, runId: run.id, inputHash: digest(item.input), outputHash: digest(String(run.result ?? '')), ...result }
  })
  const passed = caseResults.every(item => item.passed), score = Math.round(caseResults.filter(item => item.passed).length / caseResults.length * 100)
  const record = { schemaVersion: 2, id: crypto.randomUUID(), at: now, evaluatorVersion: 'dataset-v1', evaluationId: suite.id, suiteDefinitionHash: suite.definitionHash, datasetId: dataset.id, datasetDefinitionHash: dataset.definitionHash, workflowId: candidate.workflowId, candidateId: candidate.id, workflowVersion: candidate.workflowVersion, operationalHash: candidate.operationalHash, permissionHash: candidate.permissionHash, secretManifestHash: candidate.secretManifestHash, dependencyHash: candidate.dependencyHash, environment: candidate.environment, runIds: caseResults.map(item => item.runId), score, passed, promotable: true, nonPromotableReason: null, results: caseResults }
  return { ...record, recordHash: digest(record) }
}
