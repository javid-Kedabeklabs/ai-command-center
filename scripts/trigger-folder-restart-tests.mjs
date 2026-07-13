import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

const base = process.env.COMMAND_CENTER_URL || 'http://127.0.0.1:1717'
const root = process.cwd()
const storeFile = path.join(root, 'data', 'workflow-triggers.json')
const workflowId = `trigger-folder-restart-${Date.now()}`
const watched = path.join(root, 'state', `.fixture-${workflowId}`)
let trigger = null
let passed = 0
let failed = 0

const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function request(route, options = {}) {
  const response = await fetch(`${base}${route}`, options)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { response, body }
}
async function test(name, operation) {
  try { await operation(); console.log(`  PASS  ${name}`); passed++ }
  catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ }
}
async function waitFor(operation, message, attempts = 80, delayMs = 100) {
  for (let index = 0; index < attempts; index++) {
    const result = await operation()
    if (result) return result
    await wait(delayMs)
  }
  throw new Error(message)
}
async function waitHealthy() {
  await waitFor(async () => {
    try { return (await request('/api/system')).response.ok }
    catch { return false }
  }, 'Command Center did not become healthy after LaunchAgent restart', 100, 100)
}
async function restart() {
  execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.local.commandcenter`])
  await waitHealthy()
}
function store() { return JSON.parse(fs.readFileSync(storeFile, 'utf8')) }
function folderState() { return trigger?.id ? store().folders?.[trigger.id] : null }
async function history() {
  const result = await request(`/api/triggers/history?triggerId=${trigger.id}&limit=100`)
  if (!result.response.ok || !Array.isArray(result.body.items)) throw new Error(`history failed: ${JSON.stringify(result.body)}`)
  return result.body.items.filter(item => item.source === 'folder')
}

console.log('== live folder trigger restart recovery ==')

const originalFolderIds = new Set(Object.keys(store().folders || {}))
fs.rmSync(watched, { recursive: true, force: true })
fs.mkdirSync(watched, { recursive: true })

try {
  await test('disposable workflow and watched-folder trigger establish a durable baseline', async () => {
    const workflow = {
      schemaVersion: 2,
      id: workflowId,
      name: 'Folder restart fixture',
      nodes: [
        { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
        { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } },
      ],
      edges: [{ id: 'e', source: 'in', target: 'out' }],
      settings: { localOnly: true },
    }
    const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) })
    if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
    const created = await request(`/api/workflows/${workflowId}/triggers`, {
      method: 'POST',
      ...json({ type: 'folder', config: { path: watched, pollMs: 1000, settleMs: 300000, debounceMs: 60000, extensions: ['txt'] } }),
    })
    if (created.response.status !== 201) throw new Error(JSON.stringify(created.body))
    trigger = created.body
    const baseline = await waitFor(() => folderState(), 'folder baseline was not persisted')
    if (Object.keys(baseline.snapshot?.entries || {}).length !== 0) throw new Error('folder baseline was not empty')
  })

  let persistedCandidate
  await test('candidate and snapshot are persisted before restart without launching', async () => {
    fs.writeFileSync(path.join(watched, 'restart.txt'), 'persist this event across restart')
    persistedCandidate = await waitFor(() => {
      const state = folderState()
      const candidates = Object.values(state?.candidates?.candidates || {})
      return candidates.length === 1 ? { state, candidate: candidates[0] } : null
    }, 'folder candidate was not durably persisted', 50, 100)
    if ((await history()).length !== 0) throw new Error('folder event launched before its settle window')
    if (!/^[a-f0-9]{64}$/.test(persistedCandidate.state.rootHash || '') || !/^[a-f0-9]{64}$/.test(persistedCandidate.candidate.signature || '')) throw new Error('persisted folder identity was invalid')
  })

  let deliveryId
  let runId
  await test('LaunchAgent restart preserves the candidate and launches it exactly once', async () => {
    await restart()
    const recovered = folderState()
    const recoveredCandidates = Object.values(recovered?.candidates?.candidates || {})
    if (recovered?.rootHash !== persistedCandidate.state.rootHash || recoveredCandidates[0]?.signature !== persistedCandidate.candidate.signature) throw new Error('folder candidate identity changed across restart')
    const accelerated = await request(`/api/triggers/${trigger.id}`, { method: 'PUT', ...json({ config: { settleMs: 0 } }) })
    if (!accelerated.response.ok) throw new Error(JSON.stringify(accelerated.body))
    const records = await waitFor(async () => {
      const items = await history()
      return items.length === 1 && items[0].state === 'started' && items[0].runId ? items : null
    }, 'recovered folder event did not launch exactly once', 100, 100)
    const record = records[0]
    deliveryId = record.id
    runId = record.runId
    if (record.evidence?.event !== 'created' || !/^[a-f0-9]{64}$/.test(record.evidence?.relativePathHash || '') || !/^[a-f0-9]{64}$/.test(record.evidence?.fingerprintHash || '')) throw new Error(JSON.stringify(record))
    const serialized = JSON.stringify(record)
    if (serialized.includes('restart.txt') || serialized.includes(watched)) throw new Error('public delivery evidence leaked a watched path')
  })

  await test('second restart preserves delivery/run identity without a duplicate launch', async () => {
    await restart()
    await wait(1500)
    const records = await history()
    if (records.length !== 1 || records[0].id !== deliveryId || records[0].runId !== runId) throw new Error(JSON.stringify(records))
  })

  await test('disable and delete remove only the fixture folder state', async () => {
    const disabled = await request(`/api/triggers/${trigger.id}`, { method: 'PUT', ...json({ enabled: false }) })
    if (!disabled.response.ok || disabled.body.enabled !== false) throw new Error(JSON.stringify(disabled.body))
    await waitFor(() => !folderState(), 'disable did not clear the fixture folder state')
    const removed = await request(`/api/triggers/${trigger.id}`, { method: 'DELETE' })
    if (!removed.response.ok) throw new Error(JSON.stringify(removed.body))
    const remaining = new Set(Object.keys(store().folders || {}))
    if (remaining.size !== originalFolderIds.size || [...originalFolderIds].some(id => !remaining.has(id))) throw new Error('fixture cleanup changed another trigger folder state')
    trigger = null
  })
} finally {
  if (trigger?.id) await request(`/api/triggers/${trigger.id}`, { method: 'DELETE' }).catch(() => {})
  await request(`/api/workflows/${workflowId}`, { method: 'DELETE' }).catch(() => {})
  fs.rmSync(watched, { recursive: true, force: true })
}

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
