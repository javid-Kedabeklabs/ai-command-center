import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, '.tmp', `learning-live-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
const port = 21000 + crypto.randomInt(1000), base = `http://127.0.0.1:${port}`
let server, passed = 0
const request = async (route, options = {}) => { const response = await fetch(base + route, options); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const test = async (name, fn) => { await fn(); passed++; console.log(`✓ ${name}`) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitRun(id) { for (let i = 0; i < 100; i++) { const result = await request(`/api/runs/${id}/detail`); if (!['running', 'paused'].includes(result.body?.status)) return result.body; await delay(25) } throw new Error('run timed out') }

async function startServer() {
  fs.mkdirSync(path.join(fixtureRoot, 'data'), { recursive: true }); fs.mkdirSync(path.join(fixtureRoot, 'brain'), { recursive: true })
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ACC_DATA_DIR: path.relative(root, path.join(fixtureRoot, 'data')), ACC_BRAIN_DIR: path.relative(root, path.join(fixtureRoot, 'brain')) }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk })
  for (let i = 0; i < 100; i++) { if (child.exitCode != null) throw new Error(stderr); try { if ((await request('/api/system')).response.ok) return child } catch {}; await delay(25) }
  child.kill('SIGKILL'); throw new Error(`learning fixture server did not become healthy: ${stderr}`)
}

try {
  server = await startServer()
  const workflow = { schemaVersion: 2, id: 'learning-live', name: 'Learning live fixture', settings: { retries: 0 }, nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'in', target: 'out' }] }
  await test('two exact persisted failures become one durable proposal', async () => {
    let result = await request('/api/workflows', { method: 'POST', ...json(workflow) }); assert.equal(result.response.status, 200, JSON.stringify(result.body))
    for (let i = 0; i < 2; i++) {
      const id = `interrupted-${i}`, file = path.join(fixtureRoot, 'data', 'runs', `${id}.json`), record = { id, workflowId: workflow.id, status: 'interrupted', started: Date.now() - i, events: [{ t: Date.now(), type: 'error', text: 'classified transient fixture: ECONNRESET' }] }; fs.writeFileSync(file, JSON.stringify(record, null, 2))
    }
    const first = await request('/api/learning/analyze', { method: 'POST', ...json({ workflowId: workflow.id }) }), second = await request('/api/learning/analyze', { method: 'POST', ...json({ workflowId: workflow.id }) })
    assert.equal(first.response.status, 200); assert.equal(second.response.status, 200); assert.equal(first.body[0].id, second.body[0].id)
    const listed = await request('/api/learning/proposals'); assert.equal(listed.body.filter(item => item.fingerprint === first.body[0].fingerprint).length, 1); assert.match(first.body[0].sourceWorkflowHash, /^[a-f0-9]{12,64}$/)
  })
  await test('approval is replay-safe and creates only a separate development candidate', async () => {
    const proposals = (await request('/api/learning/proposals')).body, proposal = proposals.find(item => item.kind === 'retry-policy')
    const body = { decision: 'approved', commandId: 'learning-live-approve', actor: 'test-owner' }
    const original = (await request('/api/workflows/learning-live')).body
    let changed = await request('/api/workflows', { method: 'POST', ...json({ ...original, settings: { ...original.settings, retries: 1 } }) }); assert.equal(changed.response.status, 200)
    const stale = await request(`/api/learning/proposals/${proposal.id}/decision`, { method: 'POST', ...json(body) }); assert.equal(stale.response.status, 409); assert.equal(stale.body.code, 'STALE_LEARNING_SOURCE')
    changed = await request('/api/workflows', { method: 'POST', ...json(original) }); assert.equal(changed.response.status, 200)
    const first = await request(`/api/learning/proposals/${proposal.id}/decision`, { method: 'POST', ...json(body) }), replay = await request(`/api/learning/proposals/${proposal.id}/decision`, { method: 'POST', ...json(body) })
    assert.equal(first.response.status, 200, JSON.stringify(first.body)); assert.equal(replay.response.status, 200); assert.equal(replay.body.replay, true); assert.equal(first.body.candidateWorkflowId, replay.body.candidateWorkflowId)
    const candidate = await request(`/api/workflows/${first.body.candidateWorkflowId}`), source = await request('/api/workflows/learning-live')
    assert.equal(candidate.body.governance.provenance.proposalId, proposal.id); assert.equal(candidate.body.settings.retries, 2); assert.equal(source.body.settings.retries, 0); assert.equal(candidate.body.environment, 'development')
    const conflict = await request(`/api/learning/proposals/${proposal.id}/decision`, { method: 'POST', ...json({ ...body, decision: 'rejected' }) }); assert.equal(conflict.response.status, 409); assert.equal(conflict.body.code, 'LEARNING_COMMAND_CONFLICT')
    let result = await request('/api/evaluations', { method: 'POST', ...json({ id: 'learning-regression', name: 'Learning regression', workflowId: first.body.candidateWorkflowId, checks: [{ type: 'contains', value: 'verified-output' }] }) }); assert.equal(result.response.status, 200)
    const candidateDraft = (await request(`/api/workflows/${first.body.candidateWorkflowId}`)).body
    result = await request('/api/workflows', { method: 'POST', ...json({ ...candidateDraft, evaluations: ['learning-regression'], governance: { ...candidateDraft.governance, promotionGates: { evaluations: ['learning-regression'] } } }) }); assert.equal(result.response.status, 200, JSON.stringify(result.body))
    const prepared = await request(`/api/workflows/${first.body.candidateWorkflowId}/candidates`, { method: 'POST', ...json({ by: 'learning-live-test' }) }); assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body))
    const started = await request(`/api/workflows/${first.body.candidateWorkflowId}/run`, { method: 'POST', ...json({ input: 'verified-output', candidateId: prepared.body.id }) }), run = await waitRun(started.body.runId); assert.equal(run.status, 'done')
    result = await request('/api/evaluations/learning-regression/run', { method: 'POST', ...json({ runId: run.id }) }); assert.equal(result.body.promotable, true); assert.equal(result.body.passed, true)
    const verifyBody = { recordId: result.body.id, commandId: 'learning-live-verify', actor: 'test-owner' }
    const verified = await request(`/api/learning/proposals/${proposal.id}/verify`, { method: 'POST', ...json(verifyBody) }), verifyReplay = await request(`/api/learning/proposals/${proposal.id}/verify`, { method: 'POST', ...json(verifyBody) })
    assert.equal(verified.body.status, 'verified'); assert.equal(verified.body.verification.recordId, result.body.id); assert.equal(verifyReplay.body.replay, true)
    const transition = async (action, extra = {}) => request(`/api/workflows/${first.body.candidateWorkflowId}/lifecycle`, { method: 'POST', ...json({ action, actor: 'test-owner', reason: `${action} verified learning candidate`, candidateId: prepared.body.id, expectedWorkflowId: first.body.candidateWorkflowId, expectedWorkflowVersion: prepared.body.workflowVersion, expectedWorkflowHash: prepared.body.sourceHash, expectedOperationalHash: prepared.body.operationalHash, selectedGateResultIds: [result.body.id], ...extra }) })
    let lifecycle = await transition('prepare-testing'); assert.equal(lifecycle.response.status, 200, JSON.stringify(lifecycle.body))
    lifecycle = await transition('approve-testing'); assert.equal(lifecycle.response.status, 200, JSON.stringify(lifecycle.body)); const approvalDecisionId = lifecycle.body.lifecycle.testingApprovalId
    lifecycle = await transition('enter-testing', { approvalDecisionId }); assert.equal(lifecycle.response.status, 200, JSON.stringify(lifecycle.body)); assert.equal(lifecycle.body.lifecycle.state, 'testing')
  })
} finally {
  if (server && server.exitCode == null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await Promise.race([exited, delay(3000)]) }
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`\nlearning live tests: ${passed}/${passed} passed`)
