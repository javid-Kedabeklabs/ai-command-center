import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd(), base = 'http://127.0.0.1:1717'
const runsDir = path.join(root, 'data', 'runs')

function listenerPid() {
  try { return Number(execFileSync('lsof', ['-tiTCP:1717', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/)[0]) || null } catch { return null }
}
function stop(pid, signal = 'SIGTERM') { if (pid) try { process.kill(pid, signal) } catch {} }
async function waitServer(previousPid = null) { const until = Date.now() + 8000; while (Date.now() < until) { try { const pid = listenerPid(), response = await fetch(`${base}/api/system`); if (response.ok && pid && (!previousPid || pid !== previousPid)) return pid } catch {}; await new Promise(resolve => setTimeout(resolve, 100)) }; throw new Error('LaunchAgent did not restore the server') }
async function post(url, body) { const response = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || `${response.status}`); return result }

console.log('== restart recovery ==')
await waitServer()

const workflow = { id: 'restart-recovery-fixture', name: 'Restart Recovery Fixture', settings: { restartRecovery: true }, nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'wait', type: 'delay', data: { label: 'Recoverable Wait', durationMs: 5000 } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'in', target: 'wait' }, { id: 'e2', source: 'wait', target: 'out' }] }
await post('/api/workflows', workflow)
const started = await post('/api/workflows/restart-recovery-fixture/run', { input: 'survive restart' })
await new Promise(resolve => setTimeout(resolve, 200))
const crashedPid = listenerPid(); stop(crashedPid, 'SIGKILL'); await waitServer(crashedPid)

const previousFile = path.join(runsDir, `${started.runId}.json`), until = Date.now() + 10000
let previous, recovered
while (Date.now() < until) {
  previous = JSON.parse(fs.readFileSync(previousFile, 'utf8'))
  if (previous.recoveredBy) {
    const recoveredFile = path.join(runsDir, `${previous.recoveredBy}.json`)
    if (fs.existsSync(recoveredFile)) { recovered = JSON.parse(fs.readFileSync(recoveredFile, 'utf8')); if (!['running', 'paused'].includes(recovered.status)) break }
  }
  await new Promise(resolve => setTimeout(resolve, 150))
}

assert.equal(previous.status, 'interrupted')
assert(previous.recoveredBy, 'old run should link to a recovery run')
assert.equal(recovered?.status, 'done')
assert.match(String(recovered?.result), /survive restart/)
await fetch(`${base}/api/workflows/restart-recovery-fixture`, { method: 'DELETE' })
console.log('  PASS  interrupted run is linked to an automatically resumed recovery run')
console.log('\n== RESULT: 1 passed, 0 failed ==')
