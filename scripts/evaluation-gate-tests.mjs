const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 100; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }

console.log('== evaluation attachment and production gates ==')
const workflowId = 'evaluation-gate-fixture', evaluationId = 'evaluation-gate-suite'
const workflow = { schemaVersion: 2, id: workflowId, name: 'Evaluation gate fixture', nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'in', target: 'out' }], evaluations: [evaluationId], governance: { promotionGates: { evaluations: [evaluationId] } } }

await test('a missing or failing required evaluation blocks production promotion', async () => {
  await request('/api/evaluations/' + evaluationId, { method: 'DELETE' }); await request('/api/workflows/' + workflowId, { method: 'DELETE' })
  await request('/api/workflows', { method: 'POST', ...json(workflow) })
  await request('/api/evaluations', { method: 'POST', ...json({ id: evaluationId, name: 'Required quality', workflowId, checks: [{ type: 'contains', value: 'APPROVED' }] }) })
  const blocked = await request(`/api/workflows/${workflowId}/promote`, { method: 'POST', ...json({ by: 'test' }) })
  if (blocked.response.status !== 409 || !blocked.body.failedGates?.includes(evaluationId)) throw new Error(JSON.stringify(blocked.body))
})

let runId
await test('evaluation results attach to a persisted real workflow run', async () => {
  const started = await request(`/api/workflows/${workflowId}/run`, { method: 'POST', ...json({ input: 'APPROVED fixture result' }) }); runId = started.body.runId; const run = await waitRun(runId); if (run.status !== 'done') throw new Error(JSON.stringify(run))
  const evaluated = await request(`/api/evaluations/${evaluationId}/run`, { method: 'POST', ...json({ runId }) }); if (!evaluated.body.passed) throw new Error(JSON.stringify(evaluated.body))
  const detail = await request(`/api/runs/${runId}/detail`); if (!detail.body.evaluations?.some(item => item.evaluationId === evaluationId && item.passed)) throw new Error('persisted run is missing evaluation provenance')
})

await test('latest passing required evaluation unlocks production promotion', async () => {
  const promoted = await request(`/api/workflows/${workflowId}/promote`, { method: 'POST', ...json({ by: 'test', approval: 'evaluation evidence' }) }); if (!promoted.response.ok || !promoted.body.governance?.locked) throw new Error(JSON.stringify(promoted.body))
  await request(`/api/workflows/${workflowId}/unlock`, { method: 'POST', ...json({ reason: 'fixture cleanup' }) })
})

await request('/api/evaluations/' + evaluationId, { method: 'DELETE' }); await request('/api/workflows/' + workflowId, { method: 'DELETE' })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
