import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, '.tmp', `subworkflow-recovery-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
const dataDir = path.join(fixtureRoot, 'data'), brainDir = path.join(fixtureRoot, 'brain')
const port = 20000 + crypto.randomInt(1000), base = `http://127.0.0.1:${port}`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let server

const request = async (route, options = {}) => {
  const response = await fetch(base + route, options), text = await response.text()
  try { return { response, body: JSON.parse(text) } } catch { return { response, body: text } }
}
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const readRuns = () => fs.readdirSync(path.join(dataDir, 'runs')).filter(file => file.endsWith('.json')).map(file => JSON.parse(fs.readFileSync(path.join(dataDir, 'runs', file), 'utf8')))
async function waitFor(fn, message, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt++) { const value = await fn(); if (value) return value; await delay(25) }
  throw new Error(message)
}
async function start(extra = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), ACC_DATA_DIR: path.relative(root, dataDir), ACC_BRAIN_DIR: path.relative(root, brainDir), ...extra }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode != null) throw new Error(`server exited during startup: ${stderr}`)
    try { if ((await request('/api/workflows')).response.ok) return child } catch {}
    await delay(25)
  }
  child.kill('SIGKILL'); throw new Error(`server did not become healthy: ${stderr}`)
}
async function stop() {
  if (!server || server.exitCode != null) return
  const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await Promise.race([exited, delay(3000)])
}

fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(brainDir, { recursive: true })
try {
  server = await start({ ACC_TEST_CRASH_AFTER_EFFECT: 'receipt-parent:sub:subworkflow-start' })
  const child = { schemaVersion: 2, id: 'receipt-child', name: 'Receipt child', settings: { restartRecovery: true }, nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'wait', type: 'delay', data: { durationMs: 800 } }, { id: 'out', type: 'output', data: {} }], edges: [{ id: 'a', source: 'in', target: 'wait' }, { id: 'b', source: 'wait', target: 'out' }] }
  let result = await request('/api/workflows', { method: 'POST', ...json(child) }); assert.equal(result.response.status, 200, JSON.stringify(result.body))
  const versions = await request('/api/workflows/receipt-child/versions'); const childVersion = versions.body[0].id
  const parent = { schemaVersion: 2, id: 'receipt-parent', name: 'Receipt parent', settings: { restartRecovery: true }, nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'sub', type: 'subworkflow', data: { workflowId: 'receipt-child', workflowVersion: childVersion } }, { id: 'out', type: 'output', data: {} }], edges: [{ id: 'a', source: 'in', target: 'sub' }, { id: 'b', source: 'sub', target: 'out' }] }
  result = await request('/api/workflows', { method: 'POST', ...json(parent) }); assert.equal(result.response.status, 200, JSON.stringify(result.body))
  result = await request('/api/workflows/receipt-parent/run', { method: 'POST', ...json({ input: 'stable-child-effect' }) }); assert.equal(result.response.status, 200, JSON.stringify(result.body))
  const originalParentId = result.body.runId
  await waitFor(() => {
    if (server.exitCode != null || server.signalCode) return true
    const parentRun = readRuns().find(run => run.id === originalParentId)
    if (parentRun && !['running', 'paused'].includes(parentRun.status)) throw new Error(`parent terminated before crash boundary: ${parentRun.status}: ${(parentRun.events || []).map(event => event.text).join(' | ')}`)
    return false
  }, 'server did not crash after child start')
  server = await start()
  const recoveredParent = await waitFor(() => {
    const original = readRuns().find(run => run.id === originalParentId)
    if (!original?.recoveredBy) return null
    const recovered = readRuns().find(run => run.id === original.recoveredBy)
    if (recovered && !['running', 'paused', 'done'].includes(recovered.status)) throw new Error(`recovered parent terminated as ${recovered.status}: ${(recovered.events || []).map(event => event.text).join(' | ')}`)
    return recovered?.status === 'done' ? recovered : null
  }, 'parent did not recover through its deduplicated child operation', 500)
  const childRuns = readRuns().filter(run => run.workflowId === 'receipt-child')
  assert.ok(childRuns.length >= 1)
  assert.equal(new Set(childRuns.map(run => run.parentOperation?.operationKey).filter(Boolean)).size, 1)
  assert.equal(new Set(childRuns.map(run => run.logicalRunId)).size, 1)
  assert.equal(recoveredParent.checkpoint.nodes.sub.attemptsStarted, 2)
  assert.equal(recoveredParent.checkpoint.nodes.sub.effect.state, 'confirmed')
  assert.match(recoveredParent.checkpoint.nodes.sub.effect.receiptRef, /^subworkflow:/)
  assert.equal(recoveredParent.checkpoint.subworkflows.length, 1)
  console.log('✓ subworkflow start was deduplicated by a stable parent operation and recovered to one confirmed receipt')
  console.log('\n== RESULT: 1 passed, 0 failed ==')
} finally {
  await stop().catch(() => {})
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
