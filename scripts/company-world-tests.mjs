const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

console.log('== Company World real-state consistency ==')
await test('operations map derives departments and agents from persisted backend state', async () => {
  const [world, agents] = await Promise.all([request('/api/company-world/state'), request('/api/agents')])
  if (!world.response.ok || world.body.agents.length !== agents.body.length) throw new Error('world agent count does not match agent store')
  const assigned = new Set(world.body.departments.flatMap(department => department.agentIds)); if (world.body.agents.some(agent => !assigned.has(agent.id))) throw new Error('an agent is absent from every department')
})

let runId
await test('active workflow appears only after a real run starts', async () => {
  const workflow = { schemaVersion: 2, id: 'company-world-fixture', name: 'Company World fixture', nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'wait', type: 'delay', position: { x: 300, y: 0 }, data: { label: 'Real active work', durationMs: 1200 } }, { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'a', source: 'in', target: 'wait' }, { id: 'b', source: 'wait', target: 'out' }] }
  await request('/api/workflows', { method: 'POST', ...json(workflow) }); const started = await request('/api/workflows/company-world-fixture/run', { method: 'POST', ...json({ input: 'state fixture' }) }); runId = started.body.runId
  await new Promise(resolve => setTimeout(resolve, 150)); const world = await request('/api/company-world/state'); const live = world.body.activeRuns.find(run => run.id === runId)
  if (!live || live.workflowId !== 'company-world-fixture' || live.status !== 'running') throw new Error(JSON.stringify(world.body.activeRuns))
})

await test('completed workflow disappears from active visualization', async () => {
  for (let i = 0; i < 40; i++) { const detail = await request(`/api/runs/${runId}/detail`); if (detail.body.status === 'done') break; await new Promise(resolve => setTimeout(resolve, 75)) }
  const world = await request('/api/company-world/state'); if (world.body.activeRuns.some(run => run.id === runId)) throw new Error('completed run is still presented as active')
  await request('/api/workflows/company-world-fixture', { method: 'DELETE' })
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
