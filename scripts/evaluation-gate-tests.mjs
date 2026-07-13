const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 100; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }

console.log('== exact candidate evaluation evidence ==')
const workflowId = 'evaluation-gate-fixture', evaluationId = 'evaluation-gate-suite'
const workflow = { schemaVersion: 2, id: workflowId, name: 'Evaluation gate fixture', nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'in', target: 'out' }], evaluations: [evaluationId], governance: { promotionGates: { evaluations: [evaluationId] } } }
let candidate, secondCandidate, runId, exactRecord

await request('/api/evaluations/' + evaluationId, { method: 'DELETE' })
await request(`/api/workflows/${workflowId}/unlock`, { method: 'POST', ...json({ reason: 'fixture reset' }) })
await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })

await test('empty and unknown evaluation checks fail closed', async () => {
  const empty = await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Empty', workflowId, checks: [] }) })
  const unknown = await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Unknown', workflowId, checks: [{ type: 'model-vote' }] }) })
  if (empty.response.status !== 400 || empty.body.code !== 'EMPTY_EVALUATION_SUITE' || unknown.response.status !== 400 || unknown.body.code !== 'UNKNOWN_EVALUATION_CHECK') throw new Error(JSON.stringify({ empty: empty.body, unknown: unknown.body }))
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
  const started = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input: 'APPROVED fixture result', candidateId: candidate.id }) })
  runId = started.body.runId
  const run = await waitRun(runId)
  if (run.status !== 'done' || run.candidateId !== candidate.id || run.operationalHash !== candidate.operationalHash) throw new Error(JSON.stringify(run))
  const evaluated = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId }) })
  exactRecord = evaluated.body
  if (!exactRecord.passed || !exactRecord.promotable || exactRecord.candidateId !== candidate.id || exactRecord.runId !== runId) throw new Error(JSON.stringify(exactRecord))
  const detail = await request(`/api/runs/${runId}/detail`)
  if (!detail.body.evaluations?.some(item => item.id === exactRecord.id && item.promotable)) throw new Error('persisted run is missing exact evaluation provenance')
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
  const edited = await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Required quality v2', workflowId, checks: [{ type: 'contains', value: 'APPROVED' }, { type: 'min-length', value: 5 }] }) })
  if (!edited.response.ok || edited.body.definitionHash === exactRecord.suiteDefinitionHash) throw new Error(JSON.stringify(edited.body))
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
  result = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input: 'APPROVED fixture result', candidateId: candidate.id }) })
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
  const started = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input: 'APPROVED testing result', candidateId: testingCandidate.id }) })
  const testingRun = await waitRun(started.body.runId)
  if (testingRun.status !== 'done') throw new Error(JSON.stringify(testingRun))
  const testingRecord = (await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId: started.body.runId }) })).body
  const missing = await request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json(lifecycleBody('prepare-production', testingCandidate, [])) })
  if (missing.response.status !== 409 || missing.body.code !== 'EXACT_EVALUATION_EVIDENCE_REQUIRED') throw new Error(JSON.stringify(missing.body))
  const prepared = await request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json(lifecycleBody('prepare-production', testingCandidate, [testingRecord.id])) })
  if (!prepared.response.ok || prepared.body.lifecycle.state !== 'production-candidate') throw new Error(JSON.stringify(prepared.body))
})

await request('/api/evaluations/' + evaluationId, { method: 'DELETE' })
await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
