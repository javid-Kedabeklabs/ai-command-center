const base = process.env.CC_URL || 'http://127.0.0.1:1717'; let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, method = 'GET', body) { const response = await fetch(base + route, { method, headers: body == null ? {} : { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }); const text = await response.text(); let value; try { value = JSON.parse(text) } catch { value = text }; return { response, body: value } }
async function deployExact(workflowId) {
  const transition = async (action, candidate, selectedGateResultIds = [], extra = {}) => request(`/api/workflows/${workflowId}/lifecycle`, 'POST', { action, actor: 'import-security-test', reason: `${action} fixture`, candidateId: candidate.id, expectedWorkflowId: workflowId, expectedWorkflowVersion: candidate.workflowVersion, expectedWorkflowHash: candidate.sourceHash, expectedOperationalHash: candidate.operationalHash, selectedGateResultIds, ...extra })
  const development = await request(`/api/workflows/${workflowId}/candidates`, 'POST', { by: 'import-security-test' }); if (!development.response.ok) throw new Error(JSON.stringify(development.body))
  let result = await transition('prepare-testing', development.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('approve-testing', development.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('enter-testing', development.body, [], { approvalDecisionId: result.body.lifecycle.testingApprovalId }); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  const testing = await request(`/api/workflows/${workflowId}/candidates`, 'POST', { by: 'import-security-test' }); if (!testing.response.ok) throw new Error(JSON.stringify(testing.body))
  result = await transition('prepare-production', testing.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('approve-production', testing.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('deploy-production', testing.body, [], { approvalDecisionId: result.body.lifecycle.productionApprovalId }); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  return result.body.workflow
}

console.log('== portable import security ==')
const agentId = 'import-security-agent', workflowId = 'import-security-workflow'
await request(`/api/agents/${agentId}`, 'DELETE'); await request(`/api/workflows/${workflowId}`, 'DELETE')
const bundle = { version: 1, agents: [{ id: agentId, name: 'Imported agent', avatar: '🤖', model: 'lmstudio/fixture', prompt: 'Imported prompt', permissions: 'full' }], workflows: [{ schemaVersion: 2, id: workflowId, name: 'Imported executable workflow', nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'shell', type: 'shell', position: { x: 300, y: 0 }, data: { label: 'Shell', command: 'cat' } }, { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'a', source: 'in', target: 'shell' }, { id: 'b', source: 'shell', target: 'out' }] }], profiles: [], brain: {} }
let proposalId
await test('import is staged with executable risks and does not mutate state', async () => {
  const staged = await request('/api/bundle/import', 'POST', bundle); proposalId = staged.body.proposalId
  if (staged.response.status !== 202 || staged.body.status !== 'review-required' || !staged.body.risks.some(risk => risk.includes('executable'))) throw new Error(JSON.stringify(staged.body))
  const [agents, workflow] = await Promise.all([request('/api/agents'), request(`/api/workflows/${workflowId}`)]); if (agents.body.some(agent => agent.id === agentId) || workflow.response.status !== 404) throw new Error('staging mutated product state')
})
await test('explicit approval installs in development with safe agent permissions', async () => {
  const installed = await request(`/api/bundle/import/${proposalId}/decision`, 'POST', { decision: 'approve', preservePermissions: true }); if (!installed.response.ok) throw new Error(JSON.stringify(installed.body))
  const [agents, workflow] = await Promise.all([request('/api/agents'), request(`/api/workflows/${workflowId}`)]), agent = agents.body.find(item => item.id === agentId)
  if (agent?.permissions !== 'standard' || workflow.body.environment !== 'development' || workflow.body.governance?.status !== 'imported-review') throw new Error(JSON.stringify({ agent, workflow: workflow.body }))
  const replay = await request(`/api/bundle/import/${proposalId}/decision`, 'POST', { decision: 'approve' })
  if (replay.response.status !== 409) throw new Error('an approved import decision was reusable')
})
await test('reserved fields and unsafe workflow ids are rejected before staging', async () => {
  const reserved = structuredClone(bundle); reserved.workflows[0]._unlock = true
  const escaped = structuredClone(bundle); escaped.workflows[0].id = '../../escape'
  const [reservedResult, escapedResult] = await Promise.all([request('/api/bundle/import', 'POST', reserved), request('/api/bundle/import', 'POST', escaped)])
  if (reservedResult.response.status !== 400 || escapedResult.response.status !== 400) throw new Error(JSON.stringify({ reserved: reservedResult.body, escaped: escapedResult.body }))
})
await test('explicit overwrite cannot replace a Production workflow identity', async () => {
  const promoted = await deployExact(workflowId)
  if (promoted.environment !== 'production') throw new Error(JSON.stringify(promoted))
  const staged = await request('/api/bundle/import', 'POST', bundle)
  const denied = await request(`/api/bundle/import/${staged.body.proposalId}/decision`, 'POST', { decision: 'approve', overwrite: true })
  if (denied.response.status !== 423 || denied.body.code !== 'GOVERNANCE_LOCKED') throw new Error(JSON.stringify(denied.body))
  const persisted = await request(`/api/workflows/${workflowId}`)
  if (persisted.body.environment !== 'production' || persisted.body.governance?.locked !== true) throw new Error('denied overwrite changed Production')
})
await request(`/api/agents/${agentId}`, 'DELETE'); await request(`/api/workflows/${workflowId}`, 'DELETE')
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`); process.exitCode = failed ? 1 : 0
