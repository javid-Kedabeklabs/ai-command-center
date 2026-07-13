import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, '.tmp', `trigger-receipt-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
const dataDir = path.join(fixtureRoot, 'data'), brainDir = path.join(fixtureRoot, 'brain')
const port = 21000 + crypto.randomInt(1000), base = `http://127.0.0.1:${port}`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let server
const request = async (route, options = {}) => { const response = await fetch(base + route, options), text = await response.text(); try { return { response, body: JSON.parse(text) } } catch { return { response, body: text } } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitFor(fn, message, attempts = 400) { for (let i = 0; i < attempts; i++) { const value = await fn(); if (value) return value; await delay(25) } throw new Error(message) }
async function start(extra = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), ACC_DATA_DIR: path.relative(root, dataDir), ACC_BRAIN_DIR: path.relative(root, brainDir), ...extra }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk })
  for (let i = 0; i < 100; i++) { if (child.exitCode != null) throw new Error(`server exited: ${stderr}`); try { if ((await request('/api/workflows')).response.ok) return child } catch {}; await delay(25) }
  child.kill('SIGKILL'); throw new Error(`server did not become healthy: ${stderr}`)
}
async function stop() { if (!server || server.exitCode != null) return; const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await Promise.race([exited, delay(3000)]) }

fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(brainDir, { recursive: true })
try {
  server = await start({ ACC_TEST_CRASH_AFTER_EFFECT: 'trigger-receipt-workflow:write:file-write' })
  const workflow = { schemaVersion: 2, id: 'trigger-receipt-workflow', name: 'Trigger receipt workflow', permissions: { 'write-files': true }, settings: { restartRecovery: true }, nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'write', type: 'write-file', data: { path: 'receipt.txt' } }, { id: 'out', type: 'output', data: {} }], edges: [{ id: 'a', source: 'in', target: 'write' }, { id: 'b', source: 'write', target: 'out' }] }
  let result = await request('/api/workflows', { method: 'POST', ...json(workflow) }); assert.equal(result.response.status, 200, JSON.stringify(result.body))
  result = await request('/api/workflows/trigger-receipt-workflow/triggers', { method: 'POST', ...json({ type: 'interval', enabled: false, config: { intervalMs: 86400000, input: 'triggered-content' } }) }); assert.equal(result.response.status, 201, JSON.stringify(result.body))
  const trigger = result.body
  result = await request(`/api/triggers/${trigger.id}/test`, { method: 'POST', ...json({ input: 'triggered-content' }) }); assert.equal(result.response.status, 200, JSON.stringify(result.body))
  const deliveryId = result.body.deliveryId, originalRunId = result.body.runId
  await waitFor(() => server.exitCode != null || server.signalCode, 'triggered workflow did not reach the crash boundary')
  server = await start()
  const evidence = await waitFor(async () => {
    const history = await request(`/api/triggers/history?triggerId=${trigger.id}&limit=100`)
    const delivery = history.body.items?.find(item => item.id === deliveryId)
    if (!delivery || delivery.evidence?.runStatus !== 'done') return null
    const run = (await request(`/api/runs/${delivery.runId}/detail`)).body
    return run.status === 'done' ? { delivery, run } : null
  }, 'trigger delivery did not follow the recovered run to completion')
  assert.notEqual(evidence.delivery.runId, originalRunId)
  assert.equal(evidence.delivery.evidence.recoveredFrom, originalRunId)
  assert.equal(evidence.run.triggerContext.deliveryId, deliveryId)
  assert.equal(evidence.run.checkpoint.triggerReceipt.deliveryId, deliveryId)
  assert.equal(evidence.run.checkpoint.triggerReceipt.deliveryKey, evidence.run.triggerContext.deliveryKey)
  assert.equal(evidence.run.checkpoint.triggerReceipt.workflowVersion, evidence.run.workflowVersion)
  console.log('✓ trigger delivery followed restart recovery and remained linked to the authoritative checkpoint receipt')
  console.log('\n== RESULT: 1 passed, 0 failed ==')
} finally { await stop().catch(() => {}); fs.rmSync(fixtureRoot, { recursive: true, force: true }) }
