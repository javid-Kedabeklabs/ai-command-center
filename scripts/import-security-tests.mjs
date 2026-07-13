const base = 'http://127.0.0.1:1717'; let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, method = 'GET', body) { const response = await fetch(base + route, { method, headers: body == null ? {} : { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }); const text = await response.text(); let value; try { value = JSON.parse(text) } catch { value = text }; return { response, body: value } }

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
  const installed = await request(`/api/bundle/import/${proposalId}/decision`, 'POST', { decision: 'approve' }); if (!installed.response.ok) throw new Error(JSON.stringify(installed.body))
  const [agents, workflow] = await Promise.all([request('/api/agents'), request(`/api/workflows/${workflowId}`)]), agent = agents.body.find(item => item.id === agentId)
  if (agent?.permissions !== 'standard' || workflow.body.environment !== 'development' || workflow.body.governance?.status !== 'imported-review') throw new Error(JSON.stringify({ agent, workflow: workflow.body }))
})
await request(`/api/agents/${agentId}`, 'DELETE'); await request(`/api/workflows/${workflowId}`, 'DELETE')
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`); process.exitCode = failed ? 1 : 0
