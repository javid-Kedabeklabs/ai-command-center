import http from 'http'
import path from 'path'

const base = process.env.COMMAND_CENTER_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(`${base}${route}`, options); let body; try { body = await response.json() } catch { body = {} }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 80; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }

console.log('== MCP transports and discovery ==')
const fixture = path.resolve('scripts/fixtures/mcp-echo-server.mjs')
const remote = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const message = JSON.parse(raw || '{}'); let result = {}
  if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'remote-fixture', version: '1' } }
  if (message.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Remote deterministic echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] }
  if (message.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(message.params?.arguments || {}) }], structuredContent: message.params?.arguments || {} }
  res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
})
await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve))
const remoteUrl = `http://127.0.0.1:${remote.address().port}`

await test('local stdio discovery returns the real tool schema', async () => {
  const created = await request('/api/tools/mcp', { method: 'POST', ...json({ name: 'mcp-discovery-local', command: [process.execPath, fixture] }) })
  if (created.response.status !== 201 || created.body.reviewRequired !== true || created.body.server?.status !== 'review required') throw new Error(JSON.stringify(created.body))
  const blocked = await request('/api/tools/mcp/mcp-discovery-local/discover', { method: 'POST', ...json({}) })
  if (blocked.response.ok || !String(blocked.body.error).match(/disabled|review/i)) throw new Error(`unreviewed local server was not blocked: ${JSON.stringify(blocked.body)}`)
  const reviewed = await request('/api/tools/mcp/mcp-discovery-local', { method: 'PUT', ...json({ reviewed: true, enabled: true }) })
  if (!reviewed.response.ok || reviewed.body.server?.trustStatus !== 'trusted-local') throw new Error(JSON.stringify(reviewed.body))
  const discovered = await request('/api/tools/mcp/mcp-discovery-local/discover', { method: 'POST', ...json({}) })
  if (!discovered.response.ok || discovered.body.tools?.[0]?.name !== 'echo' || !discovered.body.tools[0].inputSchema) throw new Error(JSON.stringify(discovered.body))
})

await test('duplicate server ids never silently overwrite', async () => {
  const duplicate = await request('/api/tools/mcp', { method: 'POST', ...json({ name: 'mcp-discovery-local', command: [process.execPath, fixture] }) })
  if (duplicate.response.status !== 409 || !String(duplicate.body.error).includes('overwrite is not allowed')) throw new Error(JSON.stringify(duplicate.body))
})

await test('remote Streamable HTTP discovery returns tool schemas', async () => {
  await request('/api/tools/mcp', { method: 'POST', ...json({ name: 'mcp-discovery-remote', url: remoteUrl }) })
  const discovered = await request('/api/tools/mcp/mcp-discovery-remote/discover', { method: 'POST', ...json({}) })
  if (!discovered.response.ok || discovered.body.tools?.[0]?.name !== 'echo' || discovered.body.tools[0].provenance?.serverVersion !== '1') throw new Error(JSON.stringify(discovered.body))
  const registry = await request('/api/tools')
  const stored = registry.body.mcp?.find(server => server.id === 'mcp-discovery-remote')?.discoveredTools?.[0]
  if (stored?.name !== 'echo' || JSON.stringify(stored).match(/authorization|fixture-session/i)) throw new Error(`unsafe or missing stored schema: ${JSON.stringify(stored)}`)
})

await test('remote Streamable HTTP MCP node executes', async () => {
  const workflow = { schemaVersion: 2, id: 'mcp-remote-fixture', name: 'Remote MCP fixture', nodes: [{ id: 'mcp', type: 'mcp', position: { x: 0, y: 0 }, data: { label: 'Remote echo', server: 'mcp-discovery-remote', tool: 'echo', arguments: { message: 'remote-ok' } } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'mcp', target: 'out' }] }
  const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) }); if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
  const started = await request('/api/workflows/mcp-remote-fixture/run', { method: 'POST', ...json({ input: '' }) }); if (!started.response.ok || !started.body.runId) throw new Error(`run start ${started.response.status}: ${JSON.stringify(started.body)}`); const run = await waitRun(started.body.runId)
  if (run.status !== 'done' || !JSON.stringify(run.result).includes('remote-ok')) throw new Error(JSON.stringify(run))
})

for (const name of ['mcp-discovery-local', 'mcp-discovery-remote']) await request(`/api/tools/mcp/${name}`, { method: 'DELETE' })
await request('/api/workflows/mcp-remote-fixture', { method: 'DELETE' })
await new Promise(resolve => remote.close(resolve))
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
