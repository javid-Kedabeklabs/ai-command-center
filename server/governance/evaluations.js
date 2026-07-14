import crypto from 'node:crypto'

export const EVALUATOR_VERSION = 'deterministic-v2'
export const EVALUATION_SCHEMA_VERSION = 2
export const EVALUATION_CHECK_TYPES = Object.freeze(['contains', 'not-contains', 'min-length', 'json', 'regex', 'run-duration-max', 'no-needs-review', 'visual-report', 'accessibility-report', 'security-report', 'model-report'])

const CHECK_TYPES = new Set(EVALUATION_CHECK_TYPES)
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

export function normalizeEvaluationSuite(input, previous = null, { now = Date.now() } = {}) {
  const id = String(input?.id || input?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!id) throw Object.assign(new Error('evaluation id or name required'), { code: 'INVALID_EVALUATION_ID', status: 400 })
  const checks = Array.isArray(input.checks) ? input.checks.slice(0, 50).map((check, index) => {
    const type = String(check?.type || '')
    if (!CHECK_TYPES.has(type)) throw Object.assign(new Error(`unsupported evaluation check type at index ${index}`), { code: 'UNKNOWN_EVALUATION_CHECK', status: 400 })
    return { id: String(check.id || `check-${index + 1}`).slice(0, 80), type, ...(check.value === undefined ? {} : { value: check.value }) }
  }) : []
  if (!checks.length) throw Object.assign(new Error('evaluation suite requires at least one check'), { code: 'EMPTY_EVALUATION_SUITE', status: 400 })
  const definition = { schemaVersion: EVALUATION_SCHEMA_VERSION, id, name: String(input.name || id).slice(0, 100), workflowId: String(input.workflowId || ''), ...(input.datasetId ? { datasetId: String(input.datasetId) } : {}), checks }
  const definitionHash = digest(definition)
  return { ...definition, definitionHash, history: previous?.history || [], ...(previous?.definitionHash === definitionHash && previous?.baselineRecordId ? { baselineRecordId: previous.baselineRecordId } : {}), createdAt: previous?.createdAt || now, updatedAt: now }
}

export function evaluationSuiteHash(suite) {
  if (!suite || typeof suite !== 'object') throw Object.assign(new Error('evaluation suite is required'), { code: 'MISSING_EVALUATION_SUITE', status: 409 })
  return digest({ schemaVersion: EVALUATION_SCHEMA_VERSION, id: suite.id, name: suite.name, workflowId: suite.workflowId, ...(suite.datasetId ? { datasetId: String(suite.datasetId) } : {}), checks: suite.checks })
}

const REPORT_KINDS = Object.freeze({ 'visual-report': 'visual', 'accessibility-report': 'accessibility', 'security-report': 'security', 'model-report': 'model' })
const reportConfig = check => typeof check?.value === 'string' ? { artifact: check.value } : check?.value && typeof check.value === 'object' && !Array.isArray(check.value) ? check.value : {}
const finite = value => Number.isFinite(Number(value)) ? Number(value) : Infinity

export function evaluationArtifactNames(suite) {
  return [...new Set((suite?.checks || []).filter(check => REPORT_KINDS[check.type]).map(check => String(reportConfig(check).artifact || '').trim()).filter(Boolean))]
}

export function evaluateSuiteChecks(suite, value, { run = null, artifacts = {} } = {}) {
  if (!Array.isArray(suite?.checks) || !suite.checks.length) throw Object.assign(new Error('evaluation suite requires at least one check'), { code: 'EMPTY_EVALUATION_SUITE', status: 409 })
  return suite.checks.map((check, index) => {
    if (!CHECK_TYPES.has(check.type)) throw Object.assign(new Error(`unsupported evaluation check type: ${check.type}`), { code: 'UNKNOWN_EVALUATION_CHECK', status: 409 })
    let passed = true, detail = ''
    const text = String(value ?? '')
    if (check.type === 'contains') { passed = text.toLowerCase().includes(String(check.value || '').toLowerCase()); detail = `contains ${check.value}` }
    else if (check.type === 'not-contains') { passed = !text.toLowerCase().includes(String(check.value || '').toLowerCase()); detail = `does not contain ${check.value}` }
    else if (check.type === 'min-length') { passed = text.length >= Number(check.value || 0); detail = `${text.length} / ${check.value} characters` }
    else if (check.type === 'json') { try { JSON.parse(text) } catch { passed = false }; detail = 'valid JSON' }
    else if (check.type === 'regex') { try { passed = new RegExp(String(check.value || '')).test(text) } catch { passed = false }; detail = `matches ${check.value}` }
    else if (check.type === 'run-duration-max') { const duration = Number(run?.ended) - Number(run?.started); passed = Boolean(run) && Number.isFinite(duration) && duration >= 0 && duration <= Number(check.value); detail = run ? `${duration} / ${Number(check.value)} ms maximum` : 'persisted run required' }
    else if (check.type === 'no-needs-review') { const blocked = Object.values(run?.checkpoint?.nodes || {}).filter(node => node?.state === 'needs_review').length; passed = Boolean(run) && blocked === 0 && run?.status !== 'needs_review'; detail = run ? `${blocked} unresolved reconciliation stops` : 'persisted run required' }
    else if (REPORT_KINDS[check.type]) {
      const config = reportConfig(check), artifact = String(config.artifact || '').trim(), evidence = artifacts[artifact], report = evidence?.report
      const valid = Boolean(run && artifact && report?.schemaVersion === 1 && report?.kind === REPORT_KINDS[check.type] && report?.passed === true)
      if (check.type === 'visual-report') { const actual = finite(report?.summary?.pixelDiffRatio), maximum = finite(config.maxDiffRatio ?? 0); passed = valid && actual <= maximum; detail = valid ? `${actual} / ${maximum} maximum pixel diff ratio` : `${artifact || 'artifact'} is not a passing visual report` }
      if (check.type === 'accessibility-report') { const critical = finite(report?.summary?.critical), serious = finite(report?.summary?.serious), maxCritical = finite(config.maxCritical ?? 0), maxSerious = finite(config.maxSerious ?? 0); passed = valid && critical <= maxCritical && serious <= maxSerious; detail = valid ? `${critical} critical, ${serious} serious violations` : `${artifact || 'artifact'} is not a passing accessibility report` }
      if (check.type === 'security-report') { const critical = finite(report?.summary?.critical), high = finite(report?.summary?.high), maxCritical = finite(config.maxCritical ?? 0), maxHigh = finite(config.maxHigh ?? 0); passed = valid && critical <= maxCritical && high <= maxHigh; detail = valid ? `${critical} critical, ${high} high findings` : `${artifact || 'artifact'} is not a passing security report` }
      if (check.type === 'model-report') { const score = finite(report?.summary?.score), minimum = finite(config.minScore ?? 80), bounded = /^[a-f0-9]{64}$/.test(String(report?.rubricHash || '')) && String(report?.evaluatorVersion || '').length > 0; passed = valid && bounded && score >= minimum && score <= 100; detail = valid && bounded ? `${score} / ${minimum} minimum model-rubric score` : `${artifact || 'artifact'} is not a bounded model report` }
      return { id: check.id || `check-${index + 1}`, passed, detail, artifact: artifact || null, artifactSha256: evidence?.sha256 || null }
    }
    return { id: check.id || `check-${index + 1}`, passed, detail }
  })
}

export function createEvaluationRecord({ suite, value, run = null, candidate = null, baseline = null, artifacts = {}, now = Date.now() } = {}) {
  const definitionHash = evaluationSuiteHash(suite)
  if (suite.definitionHash && suite.definitionHash !== definitionHash) throw Object.assign(new Error('evaluation suite definition hash is stale'), { code: 'STALE_EVALUATION_SUITE', status: 409 })
  const results = evaluateSuiteChecks(suite, value, { run, artifacts })
  let promotable = Boolean(run && candidate)
  let nonPromotableReason = null
  if (!run) { promotable = false; nonPromotableReason = 'persisted-run-required' }
  else if (!candidate) { promotable = false; nonPromotableReason = 'exact-candidate-required' }
  else {
    const exact = run.candidateId === candidate.id && run.workflowId === candidate.workflowId && run.workflowVersion === candidate.workflowVersion && run.operationalHash === candidate.operationalHash && run.permissionHash === candidate.permissionHash && run.secretManifestHash === candidate.secretManifestHash && run.dependencyHash === candidate.dependencyHash && run.environment === candidate.environment && suite.workflowId === candidate.workflowId
    if (!exact) throw Object.assign(new Error('run, candidate, workflow, or effective policy evidence does not match'), { code: 'CROSS_CANDIDATE_EVIDENCE', status: 409 })
    if (run.status !== 'done') throw Object.assign(new Error('only a completed persisted run can produce promotable evidence'), { code: 'INCOMPLETE_EVALUATION_RUN', status: 409 })
  }
  const score = Math.round(results.filter(item => item.passed).length / results.length * 100)
  const validBaseline = baseline && baseline.evaluationId === suite.id && baseline.suiteDefinitionHash === definitionHash && baseline.recordHash === digest(Object.fromEntries(Object.entries(baseline).filter(([key]) => key !== 'recordHash')))
  const record = {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    at: now,
    evaluatorVersion: EVALUATOR_VERSION,
    evaluationId: suite.id,
    suiteDefinitionHash: definitionHash,
    workflowId: candidate?.workflowId || run?.workflowId || suite.workflowId || null,
    candidateId: candidate?.id || null,
    workflowVersion: candidate?.workflowVersion || run?.workflowVersion || null,
    operationalHash: candidate?.operationalHash || run?.operationalHash || null,
    permissionHash: candidate?.permissionHash || run?.permissionHash || null,
    secretManifestHash: candidate?.secretManifestHash || run?.secretManifestHash || null,
    dependencyHash: candidate?.dependencyHash || run?.dependencyHash || null,
    environment: candidate?.environment || run?.environment || null,
    runId: run?.id || null,
    score,
    passed: results.every(item => item.passed),
    promotable,
    nonPromotableReason,
    results,
    ...(validBaseline ? { baseline: { recordId: baseline.id, recordHash: baseline.recordHash, score: baseline.score, delta: score - baseline.score } } : {}),
  }
  return { ...record, recordHash: digest(record) }
}

export function assertExactEvaluationEvidence({ suite, record, candidate } = {}) {
  if (!suite || !record || !candidate) throw Object.assign(new Error(`exact passing evidence is required for ${suite?.id || 'evaluation'}`), { code: 'STALE_EVALUATION_EVIDENCE', status: 409 })
  if (!suite.datasetId && (suite.checks || []).every(check => REPORT_KINDS[check.type])) throw Object.assign(new Error(`artifact reports cannot be the sole production judge for ${suite.id}`), { code: 'ARTIFACT_EVALUATION_REQUIRES_DETERMINISTIC_GATE', status: 409 })
  const { recordHash, ...recordBody } = record || {}
  const exact = recordHash === digest(recordBody) && record?.promotable === true && record.passed === true && record.evaluationId === suite.id && record.suiteDefinitionHash === evaluationSuiteHash(suite) && record.candidateId === candidate.id && record.workflowId === candidate.workflowId && record.workflowVersion === candidate.workflowVersion && record.operationalHash === candidate.operationalHash && record.permissionHash === candidate.permissionHash && record.secretManifestHash === candidate.secretManifestHash && record.dependencyHash === candidate.dependencyHash && record.environment === candidate.environment
  if (!exact) throw Object.assign(new Error(`exact passing evidence is required for ${suite?.id || 'evaluation'}`), { code: 'STALE_EVALUATION_EVIDENCE', status: 409 })
  return true
}
