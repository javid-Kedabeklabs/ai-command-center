import assert from 'node:assert/strict'
import fs from 'node:fs'
import { api } from '../web/src/api.ts'
import { historyStatus, triggerAvailability, triggerDeletePrompt, triggerSummary, triggerTypeLabel } from '../web/src/workflowTriggerHelpers.ts'

let passed = 0
const test = async (name, operation) => {
  try { await operation(); passed++; console.log(`  PASS  ${name}`) }
  catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); throw error }
}
const base = { id: 'trigger-example01', workflowId: 'workflow-one', enabled: true }

console.log('== workflow trigger manager helpers and API ==')

await test('each trigger type has a truthful distinct label and summary', () => {
  const fixtures = [
    { ...base, type: 'interval', config: { intervalMs: 120000, timezone: 'UTC', overlapPolicy: 'queue-one' } },
    { ...base, type: 'cron', config: { cron: '0 9 * * 1-5', timezone: 'America/Los_Angeles', overlapPolicy: 'skip' } },
    { ...base, type: 'webhook', secretRevision: 3, webhookCredentialStatus: 'active', config: {} },
    { ...base, type: 'folder', folderStatus: 'ready', config: { path: '/approved/inbox', extensions: ['pdf', 'txt'] } },
  ]
  assert.deepEqual(fixtures.map(item => triggerTypeLabel(item.type)), ['Interval', 'Cron schedule', 'Secure webhook', 'Watched folder'])
  assert.deepEqual(fixtures.map(triggerSummary), [
    'Every 2 minutes · UTC · queue-one overlap',
    '0 9 * * 1-5 · America/Los_Angeles · skip overlap',
    'Bearer endpoint · credential revision 3',
    '/approved/inbox · pdf, txt',
  ])
})

await test('availability is explicit for disabled, revoked, and invalid folder triggers', () => {
  assert.deepEqual(triggerAvailability({ ...base, type: 'interval', enabled: false }), { available: false, label: 'Disabled', reason: 'This trigger will not launch new runs.' })
  assert.equal(triggerAvailability({ ...base, type: 'webhook', webhookCredentialStatus: 'revoked' }).label, 'Credential revoked')
  assert.deepEqual(triggerAvailability({ ...base, type: 'folder', folderStatus: 'needs-review', folderValidationReason: 'root missing' }), { available: false, label: 'Needs review', reason: 'root missing' })
  assert.equal(triggerAvailability({ ...base, type: 'cron' }).available, true)
})

await test('history status prefers the public status alias and remains readable', () => {
  assert.deepEqual(historyStatus({ id: 'one', triggerId: base.id, status: 'started', state: 'reserved' }), { status: 'started', label: 'Started' })
  assert.deepEqual(historyStatus({ id: 'two', triggerId: base.id, state: 'queue-one' }), { status: 'queue-one', label: 'Queue one' })
})

await test('deletion guidance preserves history and already-running work', () => {
  const prompt = triggerDeletePrompt({ ...base, type: 'folder' })
  assert.match(prompt, /Persisted delivery history/)
  assert.match(prompt, /already-running workflows will remain/)
})

await test('history API requests a bounded workflow-filtered persisted page', async () => {
  const prior = globalThis.fetch
  let request = null
  globalThis.fetch = async (input, init) => { request = { input: String(input), init }; return new Response(JSON.stringify({ items: [{ id: 'delivery-one' }], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  try {
    const result = await api.workflowTriggerHistory('workflow one/unsafe', 25)
    assert.equal(request.input, '/api/triggers/history?workflowId=workflow%20one%2Funsafe&limit=25')
    assert.equal(request.init, undefined)
    assert.deepEqual(result, { items: [{ id: 'delivery-one' }], nextCursor: null })
  } finally { globalThis.fetch = prior }
})

await test('manager stays API-backed and does not copy triggers into draft settings', () => {
  const source = fs.readFileSync(new URL('../web/src/WorkflowStudio.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('function WorkflowTriggerManager')
  const end = source.indexOf('\nfunction ', start + 10)
  const manager = source.slice(start, end)
  assert.match(manager, /api\.workflowTriggers\(workflowId\)/)
  assert.match(manager, /api\.workflowTriggerHistory\(workflowId\)/)
  assert.match(manager, /api\.updateWorkflowTrigger/)
  assert.match(manager, /api\.deleteWorkflowTrigger/)
  assert.doesNotMatch(manager, /setSettings|settings\.triggers|patch\(\{\s*triggers/)
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
