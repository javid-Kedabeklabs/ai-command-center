import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, '.tmp', `evidence-redaction-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
const dataDir = path.join(fixtureRoot, 'data'), brainDir = path.join(fixtureRoot, 'brain')
const canary = `ACC_CANARY_${crypto.randomBytes(18).toString('hex')}`
const variants = [canary, encodeURIComponent(canary), Buffer.from(canary).toString('base64'), Buffer.from(canary).toString('base64url'), Buffer.from(canary).toString('hex')]
const port = 22000 + crypto.randomInt(1000), base = `http://127.0.0.1:${port}`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let server, runDir
const request = async (route, options = {}) => { const response = await fetch(base + route, options), text = await response.text(); try { return { response, body: JSON.parse(text), text } } catch { return { response, body: text, text } } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function waitFor(fn, message) { for (let i = 0; i < 300; i++) { const value = await fn(); if (value) return value; await delay(25) } throw new Error(message) }
const scanFiles = directory => {
  const found = []
  if (!directory || !fs.existsSync(directory)) return found
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...scanFiles(target))
    else if (entry.isFile()) found.push([target, fs.readFileSync(target)])
  }
  return found
}
const assertNoCanary = (label, values) => {
  for (const [source, bytes] of values) for (const variant of variants) assert.equal(bytes.includes(Buffer.from(variant)), false, `${label} leaked ${variant === canary ? 'raw' : 'encoded'} canary in ${source}`)
}

fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(brainDir, { recursive: true })
try {
  server = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ACC_DATA_DIR: path.relative(root, dataDir), ACC_BRAIN_DIR: path.relative(root, brainDir), ACC_TEST_REDACTION_CANARY: canary }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; server.stderr.on('data', chunk => { stderr += chunk })
  await waitFor(async () => { if (server.exitCode != null) throw new Error(stderr); try { return (await request('/api/system')).response.ok } catch { return false } }, 'server did not become healthy')
  const workflow = { schemaVersion: 2, id: 'evidence-redaction-live', name: 'Evidence redaction live', permissions: { 'write-files': true }, nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'write', type: 'write-file', data: { path: 'canary.txt' } }, { id: 'out', type: 'output', data: {} }], edges: [{ id: 'a', source: 'in', target: 'write' }, { id: 'b', source: 'write', target: 'out' }] }
  let response = await request('/api/workflows', { method: 'POST', ...json(workflow) }); assert.equal(response.response.status, 200, JSON.stringify(response.body))
  response = await request('/api/workflows/evidence-redaction-live/run', { method: 'POST', ...json({ input: canary }) }); assert.equal(response.response.status, 200, JSON.stringify(response.body))
  const runId = response.body.runId
  const detail = await waitFor(async () => { const result = await request(`/api/runs/${runId}/detail`); return result.body.status === 'done' ? result : null }, 'redaction workflow did not finish')
  runDir = detail.body.dir
  const evidence = await request(`/api/runs/${runId}/evidence`), bundle = await request('/api/bundle/export'), audit = await request('/api/audit')
  assert.equal(evidence.response.status, 200)
  assert.equal(evidence.body.schemaVersion, 1)
  assert.equal(evidence.body.run.id, runId)
  assert.match(evidence.body.evidenceId, /^[a-f0-9]{64}$/)
  assert.equal(evidence.body.checkpoint.nodes.write.effect.state, 'confirmed')
  assert.equal(fs.readFileSync(path.join(runDir, 'canary.txt'), 'utf8'), '[REDACTED]')
  assertNoCanary('persisted product state', [...scanFiles(dataDir), ...scanFiles(runDir)])
  assertNoCanary('API evidence', [['detail', Buffer.from(detail.text)], ['evidence', Buffer.from(evidence.text)], ['bundle', Buffer.from(bundle.text)], ['audit', Buffer.from(audit.text)]])
  assert.ok([detail.text, evidence.text].some(text => text.includes('[REDACTED]')), 'redaction marker was not exercised')
  console.log('✓ secret canary was redacted from durable state, artifacts, API detail, linked evidence, audit, and bundle export')
  console.log('\n== RESULT: 1 passed, 0 failed ==')
} finally {
  if (server && server.exitCode == null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await Promise.race([exited, delay(3000)]) }
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  if (runDir) fs.rmSync(runDir, { recursive: true, force: true })
}
