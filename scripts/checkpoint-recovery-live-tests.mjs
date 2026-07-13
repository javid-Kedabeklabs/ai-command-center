import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, '.tmp', `checkpoint-recovery-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
const dataDir = path.join(fixtureRoot, 'data')
const brainDir = path.join(fixtureRoot, 'brain')
const port = 19000 + crypto.randomInt(1000)
const base = `http://127.0.0.1:${port}`
let server
let mockServer

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const request = async (route, options = {}) => {
  const response = await fetch(base + route, options)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { response, body }
}
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function startServer(extraEnvironment = {}) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ACC_DATA_DIR: path.relative(root, dataDir), ACC_BRAIN_DIR: path.relative(root, brainDir), ...extraEnvironment },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode != null) throw new Error(`server exited during startup: ${stderr}`)
    try { if ((await request('/api/workflows')).response.ok) return child } catch {}
    await delay(25)
  }
  child.kill('SIGKILL')
  throw new Error(`server did not become healthy: ${stderr}`)
}

async function stopServer(signal = 'SIGTERM') {
  if (!server || server.exitCode != null) return
  const exited = new Promise(resolve => server.once('exit', resolve))
  server.kill(signal)
  await Promise.race([exited, delay(3000)])
  server = null
}

async function waitFor(fn, message, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await fn()
    if (value) return value
    await delay(25)
  }
  throw new Error(message)
}

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(brainDir, { recursive: true })

try {
  server = await startServer({ ACC_TEST_CRASH_AFTER_EFFECT: 'checkpoint-recovery-live:write:file-write' })
  const workflow = {
    schemaVersion: 2,
    id: 'checkpoint-recovery-live',
    name: 'Checkpoint recovery live',
    permissions: { 'write-files': true },
    settings: { parallelism: 2, restartRecovery: true },
    nodes: [
      { id: 'in', type: 'input', data: { label: 'Input' } },
      { id: 'slow', type: 'delay', data: { label: 'Slow', durationMs: 1200 } },
      { id: 'write', type: 'write-file', data: { label: 'Write', path: 'receipt.txt' } },
      { id: 'out', type: 'output', data: { label: 'Output' } },
    ],
    edges: [
      { id: 'a', source: 'in', target: 'slow' },
      { id: 'b', source: 'in', target: 'write' },
      { id: 'c', source: 'slow', target: 'out' },
      { id: 'd', source: 'write', target: 'out' },
    ],
  }
  let response = await request('/api/workflows', { method: 'POST', ...json(workflow) })
  assert.equal(response.response.status, 200, JSON.stringify(response.body))
  response = await request(`/api/workflows/${workflow.id}/run`, { method: 'POST', ...json({ input: 'crash-evidence' }) })
  assert.equal(response.response.status, 200, JSON.stringify(response.body))
  const interruptedId = response.body.runId
  const interruptedFile = path.join(dataDir, 'runs', `${interruptedId}.json`)
  const interrupted = await waitFor(async () => {
    if (!fs.existsSync(interruptedFile)) return null
    const detail = JSON.parse(fs.readFileSync(interruptedFile, 'utf8'))
    return detail.checkpoint?.nodes?.slow?.state === 'running' && detail.checkpoint?.nodes?.write?.effect?.state === 'inflight' && (server.exitCode != null || server.signalCode) ? detail : null
  }, 'parallel branches did not reach the deterministic post-write crash boundary')
  assert.equal(interrupted.checkpoint.schemaVersion, 2)
  assert.equal(interrupted.checkpoint.nodes.write.attemptsStarted, 1)
  server = null
  const killedSnapshot = JSON.parse(fs.readFileSync(interruptedFile, 'utf8'))
  assert.equal(killedSnapshot.checkpoint.nodes.slow.state, 'running')
  assert.equal(killedSnapshot.checkpoint.nodes.write.state, 'running')
  assert.equal(killedSnapshot.checkpoint.nodes.write.effect.state, 'inflight')

  server = await startServer()
  const recovered = await waitFor(async () => {
    const original = JSON.parse(fs.readFileSync(interruptedFile, 'utf8'))
    if (!original.recoveredBy) return null
    const detail = (await request(`/api/runs/${original.recoveredBy}/detail`)).body
    return detail.status === 'done' ? detail : null
  }, 'restart recovery did not complete', 300)

  assert.equal(recovered.logicalRunId, interrupted.logicalRunId)
  assert.equal(recovered.resumedFrom, interruptedId)
  assert.equal(recovered.checkpoint.nodes.in.attemptsStarted, 1)
  assert.equal(recovered.checkpoint.nodes.write.attemptsStarted, 1)
  assert.equal(recovered.checkpoint.nodes.slow.attemptsStarted, 2)
  assert.equal(recovered.checkpoint.nodes.out.attemptsStarted, 1)
  assert.deepEqual(Object.fromEntries(Object.entries(recovered.checkpoint.nodes).map(([id, node]) => [id, node.state])), { in: 'succeeded', slow: 'succeeded', write: 'succeeded', out: 'succeeded' })
  assert.equal(fs.readFileSync(path.join(recovered.dir, 'receipt.txt'), 'utf8'), 'crash-evidence')

  let mutatingCalls = 0
  mockServer = http.createServer((req, res) => {
    if (req.method === 'POST') mutatingCalls += 1
    req.resume()
    setTimeout(() => { if (!res.writableEnded) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('committed') } }, 5000)
  })
  await new Promise((resolve, reject) => { mockServer.once('error', reject); mockServer.listen(0, '127.0.0.1', resolve) })
  const mockPort = mockServer.address().port
  const effectWorkflow = {
    schemaVersion: 2,
    id: 'checkpoint-ambiguous-effect-live',
    name: 'Checkpoint ambiguous effect live',
    permissions: { network: true },
    settings: { restartRecovery: true },
    nodes: [
      { id: 'in', type: 'input', data: { label: 'Input' } },
      { id: 'post', type: 'http', data: { label: 'Mutating HTTP', method: 'POST', url: `http://127.0.0.1:${mockPort}/effect`, timeoutMs: 10000 } },
      { id: 'out', type: 'output', data: { label: 'Output' } },
    ],
    edges: [{ id: 'a', source: 'in', target: 'post' }, { id: 'b', source: 'post', target: 'out' }],
  }
  response = await request('/api/workflows', { method: 'POST', ...json(effectWorkflow) })
  assert.equal(response.response.status, 200, JSON.stringify(response.body))
  response = await request(`/api/workflows/${effectWorkflow.id}/run`, { method: 'POST', ...json({ input: 'effect-payload' }) })
  assert.equal(response.response.status, 200, JSON.stringify(response.body))
  const effectRunId = response.body.runId
  await waitFor(async () => {
    const detail = (await request(`/api/runs/${effectRunId}/detail`)).body
    return mutatingCalls === 1 && detail.checkpoint?.nodes?.post?.state === 'running'
  }, 'mutating effect did not reach its crash boundary')
  await stopServer('SIGKILL')
  server = await startServer()
  const stoppedForReview = await waitFor(async () => {
    const original = JSON.parse(fs.readFileSync(path.join(dataDir, 'runs', `${effectRunId}.json`), 'utf8'))
    if (!original.recoveredBy) return null
    const detail = (await request(`/api/runs/${original.recoveredBy}/detail`)).body
    return detail.status === 'needs_review' ? detail : null
  }, 'ambiguous effect did not stop for review')
  assert.deepEqual(stoppedForReview.needsReviewNodes, ['post'])
  assert.equal(stoppedForReview.checkpoint.nodes.post.effect.state, 'ambiguous')
  assert.equal(mutatingCalls, 1)

  console.log('✓ committed file effect was reconciled after a deterministic post-write crash without re-execution')
  console.log('✓ interrupted computational branch was retried with a fenced second attempt')
  console.log('✓ logical execution identity survived SIGKILL and automatic restart recovery')
  console.log('✓ uncertain mutating HTTP effect stopped for review without a blind retry')
  console.log('\n== RESULT: 4 passed, 0 failed ==')
} finally {
  await stopServer().catch(() => {})
  if (mockServer) await new Promise(resolve => mockServer.close(resolve)).catch(() => {})
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
