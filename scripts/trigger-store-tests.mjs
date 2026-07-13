import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTriggerStore, normalizeWebhookSecretRecord } from '../server/triggers/store.js'
import { normalizeError, normalizeTriggerDefinition, redactedDeliveryKey } from '../server/triggers/schema.js'
import { mergeWorkflowDocuments, migrateWorkflowDocument } from '../server/workflows/schema.js'
import { findTriggerRun, normalizeTriggerContext } from '../server/triggers/run-idempotency.js'
import { createWorkflowTriggerAdapter } from '../server/triggers/workflow-adapter.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trigger-store-'))
const trigger = (id = 'trigger-fixture01') => normalizeTriggerDefinition({ id, workflowId: 'workflow-one', type: 'interval', enabled: true, config: { intervalMs: 1000 }, createdAt: 1, updatedAt: 1 })
const files = dir => ({ storeFile: path.join(dir, 'workflow-triggers.json'), legacyHistoryFile: path.join(dir, 'workflow-trigger-history.json') })

console.log('== durable trigger store ==')

await test('webhook secret records migrate legacy hashes and reject plaintext or malformed values', async () => {
  const legacy = normalizeWebhookSecretRecord({ tokenHash: 'a'.repeat(64) })
  if (legacy.revision !== 1 || legacy.tokenHash !== 'a'.repeat(64)) throw new Error('legacy secret was not normalized')
  for (const value of [{ tokenHash: 'short' }, { tokenHash: 'b'.repeat(64), operationKeyHash: 'bad' }, { webhookToken: 'plaintext' }]) {
    let rejected = false
    try { normalizeWebhookSecretRecord(value) } catch { rejected = true }
    if (!rejected) throw new Error(`unsafe secret accepted: ${JSON.stringify(value)}`)
  }
})

await test('webhook authentication and delivery reservation are one atomic store mutation', async () => {
  const dir = fixture(), store = createTriggerStore({ ...files(dir) }); await store.initialize()
  const webhook = normalizeTriggerDefinition({ id: 'trigger-webhook01', workflowId: 'workflow-one', type: 'webhook', enabled: true, secretRevision: 1, config: {} })
  await store.setSecret(webhook.id, { tokenHash: 'a'.repeat(64), revision: 1 })
  const rejected = await store.reserveWebhook({ trigger: webhook, suppliedTokenHash: 'b'.repeat(64), deliveryKey: 'wrong' })
  if (rejected.authenticated || (await store.list()).total) throw new Error('invalid credential created a delivery')
  const accepted = await store.reserveWebhook({ trigger: webhook, suppliedTokenHash: 'a'.repeat(64), deliveryKey: 'same' })
  const duplicate = await store.reserveWebhook({ trigger: webhook, suppliedTokenHash: 'a'.repeat(64), deliveryKey: 'same' })
  await store.setSecret(webhook.id, { tokenHash: 'c'.repeat(64), revision: 2 })
  const stale = await store.reserveWebhook({ trigger: webhook, suppliedTokenHash: 'a'.repeat(64), deliveryKey: 'later' })
  if (!accepted.authenticated || accepted.duplicate || !duplicate.duplicate || stale.authenticated) throw new Error('atomic authentication/reservation contract failed')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('legacy arrays migrate only after verified adjacent backups and canonical handoff', async () => {
  const dir = fixture(), paths = files(dir), legacy = [{ ...trigger(), tokenHash: 'a'.repeat(64), extra: 'preserved' }]
  fs.writeFileSync(paths.storeFile, JSON.stringify(legacy)); fs.writeFileSync(paths.legacyHistoryFile, JSON.stringify([{ id: 'old', at: 10, triggerId: legacy[0].id, workflowId: legacy[0].workflowId, status: 'started', runId: 'run-old', dedupeKey: 'same' }]))
  let migrated = null
  const store = createTriggerStore({ ...paths, migrateConfigurations: async value => { migrated = value } })
  await store.initialize()
  if (migrated?.[0]?.extra !== 'preserved') throw new Error('legacy configuration was not handed to canonical migration')
  const backups = fs.readdirSync(dir).filter(name => name.includes('.backup-'))
  if (backups.length !== 2) throw new Error(`expected two backups, found ${backups.length}`)
  for (const name of backups) if (!fs.readFileSync(path.join(dir, name)).length) throw new Error('backup is empty')
  if (JSON.parse(fs.readFileSync(paths.storeFile)).schemaVersion !== 1) throw new Error('versioned store missing')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('corrupt store fails closed without replacement', async () => {
  const dir = fixture(), paths = files(dir); fs.writeFileSync(paths.storeFile, '{not-json')
  const before = fs.readFileSync(paths.storeFile, 'utf8'), store = createTriggerStore({ ...paths })
  await store.initialize().then(() => { throw new Error('corruption unexpectedly accepted') }, error => { if (!/disabled|corrupt/i.test(error.message)) throw error })
  if (fs.readFileSync(paths.storeFile, 'utf8') !== before || store.status().enabled) throw new Error('corrupt input was replaced or enabled')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('concurrent same-key reservation produces one durable identity', async () => {
  const dir = fixture(), store = createTriggerStore({ ...files(dir) }); await store.initialize()
  const results = await Promise.all(Array.from({ length: 40 }, () => store.reserve({ trigger: trigger(), deliveryKey: 'same-key', source: 'test', workflowVersion: 'version-1' })))
  if (results.filter(item => !item.duplicate).length !== 1 || new Set(results.map(item => item.delivery.id)).size !== 1) throw new Error('reservation was not atomic')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('bounded history retention does not define deduplication identity', async () => {
  const dir = fixture(), store = createTriggerStore({ ...files(dir), retention: { history: 10, identities: 100 } }); await store.initialize()
  const first = await store.reserve({ trigger: trigger(), deliveryKey: 'first', source: 'test' }); await store.transition(first.delivery.id, 'started', { runId: 'run-first' })
  for (let index = 0; index < 25; index++) { const item = await store.reserve({ trigger: trigger(), deliveryKey: `key-${index}`, source: 'test' }); await store.transition(item.delivery.id, 'failed', { evidence: { reason: 'fixture' } }) }
  const history = await store.list({ limit: 100 }), duplicate = await store.reserve({ trigger: trigger(), deliveryKey: 'first', source: 'test' })
  if (history.items.length > 10 || !duplicate.duplicate || duplicate.delivery.runId !== 'run-first') throw new Error('dedupe incorrectly depended on retained history')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('history evidence redacts secrets, URLs, paths, and never stores inputs', async () => {
  const error = normalizeError(new Error('token=abc https://example.test/private /Users/alice/secret.txt'))
  if (/abc|example\.test|alice|secret\.txt/.test(JSON.stringify(error))) throw new Error(JSON.stringify(error))
  const dir = fixture(), store = createTriggerStore({ ...files(dir) }); await store.initialize()
  const reserved = await store.reserve({ trigger: trigger(), deliveryKey: 'redact', source: 'webhook' })
  await store.transition(reserved.delivery.id, 'failed', { evidence: { error, payload: 'must-not-persist' } })
  if (fs.readFileSync(files(dir).storeFile, 'utf8').includes('must-not-persist')) throw new Error('unrestricted evidence persisted')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('canonical workflow trigger normalization preserves safe extensions', async () => {
  const workflow = migrateWorkflowDocument({ schemaVersion: 2, id: 'workflow-one', name: 'One', nodes: [], edges: [], triggers: [{ ...trigger(), extension: { owner: 'fixture' } }] })
  if (workflow.triggers[0].extension.owner !== 'fixture' || workflow.triggers[0].workflowId !== workflow.id) throw new Error('canonical trigger normalization lost data')
})

await test('stale ordinary workflow saves cannot erase or overwrite canonical triggers', async () => {
  const current = { id: 'workflow-one', name: 'Current', nodes: [], edges: [], triggers: [{ ...trigger(), enabled: false, updatedAt: 20 }] }
  const stale = { id: 'workflow-one', name: 'Edited canvas', nodes: [], edges: [], triggers: [{ ...trigger(), enabled: true, updatedAt: 2 }] }
  const merged = mergeWorkflowDocuments(current, stale)
  if (merged.triggers.length !== 1 || merged.triggers[0].enabled !== false || merged.triggers[0].updatedAt !== 20) throw new Error('stale save replaced canonical trigger state')
})

await test('canonical mutation rejects nonexistent and locked workflows', async () => {
  const dir = fixture(), workflowDir = path.join(dir, 'workflows'), versionDir = path.join(dir, 'versions'); fs.mkdirSync(workflowDir); fs.mkdirSync(versionDir)
  const adapter = createWorkflowTriggerAdapter({ workflowDir, versionDir })
  await adapter.mutate('create', trigger()).then(() => { throw new Error('missing workflow accepted') }, error => { if (error.code !== 'WORKFLOW_NOT_FOUND') throw error })
  fs.writeFileSync(path.join(workflowDir, 'workflow-one.json'), JSON.stringify({ schemaVersion: 2, id: 'workflow-one', name: 'Locked', nodes: [], edges: [], triggers: [], governance: { status: 'production', locked: true } }))
  await adapter.mutate('create', trigger()).then(() => { throw new Error('locked workflow accepted') }, error => { if (error.code !== 'WORKFLOW_LOCKED') throw error })
  if (adapter.list('workflow-one').length) throw new Error('rejected mutation changed the workflow')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('webhook permission is least-privilege while revocation remains safety-reducing', async () => {
  const dir = fixture(), workflowDir = path.join(dir, 'workflows'), versionDir = path.join(dir, 'versions'); fs.mkdirSync(workflowDir); fs.mkdirSync(versionDir)
  const adapter = createWorkflowTriggerAdapter({ workflowDir, versionDir }), webhook = normalizeTriggerDefinition({ id: 'trigger-webhook02', workflowId: 'workflow-one', type: 'webhook', config: {} })
  fs.writeFileSync(path.join(workflowDir, 'workflow-one.json'), JSON.stringify({ schemaVersion: 2, id: 'workflow-one', name: 'Denied', nodes: [], edges: [], triggers: [webhook], permissions: { 'receive-webhooks': false } }))
  for (const operation of ['create', 'enable', 'rotate', 'delivery']) {
    let rejected = false
    try { adapter.authorizeWebhook(webhook, { operation }) } catch (error) { rejected = error.code === 'WEBHOOK_PERMISSION_DENIED' }
    if (!rejected) throw new Error(`${operation} bypassed receive-webhooks denial`)
  }
  if (!adapter.authorizeWebhook(webhook, { operation: 'revoke' })) throw new Error('safety-reducing revoke was denied')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('delivery provenance pins exact workflow version and safe identities', async () => {
  const dir = fixture(), store = createTriggerStore({ ...files(dir) }); await store.initialize()
  const item = await store.reserve({ trigger: trigger(), deliveryKey: 'provenance', source: 'cron', workflowVersion: '2026-version-abc' })
  if (item.delivery.workflowVersion !== '2026-version-abc' || item.delivery.workflowId !== 'workflow-one' || item.delivery.triggerId !== trigger().id || item.delivery.deliveryKey !== redactedDeliveryKey('provenance')) throw new Error('delivery provenance mismatch')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('persisted run idempotency returns the exact run and rejects identity reuse', async () => {
  const dir = fixture(), context = normalizeTriggerContext({ deliveryId: 'delivery-aaaaaaaaaaaaaaaaaaaaaaaa', deliveryKey: 'b'.repeat(64), triggerId: trigger().id, workflowId: 'workflow-one', workflowVersion: 'v1', source: 'fixture' })
  const run = { id: 'run-one', workflowId: 'workflow-one', workflowVersion: 'v1', triggerContext: context }
  fs.writeFileSync(path.join(dir, 'run-one.json'), JSON.stringify(run))
  if (findTriggerRun({ runsDir: dir, context, workflowId: 'workflow-one', workflowVersion: 'v1' })?.id !== 'run-one') throw new Error('persisted idempotent run was not found')
  await Promise.resolve().then(() => findTriggerRun({ runsDir: dir, context: { ...context, deliveryKey: 'c'.repeat(64) }, workflowId: 'workflow-one', workflowVersion: 'v1' })).then(() => { throw new Error('conflicting identity was accepted') }, error => { if (error.code !== 'TRIGGER_RUN_IDENTITY_CONFLICT') throw error })
  fs.rmSync(dir, { recursive: true, force: true })
})

for (const window of ['before-request', 'during-request', 'after-run-create', 'before-started-transition']) {
  await test(`crash replay ${window} converges on one run`, async () => {
    const dir = fixture(), paths = files(dir), store = createTriggerStore({ ...paths }); await store.initialize()
    const reservation = await store.reserve({ trigger: trigger(), deliveryKey: `crash-${window}`, source: 'interval', workflowVersion: 'v1' })
    if (window !== 'before-request') await store.transition(reservation.delivery.id, 'starting')
    const runs = new Map(), start = delivery => { if (!runs.has(delivery.id)) runs.set(delivery.id, `run-${delivery.id}`); return runs.get(delivery.id) }
    if (['after-run-create', 'before-started-transition'].includes(window)) start(reservation.delivery)
    const recovered = (await store.pending())[0], runId = start(recovered)
    await store.transition(recovered.id, 'started', { runId, evidence: { recovered: true } })
    const replay = await store.reserve({ trigger: trigger(), deliveryKey: `crash-${window}`, source: 'interval', workflowVersion: 'v1' })
    if (!replay.duplicate || replay.delivery.runId !== runId || runs.size !== 1) throw new Error('replay created a second run')
    fs.rmSync(dir, { recursive: true, force: true })
  })
}

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
