import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertExactEvaluationEvidence, createEvaluationRecord, evaluateSuiteChecks, normalizeEvaluationSuite } from '../server/governance/evaluations.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, '.tmp', `evaluation-gates-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
const port = 20000 + crypto.randomInt(1000)
const base = `http://127.0.0.1:${port}`
let server
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 100; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }

async function startServer() {
  fs.mkdirSync(path.join(fixtureRoot, 'data'), { recursive: true })
  fs.mkdirSync(path.join(fixtureRoot, 'brain'), { recursive: true })
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ACC_DATA_DIR: path.relative(root, path.join(fixtureRoot, 'data')), ACC_BRAIN_DIR: path.relative(root, path.join(fixtureRoot, 'brain')) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode != null) throw new Error(`evaluation fixture server exited: ${stderr}`)
    try { if ((await request('/api/system')).response.ok) return child } catch {}
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  child.kill('SIGKILL')
  throw new Error(`evaluation fixture server did not become healthy: ${stderr}`)
}

async function stopServer() {
  if (!server || server.exitCode != null) return
  const exited = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))])
}

console.log('== exact candidate evaluation evidence ==')
const workflowId = 'evaluation-gate-fixture', evaluationId = 'evaluation-gate-suite', datasetId = 'evaluation-gate-dataset', datasetSuiteId = 'evaluation-gate-dataset-suite'
const reportInput = JSON.stringify({ schemaVersion: 1, kind: 'security', passed: true, summary: { critical: 0, high: 0 }, note: 'APPROVED fixture result' })
const workflow = { schemaVersion: 2, id: workflowId, name: 'Evaluation gate fixture', permissions: { 'write-files': true }, nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'report', type: 'write-file', position: { x: 300, y: 100 }, data: { label: 'Persist report', path: 'security-report.json' } }, { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'in', target: 'out' }, { id: 'report-edge', source: 'in', target: 'report' }], evaluations: [evaluationId], governance: { promotionGates: { evaluations: [evaluationId] } } }
let candidate, secondCandidate, runId, exactRecord

server = await startServer()

await request('/api/evaluations/' + evaluationId, { method: 'DELETE' })
await request('/api/evaluations/' + datasetSuiteId, { method: 'DELETE' })
await request('/api/evaluation-datasets/' + datasetId, { method: 'DELETE' })
await request(`/api/workflows/${workflowId}/unlock`, { method: 'POST', ...json({ reason: 'fixture reset' }) })
await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })

await test('empty and unknown evaluation checks fail closed', async () => {
  const empty = await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Empty', workflowId, checks: [] }) })
  const unknown = await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Unknown', workflowId, checks: [{ type: 'model-vote' }] }) })
  if (empty.response.status !== 400 || empty.body.code !== 'EMPTY_EVALUATION_SUITE' || unknown.response.status !== 400 || unknown.body.code !== 'UNKNOWN_EVALUATION_CHECK') throw new Error(JSON.stringify({ empty: empty.body, unknown: unknown.body }))
})

await test('operational checks consume persisted run truth and fail closed without it', async () => {
  const suite = { checks: [{ id: 'duration', type: 'run-duration-max', value: 100 }, { id: 'review', type: 'no-needs-review' }] }
  const absent = evaluateSuiteChecks(suite, '', { run: null })
  const clean = evaluateSuiteChecks(suite, '', { run: { started: 100, ended: 180, status: 'done', checkpoint: { nodes: { a: { state: 'succeeded' } } } } })
  const blocked = evaluateSuiteChecks(suite, '', { run: { started: 100, ended: 250, status: 'needs_review', checkpoint: { nodes: { a: { state: 'needs_review' } } } } })
  if (absent.some(item => item.passed) || clean.some(item => !item.passed) || blocked.some(item => item.passed)) throw new Error(JSON.stringify({ absent, clean, blocked }))
})

await test('artifact adapters validate typed reports and bind exact artifact hashes', async () => {
  const suite = { checks: [{ id: 'visual', type: 'visual-report', value: { artifact: 'visual.json', maxDiffRatio: 0.01 } }, { id: 'a11y', type: 'accessibility-report', value: 'axe.json' }, { id: 'security', type: 'security-report', value: 'security.json' }, { id: 'model', type: 'model-report', value: { artifact: 'model.json', minScore: 80 } }] }
  const run = { id: 'artifact-run' }, artifacts = {
    'visual.json': { report: { schemaVersion: 1, kind: 'visual', passed: true, summary: { pixelDiffRatio: 0.005 } }, sha256: 'a'.repeat(64) },
    'axe.json': { report: { schemaVersion: 1, kind: 'accessibility', passed: true, summary: { critical: 0, serious: 0 } }, sha256: 'b'.repeat(64) },
    'security.json': { report: { schemaVersion: 1, kind: 'security', passed: true, summary: { critical: 0, high: 0 } }, sha256: 'c'.repeat(64) },
    'model.json': { report: { schemaVersion: 1, kind: 'model', passed: true, evaluatorVersion: 'fixture-v1', rubricHash: 'e'.repeat(64), summary: { score: 90 } }, sha256: 'e'.repeat(64) },
  }
  const passing = evaluateSuiteChecks(suite, '', { run, artifacts })
  const failing = evaluateSuiteChecks(suite, '', { run, artifacts: { ...artifacts, 'security.json': { report: { schemaVersion: 1, kind: 'security', passed: true, summary: { critical: 0, high: 1 } }, sha256: 'd'.repeat(64) } } })
  if (passing.some(item => !item.passed || !/^[a-f0-9]{64}$/.test(item.artifactSha256 || '')) || failing[2].passed) throw new Error(JSON.stringify({ passing, failing }))
})

await test('artifact reports cannot become the sole production judge', async () => {
  const suite = normalizeEvaluationSuite({ id: 'artifact-only', name: 'Artifact only', workflowId: 'wf', checks: [{ type: 'security-report', value: 'security.json' }] }, null, { now: 1 })
  const exact = { id: 'candidate', workflowId: 'wf', workflowVersion: 'v1', operationalHash: 'o', permissionHash: 'p', secretManifestHash: 's', dependencyHash: 'd', environment: 'testing' }
  const run = { id: 'run', status: 'done', candidateId: exact.id, workflowId: exact.workflowId, workflowVersion: exact.workflowVersion, operationalHash: exact.operationalHash, permissionHash: exact.permissionHash, secretManifestHash: exact.secretManifestHash, dependencyHash: exact.dependencyHash, environment: exact.environment }
  const record = createEvaluationRecord({ suite, run, candidate: exact, artifacts: { 'security.json': { report: { schemaVersion: 1, kind: 'security', passed: true, summary: { critical: 0, high: 0 } }, sha256: 'a'.repeat(64) } }, now: 2 })
  try { assertExactEvaluationEvidence({ suite, record, candidate: exact }); throw new Error('artifact-only evidence was accepted') }
  catch (error) { if (error.code !== 'ARTIFACT_EVALUATION_REQUIRES_DETERMINISTIC_GATE') throw error }
})

await test('candidate records bind exact immutable workflow and policy hashes', async () => {
  const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) })
  if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
  const suite = await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Required quality', workflowId, checks: [{ type: 'contains', value: 'APPROVED' }] }) })
  if (!suite.response.ok || !/^[a-f0-9]{64}$/.test(suite.body.definitionHash)) throw new Error(JSON.stringify(suite.body))
  const created = await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'evaluation-test' }) })
  candidate = created.body
  if (created.response.status !== 201 || !candidate.workflowVersion || !candidate.operationalHash || !candidate.permissionHash || !candidate.secretManifestHash || !candidate.dependencyHash) throw new Error(JSON.stringify(candidate))
  const listed = await request(`/api/workflows/${workflowId}/candidates`)
  if (!listed.body.some(item => item.id === candidate.id)) throw new Error('immutable candidate was not persisted')
})

await test('ad hoc caller output is recorded only as non-promotable evidence', async () => {
  const evaluated = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ output: 'APPROVED sample' }) })
  if (!evaluated.body.passed || evaluated.body.promotable !== false || evaluated.body.nonPromotableReason !== 'persisted-run-required') throw new Error(JSON.stringify(evaluated.body))
})

await test('persisted candidate run produces exact promotable evidence', async () => {
  const started = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input: reportInput, candidateId: candidate.id }) })
  runId = started.body.runId
  const run = await waitRun(runId)
  if (run.status !== 'done' || run.candidateId !== candidate.id || run.operationalHash !== candidate.operationalHash) throw new Error(JSON.stringify(run))
  const evaluated = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId }) })
  exactRecord = evaluated.body
  if (!exactRecord.passed || !exactRecord.promotable || exactRecord.candidateId !== candidate.id || exactRecord.runId !== runId) throw new Error(JSON.stringify(exactRecord))
  const detail = await request(`/api/runs/${runId}/detail`)
  if (!detail.body.evaluations?.some(item => item.id === exactRecord.id && item.promotable)) throw new Error('persisted run is missing exact evaluation provenance')
})

await test('an exact promotable record can become a hash-bound comparison baseline', async () => {
  const baselineRecordId = exactRecord.id
  let result = await request(`/api/evaluations/${evaluationId}/baseline`, { method: 'POST', ...json({ recordId: exactRecord.id }) })
  if (!result.response.ok || result.body.baselineRecordId !== exactRecord.id) throw new Error(JSON.stringify(result.body))
  result = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId }) })
  exactRecord = result.body
  if (!exactRecord.promotable || exactRecord.baseline?.recordId !== baselineRecordId || exactRecord.baseline.score !== 100 || exactRecord.baseline.delta !== 0) throw new Error(JSON.stringify(exactRecord))
})

await test('a versioned dataset requires one exact persisted candidate run per case', async () => {
  let result = await request('/api/evaluation-datasets', { method: 'POST', ...json({ id: datasetId, name: 'Exact case matrix', cases: [{ id: 'one', input: 'dataset-one', expected: 'dataset-one' }, { id: 'two', input: 'dataset-two', expected: 'dataset-two', match: 'contains' }] }) })
  if (!result.response.ok || !/^[a-f0-9]{64}$/.test(result.body.definitionHash)) throw new Error(JSON.stringify(result.body))
  result = await request('/api/evaluations', { method: 'POST', ...json({ id: datasetSuiteId, name: 'Dataset gate', workflowId, datasetId, checks: [{ type: 'contains', value: 'dataset' }] }) })
  if (!result.response.ok || result.body.datasetId !== datasetId) throw new Error(JSON.stringify(result.body))
  const caseRuns = []
  for (const [caseId, input] of [['one', 'dataset-one'], ['two', 'prefix dataset-two suffix']]) {
    const started = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input, candidateId: candidate.id }) }), run = await waitRun(started.body.runId)
    if (run.status !== 'done') throw new Error(JSON.stringify(run)); caseRuns.push({ caseId, runId: run.id })
  }
  const incomplete = await request(`/api/evaluations/${datasetSuiteId}/dataset-run`, { method: 'POST', ...json({ candidateId: candidate.id, cases: caseRuns.slice(0, 1) }) })
  if (incomplete.response.status !== 409 || incomplete.body.code !== 'INCOMPLETE_DATASET_EVIDENCE') throw new Error(JSON.stringify(incomplete.body))
  result = await request(`/api/evaluations/${datasetSuiteId}/dataset-run`, { method: 'POST', ...json({ candidateId: candidate.id, cases: caseRuns }) })
  if (!result.body.promotable || !result.body.passed || result.body.score !== 100 || result.body.runIds?.length !== 2) throw new Error(JSON.stringify(result.body))
})

await test('persisted-run evidence rejects caller-supplied output substitution', async () => {
  const injected = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId, output: 'caller substituted output' }) })
  if (injected.response.status !== 400 || injected.body.code !== 'EVALUATION_OUTPUT_OVERRIDE') throw new Error(JSON.stringify(injected.body))
})

await test('cross-candidate evidence is rejected even for identical source content', async () => {
  secondCandidate = (await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'evaluation-test' }) })).body
  const crossed = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId, candidateId: secondCandidate.id }) })
  if (crossed.response.status !== 409 || crossed.body.code !== 'CROSS_CANDIDATE_EVIDENCE') throw new Error(JSON.stringify(crossed.body))
})

await test('suite edits invalidate prior evidence', async () => {
  const edited = await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Required quality v2', workflowId, checks: [{ type: 'contains', value: 'APPROVED' }, { type: 'min-length', value: 5 }, { type: 'security-report', value: 'security-report.json' }] }) })
  if (!edited.response.ok || edited.body.definitionHash === exactRecord.suiteDefinitionHash || edited.body.baselineRecordId) throw new Error(JSON.stringify(edited.body))
  if (exactRecord.suiteDefinitionHash === edited.body.definitionHash) throw new Error('suite edit did not stale the previous evidence')
  const refreshed = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId }) })
  exactRecord = refreshed.body
  if (!exactRecord.promotable || exactRecord.suiteDefinitionHash !== edited.body.definitionHash) throw new Error(JSON.stringify(exactRecord))
})

await test('workflow edits do not change an exact candidate run and lifecycle requires restoring exact content', async () => {
  const current = (await request(`/api/workflows/${workflowId}`)).body
  const changed = structuredClone(current); changed.nodes[0].data.label = 'Changed after candidate preparation'
  let result = await request('/api/workflows', { method: 'POST', ...json(changed) })
  if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input: reportInput, candidateId: candidate.id }) })
  if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  const pinnedRun = await waitRun(result.body.runId)
  if (pinnedRun.status !== 'done' || pinnedRun.operationalHash !== candidate.operationalHash || pinnedRun.workflowVersion !== candidate.workflowVersion) throw new Error(JSON.stringify(pinnedRun))
  result = await request('/api/workflows', { method: 'POST', ...json(current) })
  if (!result.response.ok) throw new Error(JSON.stringify(result.body))
})

await test('production preparation requires explicitly selected exact evidence', async () => {
  const lifecycleBody = (action, exactCandidate, selectedGateResultIds, extra = {}) => ({ action, actor: 'evaluation-test', reason: `${action} fixture`, candidateId: exactCandidate.id, expectedWorkflowId: workflowId, expectedWorkflowVersion: exactCandidate.workflowVersion, expectedWorkflowHash: exactCandidate.sourceHash, expectedOperationalHash: exactCandidate.operationalHash, selectedGateResultIds, ...extra })
  let result = await request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json(lifecycleBody('prepare-testing', candidate, [exactRecord.id])) })
  if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json(lifecycleBody('approve-testing', candidate, [exactRecord.id])) })
  if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json(lifecycleBody('enter-testing', candidate, [exactRecord.id], { approvalDecisionId: result.body.lifecycle.testingApprovalId })) })
  if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  const testingCandidate = (await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'evaluation-test' }) })).body
  const started = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input: reportInput, candidateId: testingCandidate.id }) })
  const testingRun = await waitRun(started.body.runId)
  if (testingRun.status !== 'done') throw new Error(JSON.stringify(testingRun))
  const testingRecord = (await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId: started.body.runId }) })).body
  const missing = await request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json(lifecycleBody('prepare-production', testingCandidate, [])) })
  if (missing.response.status !== 409 || missing.body.code !== 'EXACT_EVALUATION_EVIDENCE_REQUIRED') throw new Error(JSON.stringify(missing.body))
  const prepared = await request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json(lifecycleBody('prepare-production', testingCandidate, [testingRecord.id])) })
  if (!prepared.response.ok || prepared.body.lifecycle.state !== 'production-candidate') throw new Error(JSON.stringify(prepared.body))
})

await request('/api/evaluations/' + evaluationId, { method: 'DELETE' })
await request('/api/evaluations/' + datasetSuiteId, { method: 'DELETE' })
await request('/api/evaluation-datasets/' + datasetId, { method: 'DELETE' })
await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })
await stopServer()
fs.rmSync(fixtureRoot, { recursive: true, force: true })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
