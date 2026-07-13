const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitRun(id) { for (let i = 0; i < 100; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('run timed out') }
const customWorkflow = (id, customNodeId) => ({ schemaVersion: 2, id, name: id, nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'custom', type: 'custom', position: { x: 300, y: 0 }, data: { label: 'Custom', customNodeId } }, { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'a', source: 'in', target: 'custom' }, { id: 'b', source: 'custom', target: 'out' }] })
async function execute(id, input = 'fixture') { const started = await request(`/api/workflows/${id}/run`, { method: 'POST', ...json({ input }) }); if (!started.body.runId) throw new Error(JSON.stringify(started.body)); return waitRun(started.body.runId) }

console.log('== custom-node and plugin lifecycle ==')
let first, second
await test('custom-node updates retain bounded definition version history', async () => {
  first = (await request('/api/custom-nodes', { method: 'POST', ...json({ id: 'versioned-fixture', name: 'Versioned fixture', inputs: [{ id: 'input', type: 'any' }], outputs: [{ id: 'output', type: 'any' }], implementation: { kind: 'transform', mode: 'select', selector: '' } }) })).body
  second = (await request('/api/custom-nodes', { method: 'POST', ...json({ id: 'versioned-fixture', name: 'Versioned fixture updated', inputs: [{ id: 'input', type: 'any' }], outputs: [{ id: 'output', type: 'any' }], implementation: { kind: 'transform', mode: 'select', selector: '' } }) })).body
  if (second.version <= first.version || second.versions?.[0]?.definition?.name !== first.name) throw new Error(JSON.stringify(second))
})

await test('disabled custom definitions are rejected at runtime', async () => {
  await request('/api/custom-nodes', { method: 'POST', ...json({ ...second, enabled: false, implementation: second.implementation }) })
  await request('/api/workflows', { method: 'POST', ...json(customWorkflow('disabled-custom-fixture', 'versioned-fixture')) })
  const run = await execute('disabled-custom-fixture'); if (run.status !== 'failed' || !run.events.some(event => event.text.includes('disabled custom node'))) throw new Error(JSON.stringify(run))
})

const pluginNode = { id: 'plugin-transform-fixture', name: 'Plugin transform', description: 'Fixture', inputs: [{ id: 'input', label: 'Input', type: 'any' }], outputs: [{ id: 'output', label: 'Output', type: 'any' }], permissions: [], implementation: { kind: 'transform', mode: 'select', selector: '' }, version: 1 }
let installedPlugin
await test('untrusted contributed node cannot execute before explicit review', async () => {
  const installed = await request('/api/plugins/install', { method: 'POST', ...json({ plugin: { id: 'extensibility-fixture', name: 'Extensibility fixture', version: '1.0.0', publisher: 'Tests', license: 'MIT', permissions: [], nodes: [pluginNode] } }) }); installedPlugin = installed.body; if (installed.body.enabled || installed.body.trustStatus !== 'untrusted' || !/^[a-f0-9]{64}$/.test(installed.body.manifestHash || '')) throw new Error(JSON.stringify(installed.body))
  await request('/api/workflows', { method: 'POST', ...json(customWorkflow('plugin-runtime-fixture', pluginNode.id)) })
  const run = await execute('plugin-runtime-fixture'); if (run.status !== 'failed' || !run.events.some(event => /disabled custom node|untrusted or disabled plugin/.test(event.text))) throw new Error(JSON.stringify(run))
})

await test('review and enable propagates to contributed nodes and permits execution', async () => {
  const stale = await request('/api/plugins/extensibility-fixture/review', { method: 'POST', ...json({ decision: 'approve', by: 'test', expectedManifestHash: '0'.repeat(64) }) }); if (stale.response.status !== 409) throw new Error(JSON.stringify(stale.body))
  const reviewed = await request('/api/plugins/extensibility-fixture/review', { method: 'POST', ...json({ decision: 'approve', by: 'test', expectedManifestHash: installedPlugin.manifestHash }) }); if (reviewed.body.reviewReceipt?.manifestHash !== installedPlugin.manifestHash) throw new Error(JSON.stringify(reviewed.body))
  const enabled = await request('/api/plugins/extensibility-fixture/toggle', { method: 'POST', ...json({ enabled: true }) }); if (!enabled.body.enabled) throw new Error(JSON.stringify(enabled.body))
  const run = await execute('plugin-runtime-fixture', '"trusted-output"'); if (run.status !== 'done' || !String(run.result).includes('trusted-output')) throw new Error(JSON.stringify(run))
})

await test('plugin uninstall removes contributed definitions without executing them', async () => {
  await request('/api/plugins/extensibility-fixture', { method: 'DELETE' }); const definitions = await request('/api/custom-nodes'); if (definitions.body.some(node => node.pluginId === 'extensibility-fixture')) throw new Error('contributed node remains installed')
  const run = await execute('plugin-runtime-fixture'); if (run.status !== 'failed' || !run.events.some(event => event.text.includes('not installed'))) throw new Error(JSON.stringify(run))
})

for (const workflow of ['disabled-custom-fixture','plugin-runtime-fixture']) await request(`/api/workflows/${workflow}`, { method: 'DELETE' }); await request('/api/custom-nodes/versioned-fixture', { method: 'DELETE' })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
