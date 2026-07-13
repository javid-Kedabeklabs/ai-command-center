import http from 'http'

const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 100; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }
async function run(workflow, input = '') { await request('/api/workflows', { method: 'POST', ...json(workflow) }); const started = await request(`/api/workflows/${workflow.id}/run`, { method: 'POST', ...json({ input }) }); return waitRun(started.body.runId) }
const chain = (id, node, settings = {}, extra = {}) => ({ schemaVersion: 2, id, name: id, settings, ...extra, nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, node, { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'a', source: 'in', target: node.id, ...(node.type === 'mcp' ? { targetHandle: 'arguments', data: { coercion: 'object' } } : {}) }, { id: 'b', source: node.id, target: 'out' }] })
async function enterTesting(workflowId) {
  const candidate = await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'security-policy-test' }) })
  if (!candidate.response.ok) throw new Error(JSON.stringify(candidate.body))
  const transition = async (action, extra = {}) => request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json({ action, actor: 'security-policy-test', reason: `${action} fixture`, candidateId: candidate.body.id, expectedWorkflowId: workflowId, expectedWorkflowVersion: candidate.body.workflowVersion, expectedWorkflowHash: candidate.body.sourceHash, expectedOperationalHash: candidate.body.operationalHash, selectedGateResultIds: [], ...extra }) })
  let result = await transition('prepare-testing'); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('approve-testing'); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('enter-testing', { approvalDecisionId: result.body.lifecycle.testingApprovalId }); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  return result.body.workflow
}

console.log('== permission and local-only enforcement ==')
await test('explicit node permission denial prevents shell execution', async () => {
  const result = await run(chain('security-shell-denied', { id: 'shell', type: 'shell', permissions: { 'execute-shell': false }, position: { x: 300, y: 0 }, data: { label: 'Denied shell', command: 'echo should-not-run' } }))
  if (result.status !== 'failed' || !result.events?.some(event => event.text.includes('not permitted to execute shell'))) throw new Error(JSON.stringify(result))
})

await test('Testing denies every high-risk capability not explicitly reviewed', async () => {
  const workflow = chain('security-testing-implicit-denial', { id: 'shell', type: 'shell', position: { x: 300, y: 0 }, data: { label: 'Implicitly denied shell', command: 'echo should-not-run' } })
  const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) }); if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
  await enterTesting(workflow.id)
  const started = await request(`/api/workflows/${workflow.id}/run`, { method: 'POST', ...json({ input: '' }) }); if (!started.response.ok) throw new Error(JSON.stringify(started.body))
  const result = await waitRun(started.body.runId)
  if (result.status !== 'failed' || !result.events?.some(event => event.text.includes('not permitted to execute shell'))) throw new Error(JSON.stringify(result))
})

await test('Testing permits an exact capability explicitly bound into its reviewed candidate', async () => {
  const workflow = chain('security-testing-explicit-grant', { id: 'shell', type: 'shell', position: { x: 300, y: 0 }, data: { label: 'Reviewed shell', command: 'printf explicit-grant-ok' } }, {}, { permissions: { 'execute-shell': true } })
  const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) }); if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
  await enterTesting(workflow.id)
  const started = await request(`/api/workflows/${workflow.id}/run`, { method: 'POST', ...json({ input: '' }) }); if (!started.response.ok) throw new Error(JSON.stringify(started.body))
  const result = await waitRun(started.body.runId)
  if (result.status !== 'done' || !String(result.result).includes('explicit-grant-ok')) throw new Error(JSON.stringify(result))
})

await test('custom nodes and plugins reject unknown capability names', async () => {
  const custom = await request('/api/custom-nodes', { method: 'POST', ...json({ id: 'security-unknown-capability', name: 'Unsafe custom', permissions: ['invented-root-access'], implementation: { kind: 'transform' } }) })
  const plugin = await request('/api/plugins/install', { method: 'POST', ...json({ bundle: { id: 'security-unknown-plugin-capability', name: 'Unsafe plugin', version: '1.0.0', permissions: ['invented-root-access'] } }) })
  if (custom.response.status !== 400 || plugin.response.status !== 400) throw new Error(JSON.stringify({ custom: custom.body, plugin: plugin.body }))
})

await test('local-only policy rejects remote HTTP before network activity', async () => {
  const result = await run(chain('security-http-remote', { id: 'http', type: 'http', position: { x: 300, y: 0 }, data: { label: 'Remote HTTP', url: 'https://example.com/never-called' } }, { localOnly: true }))
  if (result.status !== 'failed' || !result.events?.some(event => event.text.includes('blocked from remote network access'))) throw new Error(JSON.stringify(result))
})

await test('local-only policy allows loopback services', async () => {
  const fixture = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('loopback-ok') }); await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  try { const result = await run(chain('security-http-loopback', { id: 'http', type: 'http', position: { x: 300, y: 0 }, data: { label: 'Loopback HTTP', url: `http://127.0.0.1:${fixture.address().port}` } }, { localOnly: true })); if (result.status !== 'done' || !String(result.result).includes('loopback-ok')) throw new Error(JSON.stringify(result)) } finally { await new Promise(resolve => fixture.close(resolve)) }
})

await test('local-only policy rejects remote MCP transport before invocation', async () => {
  await request('/api/tools/mcp', { method: 'POST', ...json({ name: 'security-remote-mcp', url: 'https://example.com/mcp' }) })
  const result = await run(chain('security-mcp-remote', { id: 'mcp', type: 'mcp', position: { x: 300, y: 0 }, data: { label: 'Remote MCP', server: 'security-remote-mcp', tool: 'echo' } }, { localOnly: true }), '{}')
  if (result.status !== 'failed' || !result.events?.some(event => event.text.includes('blocked from remote MCP access'))) throw new Error(JSON.stringify(result))
  await request('/api/tools/mcp/security-remote-mcp', { method: 'DELETE' })
})

for (const id of ['security-shell-denied','security-testing-implicit-denial','security-testing-explicit-grant','security-http-remote','security-http-loopback','security-mcp-remote']) await request(`/api/workflows/${id}`, { method: 'DELETE' })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
