const base = process.env.CC_URL || 'http://127.0.0.1:1717'
let passed = 0

const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function request(path, options = {}) {
  const response = await fetch(base + path, options)
  const body = await response.json().catch(() => ({}))
  return { response, body }
}
async function test(name, fn) {
  await fn(); passed++; console.log(`PASS ${name}`)
}
async function waitRun(runId, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const { body } = await request(`/api/runs/${runId}/detail`)
    if (body.status && !['running', 'paused'].includes(body.status)) return body
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`run ${runId} did not finish`)
}
const workflow = (id, command, branches = 2) => ({
  schemaVersion: 2,
  id,
  name: id,
  settings: { parallelism: branches, resources: { maxModelCalls: 1, maxSubprocesses: 1, maxHttpRequests: 1, maxMcpCalls: 1 } },
  nodes: [
    { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
    ...Array.from({ length: branches }, (_, i) => ({ id: `shell-${i}`, type: 'shell', position: { x: 300, y: i * 100 }, data: { label: `Shell ${i}`, command } })),
    { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } },
  ],
  edges: [
    ...Array.from({ length: branches }, (_, i) => ({ id: `in-${i}`, source: 'in', target: `shell-${i}` })),
    ...Array.from({ length: branches }, (_, i) => ({ id: `out-${i}`, source: `shell-${i}`, target: 'out' })),
  ],
})

console.log('== runtime resource integration ==')

await test('workflow API rejects invalid resource policy', async () => {
  const invalid = workflow('resource-invalid-fixture', 'echo no')
  invalid.settings.resources.maxSubprocesses = 0
  const { response, body } = await request('/api/workflows', { method: 'POST', ...json(invalid) })
  if (response.status !== 400 || !String(body.error).includes('maxSubprocesses')) throw new Error(`${response.status}: ${JSON.stringify(body)}`)
})

await test('real parallel workflow honors configured subprocess bound', async () => {
  const id = 'resource-bound-fixture'
  const saved = await request('/api/workflows', { method: 'POST', ...json(workflow(id, 'sleep 0.25; echo done')) })
  if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
  const started = await request(`/api/workflows/${id}/run`, { method: 'POST', ...json({ input: 'fixture' }) })
  const run = await waitRun(started.body.runId)
  if (run.status !== 'done') throw new Error(JSON.stringify(run))
  if (run.ended - run.started < 450) throw new Error(`subprocesses were not serialized: ${run.ended - run.started}ms`)
  if (run.resourcePolicy?.maxSubprocesses !== 1 || run.resources?.active?.subprocess !== 0) throw new Error(JSON.stringify(run.resources))
  if (!run.events?.some(event => event.text.includes('waiting for subprocess capacity'))) throw new Error('missing persisted resource wait event')
  if ((run.checkpoint?.activeLeases || []).length) throw new Error('completed run retained active leases')
})

await test('stop cancels queued subprocess work without leaking permits', async () => {
  const id = 'resource-cancel-fixture'
  const saved = await request('/api/workflows', { method: 'POST', ...json(workflow(id, 'sleep 5; echo should-not-finish', 3)) })
  if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
  const started = await request(`/api/workflows/${id}/run`, { method: 'POST', ...json({ input: 'fixture' }) })
  await new Promise(resolve => setTimeout(resolve, 200))
  const stoppedAt = Date.now()
  await request(`/api/runs/${started.body.runId}/stop`, { method: 'POST' })
  const run = await waitRun(started.body.runId, 3000)
  if (run.status !== 'cancelled' || Date.now() - stoppedAt >= 2500) throw new Error(JSON.stringify(run))
  if (run.resources?.active?.subprocess !== 0 || run.resources?.queued?.subprocess !== 0) throw new Error(JSON.stringify(run.resources))
  if ((run.checkpoint?.activeLeases || []).length) throw new Error('cancelled run retained active leases')
})

for (const id of ['resource-invalid-fixture', 'resource-bound-fixture', 'resource-cancel-fixture']) await request(`/api/workflows/${id}`, { method: 'DELETE' })
console.log(`${passed}/${passed} resource integration tests passed`)
