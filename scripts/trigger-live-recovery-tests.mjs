import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createTriggerStore } from '../server/triggers/store.js'

const base = process.env.COMMAND_CENTER_URL || 'http://127.0.0.1:1717'
const root = process.cwd()
const workflowId = `trigger-live-recovery-${Date.now()}`
let trigger
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
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ }
}
async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { const result = await request('/api/system'); if (result.response.ok) return }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Command Center did not become healthy after restart')
}
async function restart() {
  execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.local.commandcenter`])
  await waitHealthy()
}
async function deliveryRecords() {
  const result = await request(`/api/triggers/history?triggerId=${trigger.id}&limit=100`)
  if (!result.response.ok || !Array.isArray(result.body.items)) throw new Error(`history failed: ${JSON.stringify(result.body)}`)
  return result.body.items.filter(item => ['live-reserved', 'live-starting'].includes(item.source))
}

console.log('== live trigger crash-window recovery ==')

try {
  await test('disposable canonical workflow and disabled trigger are created', async () => {
    const workflow = {
      schemaVersion: 2,
      id: workflowId,
      name: 'Live trigger recovery fixture',
      nodes: [
        { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
        { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } },
      ],
      edges: [{ id: 'e', source: 'in', target: 'out' }],
      settings: { localOnly: true },
    }
    const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) })
    if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
    const created = await request(`/api/workflows/${workflowId}/triggers`, { method: 'POST', ...json({ type: 'interval', enabled: false, config: { intervalMs: 86400000, input: 'recovery fixture' } }) })
    if (created.response.status !== 201 || created.body.enabled !== false) throw new Error(JSON.stringify(created.body))
    trigger = created.body
  })

  await test('real reserved and starting deliveries are persisted before restart', async () => {
    const versions = await request(`/api/workflows/${workflowId}/versions`)
    const workflowVersion = versions.body.find?.(item => item.current)?.id || null
    if (!workflowVersion) throw new Error('current canonical workflow version was not available')
    const store = createTriggerStore({
      storeFile: path.join(root, 'data', 'workflow-triggers.json'),
      legacyHistoryFile: path.join(root, 'data', 'workflow-trigger-history.json'),
      migrateConfigurations: async () => {},
    })
    await store.initialize()
    const reserved = await store.reserve({ trigger, deliveryKey: `host-reserved-${workflowId}`, source: 'live-reserved', workflowVersion })
    const starting = await store.reserve({ trigger, deliveryKey: `host-starting-${workflowId}`, source: 'live-starting', workflowVersion })
    await store.transition(starting.delivery.id, 'starting', { evidence: { crashFixture: true } })
    if (reserved.delivery.state !== 'reserved' || starting.delivery.id === reserved.delivery.id) throw new Error('pending delivery fixtures were not distinct')
  })

  let firstRuns = new Map()
  await test('LaunchAgent restart reconciles both pending states exactly once', async () => {
    await restart()
    let records = []
    for (let i = 0; i < 50; i++) {
      records = await deliveryRecords()
      if (records.length === 2 && records.every(item => item.state === 'started' && item.runId && item.evidence?.runStatus === 'done')) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (records.length !== 2 || records.some(item => item.state !== 'started' || !item.runId || item.evidence?.runStatus !== 'done')) throw new Error(JSON.stringify(records))
    firstRuns = new Map(records.map(item => [item.id, item.runId]))
    if (new Set(firstRuns.values()).size !== 2) throw new Error('distinct deliveries did not produce distinct exact runs')
  })

  await test('second restart preserves the exact delivery-to-run mapping', async () => {
    await restart()
    const records = await deliveryRecords()
    if (records.length !== 2) throw new Error(`expected two records, got ${records.length}`)
    for (const record of records) if (firstRuns.get(record.id) !== record.runId) throw new Error(`delivery ${record.id} changed run identity`)
    const runs = await Promise.all(records.map(record => request(`/api/runs/${record.runId}/detail`)))
    if (runs.some(item => !item.response.ok || item.body.triggerContext?.triggerId !== trigger.id || item.body.triggerContext?.deliveryId == null)) throw new Error('run provenance did not retain safe trigger context')
    if (JSON.stringify(runs.map(item => item.body.triggerContext)).includes('recovery fixture')) throw new Error('run trigger context leaked workflow input')
  })
} finally {
  if (trigger?.id) await request(`/api/triggers/${trigger.id}`, { method: 'DELETE' }).catch(() => {})
  await request(`/api/workflows/${workflowId}`, { method: 'DELETE' }).catch(() => {})
}

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
