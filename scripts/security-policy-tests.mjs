import http from 'http'

const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 100; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }
async function run(workflow, input = '') { await request('/api/workflows', { method: 'POST', ...json(workflow) }); const started = await request(`/api/workflows/${workflow.id}/run`, { method: 'POST', ...json({ input }) }); return waitRun(started.body.runId) }
const chain = (id, node, settings = {}) => ({ schemaVersion: 2, id, name: id, settings, nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, node, { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'a', source: 'in', target: node.id, ...(node.type === 'mcp' ? { targetHandle: 'arguments', data: { coercion: 'object' } } : {}) }, { id: 'b', source: node.id, target: 'out' }] })

console.log('== permission and local-only enforcement ==')
await test('explicit node permission denial prevents shell execution', async () => {
  const result = await run(chain('security-shell-denied', { id: 'shell', type: 'shell', permissions: { 'execute-shell': false }, position: { x: 300, y: 0 }, data: { label: 'Denied shell', command: 'echo should-not-run' } }))
  if (result.status !== 'failed' || !result.events?.some(event => event.text.includes('not permitted to execute shell'))) throw new Error(JSON.stringify(result))
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

for (const id of ['security-shell-denied','security-http-remote','security-http-loopback','security-mcp-remote']) await request(`/api/workflows/${id}`, { method: 'DELETE' })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
