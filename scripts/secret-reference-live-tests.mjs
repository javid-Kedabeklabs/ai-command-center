import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'

const base = process.env.COMMAND_CENTER_URL || 'http://127.0.0.1:1717'
const suffix = crypto.randomBytes(6).toString('hex'), referenceId = `test.live.${suffix}`, secret = `fixture-${crypto.randomBytes(18).toString('base64url')}`
const workflowIds = [`secret-http-${suffix}`, `secret-mcp-${suffix}`, `secret-http-denied-${suffix}`], mcpId = `secret-mcp-${suffix}`
let passed = 0, failed = 0, authorizedCalls = 0, unauthorizedCalls = 0, revision = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const secretWrite = body => ({ headers: { 'content-type': 'application/json', 'x-command-center-intent': 'secret-reference-change' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 120; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }
async function deployExact(workflowId) {
  const transition = async (action, candidate, extra = {}) => request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json({ action, actor: 'secret-reference-live-test', reason: `${action} fixture`, candidateId: candidate.id, expectedWorkflowId: workflowId, expectedWorkflowVersion: candidate.workflowVersion, expectedWorkflowHash: candidate.sourceHash, expectedOperationalHash: candidate.operationalHash, selectedGateResultIds: [], ...extra }) })
  const development = await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'secret-reference-live-test' }) }); if (!development.response.ok) throw new Error(JSON.stringify(development.body))
  let result = await transition('prepare-testing', development.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('approve-testing', development.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('enter-testing', development.body, { approvalDecisionId: result.body.lifecycle.testingApprovalId }); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  const testing = await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'secret-reference-live-test' }) }); if (!testing.response.ok) throw new Error(JSON.stringify(testing.body))
  result = await transition('prepare-production', testing.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('approve-production', testing.body); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await transition('deploy-production', testing.body, { approvalDecisionId: result.body.lifecycle.productionApprovalId }); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  return result.body.workflow
}

const fixture = http.createServer(async (req, res) => {
  const authorized = req.headers.authorization === `Bearer ${secret}`
  authorized ? authorizedCalls++ : unauthorizedCalls++
  if (!authorized) { res.writeHead(401); return res.end('denied') }
  if (req.url === '/http') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('authorized-http-ok') }
  let raw = ''; for await (const chunk of req) raw += chunk
  const message = JSON.parse(raw || '{}'); let result = {}
  if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'authenticated-fixture', version: '1' } }
  if (message.method === 'tools/list') result = { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
  if (message.method === 'tools/call') result = { structuredContent: { authenticated: true } }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', ...(message.id ? { id: message.id } : {}), result }))
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const fixtureBase = `http://127.0.0.1:${fixture.address().port}`

console.log('== live Keychain secret reference execution ==')
try {
  await test('create stores a Keychain value but returns metadata only', async () => {
    const created = await request('/api/secret-references', { method: 'POST', ...secretWrite({ id: referenceId, label: 'Disposable live fixture', value: secret }) })
    if (created.response.status !== 201) throw new Error(JSON.stringify(created.body))
    revision = created.body.revision
    if (JSON.stringify(created.body).includes(secret) || created.response.headers.get('cache-control') !== 'no-store') throw new Error('secret was disclosed or cacheable')
  })
  await test('HTTP workflow resolves the bearer reference only during transport', async () => {
    const workflow = { schemaVersion: 2, id: workflowIds[0], name: 'Secret HTTP live fixture', settings: { localOnly: true }, secretReferences: [{ id: referenceId, purpose: 'http' }], nodes: [{ id: 'http', type: 'http', position: { x: 0, y: 0 }, data: { label: 'Authenticated HTTP', url: `${fixtureBase}/http`, authRef: referenceId, authMode: 'bearer' } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'http', target: 'out' }] }
    const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) }); if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
    const started = await request(`/api/workflows/${workflow.id}/run`, { method: 'POST', ...json({ input: '' }) }); const run = await waitRun(started.body.runId)
    if (run.status !== 'done' || !String(run.result).includes('authorized-http-ok') || JSON.stringify(run).includes(secret)) throw new Error(JSON.stringify(run))
  })
  await test('production lock and node permissions prevent reference-bearing workflow changes or use', async () => {
    const promoted = await deployExact(workflowIds[0])
    const lockedSave = await request('/api/workflows', { method: 'POST', ...json({ ...promoted, secretReferences: [] }) }); if (lockedSave.response.status !== 423) throw new Error(`locked save returned ${lockedSave.response.status}`)
    const unlocked = await request(`/api/workflows/${workflowIds[0]}/unlock`, { method: 'POST', ...json({ reason: 'fixture permission check' }) }); if (unlocked.response.status !== 409 || unlocked.body.code !== 'LIFECYCLE_DEVELOPMENT_REVISION_REQUIRED') throw new Error(JSON.stringify(unlocked.body))
    const before = authorizedCalls, deniedWorkflow = { ...promoted, id: workflowIds[2], environment: 'development', governance: { status: 'draft', locked: false }, nodes: promoted.nodes.map(node => node.type === 'http' ? { ...node, permissions: { network: false } } : node) }
    const saved = await request('/api/workflows', { method: 'POST', ...json(deniedWorkflow) }); if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
    const started = await request(`/api/workflows/${workflowIds[2]}/run`, { method: 'POST', ...json({ input: '' }) }); const run = await waitRun(started.body.runId)
    if (run.status !== 'failed' || authorizedCalls !== before || !run.events?.some(event => String(event.text).includes('not permitted'))) throw new Error(JSON.stringify(run))
  })
  await test('remote MCP discovery and execution use the same ephemeral reference', async () => {
    const created = await request('/api/tools/mcp', { method: 'POST', ...json({ name: mcpId, url: `${fixtureBase}/mcp`, authRef: referenceId, authMode: 'bearer' }) }); if (created.response.status !== 201) throw new Error(JSON.stringify(created.body))
    const discovered = await request(`/api/tools/mcp/${mcpId}/discover`, { method: 'POST', ...json({}) }); if (!discovered.response.ok || discovered.body.tools?.[0]?.name !== 'echo') throw new Error(JSON.stringify(discovered.body))
    const workflow = { schemaVersion: 2, id: workflowIds[1], name: 'Secret MCP live fixture', settings: { localOnly: true }, secretReferences: [{ id: referenceId, purpose: 'mcp' }], nodes: [{ id: 'mcp', type: 'mcp', position: { x: 0, y: 0 }, data: { label: 'Authenticated MCP', server: mcpId, tool: 'echo', arguments: {} } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'mcp', target: 'out' }] }
    await request('/api/workflows', { method: 'POST', ...json(workflow) }); const started = await request(`/api/workflows/${workflow.id}/run`, { method: 'POST', ...json({ input: '' }) }); const run = await waitRun(started.body.runId)
    if (run.status !== 'done' || !JSON.stringify(run.result).includes('authenticated') || JSON.stringify(run).includes(secret)) throw new Error(JSON.stringify(run))
    if (unauthorizedCalls !== 0 || authorizedCalls < 5) throw new Error(`unexpected authorization counts: ${authorizedCalls}/${unauthorizedCalls}`)
  })
  await test('canonical files and public APIs never persist the resolved value', async () => {
    const publicData = await Promise.all(['/api/secret-references', '/api/tools', '/api/bundle/export', ...workflowIds.map(id => `/api/workflows/${id}`)].map(route => request(route)))
    if (JSON.stringify(publicData.map(item => item.body)).includes(secret)) throw new Error('public API leaked the resolved value')
    const files = [`${process.env.HOME}/.config/opencode/opencode.json`]
    const walk = directory => { if (!fs.existsSync(directory)) return; for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = `${directory}/${entry.name}`; if (entry.isDirectory()) walk(file); else if (entry.isFile() && fs.statSync(file).size <= 50 * 1024 * 1024) files.push(file) } }
    walk('data')
    for (const file of files) if (fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(secret))) throw new Error(`secret persisted in ${file}`)
  })
} finally {
  for (const id of workflowIds) await request(`/api/workflows/${id}`, { method: 'DELETE' }).catch(() => {})
  await request(`/api/tools/mcp/${mcpId}`, { method: 'DELETE' }).catch(() => {})
  if (revision) await request(`/api/secret-references/${referenceId}`, { method: 'DELETE', ...secretWrite({ expectedRevision: revision }) }).catch(() => {})
  await new Promise(resolve => fixture.close(resolve))
}
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
if (failed) process.exit(1)
