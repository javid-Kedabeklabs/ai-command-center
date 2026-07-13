const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function run(id, input) { const started = await request(`/api/workflows/${id}/run`, { method: 'POST', ...json({ input }) }); for (let i = 0; i < 100; i++) { const detail = await request(`/api/runs/${started.body.runId}/detail`); if (!['running', 'paused'].includes(detail.body.status)) return detail.body; await new Promise(resolve => setTimeout(resolve, 40)) } throw new Error('run timed out') }

console.log('== safe deterministic workflow cache ==')
const workflowId = `cache-fixture-${Date.now()}-${process.pid}`
const workflow = { schemaVersion: 2, id: workflowId, name: 'Cache fixture', settings: { cache: true }, nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'transform', type: 'json-transform', position: { x: 300, y: 0 }, data: { label: 'Pure transform', selector: 'value', pretty: false } }, { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'a', source: 'in', target: 'transform', targetHandle: 'input', data: { coercion: 'object' } }, { id: 'b', source: 'transform', target: 'out' }] }
await request('/api/workflows', { method: 'POST', ...json(workflow) })
await test('first deterministic execution stores the computed output', async () => { const result = await run(workflowId, '{"value":"cached-result"}'); if (result.status !== 'done' || result.events.some(event => event.text.includes('reused verified cached'))) throw new Error(JSON.stringify(result)) })
await test('identical second execution reuses the persisted verified output', async () => { const result = await run(workflowId, '{"value":"cached-result"}'); if (result.status !== 'done' || !result.events.some(event => event.text.includes('reused verified cached')) || !String(result.result).includes('cached-result')) throw new Error(JSON.stringify(result)) })
await test('different input does not reuse the prior cache key', async () => { const result = await run(workflowId, '{"value":"new-result"}'); if (result.events.some(event => event.text.includes('reused verified cached')) || !String(result.result).includes('new-result')) throw new Error(JSON.stringify(result)) })
await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`); process.exitCode = failed ? 1 : 0
