import fs from 'fs'
import path from 'path'
import { setTimeout as wait } from 'timers/promises'

const base = process.env.COMMAND_CENTER_URL || 'http://127.0.0.1:1717'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(`${base}${route}`, options); let body; try { body = await response.json() } catch { body = {} }; return { response, body } }
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

console.log('== persistent workflow triggers ==')
const workflowId = `trigger-fixture-${Date.now()}`
const workflow = { schemaVersion: 2, id: workflowId, name: 'Trigger fixture', nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'in', target: 'out' }], settings: { localOnly: true } }
let webhook, folderTrigger
const issuedWebhookTokens = []
const invokeWebhook = (credential, key, body) => request(credential.webhookEndpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential.webhookToken}`, 'idempotency-key': key }, body: JSON.stringify(body) })
const credentialMutation = (id, action, expectedRevision, key = '') => request(`/api/triggers/${id}/webhook-secret/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-intent': 'webhook-credential-change', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify({ expectedRevision }) })

await test('webhook trigger issues a one-time secret and stores no plaintext token', async () => {
  const saved = await request('/api/workflows', { method: 'POST', ...json(workflow) }); if (!saved.response.ok) throw new Error(JSON.stringify(saved.body))
  const created = await request(`/api/workflows/${workflowId}/triggers`, { method: 'POST', ...json({ type: 'webhook', config: {} }) })
  if (created.response.status !== 201 || !created.body.webhookToken || !created.body.webhookEndpoint || created.body.webhookPath) throw new Error(JSON.stringify(created.body))
  if (created.response.headers.get('cache-control') !== 'no-store') throw new Error('credential response was cacheable')
  webhook = created.body
  issuedWebhookTokens.push(webhook.webhookToken)
  const listed = await request(`/api/triggers?workflowId=${workflowId}`)
  if (JSON.stringify(listed.body).includes(webhook.webhookToken) || JSON.stringify(listed.body).includes('tokenHash')) throw new Error('trigger listing leaked token material')
})

await test('secure webhook rejects invalid token and starts a workflow with valid token', async () => {
  const wrong = await request(`/api/triggers/webhook/${webhook.id}/wrong`, { method: 'POST', ...json({ value: 1 }) }); if (wrong.response.status !== 404) throw new Error(`wrong token returned ${wrong.response.status}`)
  const valid = await invokeWebhook(webhook, 'fixture-one', { value: 2 })
  if (valid.response.status !== 202 || !valid.body.runId) throw new Error(JSON.stringify(valid.body))
  await wait(200)
  const history = await request(`/api/triggers/history?triggerId=${webhook.id}`)
  if (!history.body.some(item => item.runId === valid.body.runId && item.status === 'started')) throw new Error('trigger history missing started run')
})

await test('webhook idempotency key prevents duplicate delivery', async () => {
  const repeat = await invokeWebhook(webhook, 'fixture-one', { value: 3 })
  if (!repeat.body.duplicate) throw new Error(JSON.stringify(repeat.body))
})

await test('simultaneous webhook delivery converges on one redacted delivery and one run', async () => {
  const requests = await Promise.all(Array.from({ length: 12 }, (_, index) => invokeWebhook(webhook, 'fixture-concurrent', { value: index, secret: 'must-not-be-recorded' })))
  if (requests.some(item => item.response.status !== 202)) throw new Error(JSON.stringify(requests.map(item => item.response.status)))
  if (requests.filter(item => item.body.duplicate).length !== 11) throw new Error('expected exactly one accepted delivery and eleven duplicates')
  const deliveryIds = [...new Set(requests.map(item => item.body.deliveryId).filter(Boolean))]
  if (deliveryIds.length !== 1) throw new Error(`expected one stable delivery identity, got ${deliveryIds.length}`)
  let page
  for (let i = 0; i < 20; i++) {
    page = (await request(`/api/triggers/history?triggerId=${webhook.id}&limit=100`)).body
    const matching = page.items?.find(item => item.id === deliveryIds[0])
    if (matching?.runId && matching.evidence?.runStatus === 'done') break
    await wait(100)
  }
  const record = page.items?.find(item => item.id === deliveryIds[0])
  if (!record?.runId || record.evidence?.duplicate !== true) throw new Error('concurrent delivery did not converge on one run-backed duplicate-marked record')
  const filtered = await request(`/api/triggers/history?triggerId=${webhook.id}&runId=${record.runId}&limit=10`)
  if (filtered.body.total !== 1 || filtered.body.items?.[0]?.id !== record.id) throw new Error('paginated run filter did not return the exact delivery')
  const serialized = JSON.stringify(record)
  if (serialized.includes('must-not-be-recorded') || serialized.includes(webhook.webhookToken) || serialized.includes('tokenHash')) throw new Error('delivery history leaked request or token material')
  if (record.evidence?.runStatus !== 'done') throw new Error('terminal run status was not linked to the delivery')
})

await test('webhook rotation is generation-guarded, one-time, and invalidates the old credential', async () => {
  const key = `rotate-${Date.now()}`
  const rotated = await credentialMutation(webhook.id, 'rotate', webhook.secretRevision, key)
  if (rotated.response.status !== 200 || !rotated.body.webhookToken || rotated.body.secretRevision !== webhook.secretRevision + 1 || rotated.response.headers.get('cache-control') !== 'no-store') throw new Error(JSON.stringify(rotated.body))
  const replay = await credentialMutation(webhook.id, 'rotate', webhook.secretRevision, key)
  if (replay.response.status !== 200 || !replay.body.duplicate || replay.body.webhookToken || replay.body.webhookEndpoint) throw new Error(`rotation replay leaked or mutated: ${JSON.stringify(replay.body)}`)
  const old = await invokeWebhook(webhook, 'old-after-rotate', { value: 'old' })
  if (old.response.status !== 404) throw new Error(`old credential returned ${old.response.status}`)
  webhook = { ...webhook, ...rotated.body }
  issuedWebhookTokens.push(webhook.webhookToken)
  const valid = await invokeWebhook(webhook, 'new-after-rotate', { value: 'new' })
  if (valid.response.status !== 202) throw new Error(JSON.stringify(valid.body))
  const listed = await request(`/api/triggers?workflowId=${workflowId}`), serialized = JSON.stringify(listed.body)
  const row = listed.body.find(item => item.id === webhook.id)
  if (row?.webhookCredentialStatus !== 'active' || serialized.includes(webhook.webhookToken) || serialized.includes('tokenHash') || serialized.includes('operationKeyHash')) throw new Error('safe webhook status projection failed')
})

await test('concurrent webhook rotations admit exactly one expected revision', async () => {
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) => credentialMutation(webhook.id, 'rotate', webhook.secretRevision, `rotation-race-${index}-${Date.now()}`)))
  const winners = attempts.filter(item => item.response.status === 200 && item.body.webhookToken)
  if (winners.length !== 1 || attempts.filter(item => item.response.status === 409).length !== 11) throw new Error(JSON.stringify(attempts.map(item => ({ status: item.response.status, body: item.body }))))
  webhook = { ...webhook, ...winners[0].body }
  issuedWebhookTokens.push(webhook.webhookToken)
  if ((await invokeWebhook(webhook, 'rotation-race-winner', {})).response.status !== 202) throw new Error('winning rotation credential was not usable')
})

await test('webhook revocation survives disable and re-enable until an explicit rotation', async () => {
  const revoked = await credentialMutation(webhook.id, 'revoke', webhook.secretRevision)
  if (revoked.response.status !== 200 || revoked.body.webhookCredentialStatus !== 'revoked') throw new Error(JSON.stringify(revoked.body))
  const replay = await credentialMutation(webhook.id, 'revoke', webhook.secretRevision)
  if (replay.response.status !== 200 || !replay.body.duplicate || replay.body.secretRevision !== revoked.body.secretRevision) throw new Error(`revocation replay was not idempotent: ${JSON.stringify(replay.body)}`)
  const denied = await invokeWebhook(webhook, 'after-revoke', {})
  if (denied.response.status !== 404) throw new Error(`revoked credential returned ${denied.response.status}`)
  await request(`/api/triggers/${webhook.id}`, { method: 'PUT', ...json({ enabled: false }) })
  await request(`/api/triggers/${webhook.id}`, { method: 'PUT', ...json({ enabled: true }) })
  const stillDenied = await invokeWebhook(webhook, 'after-reenable', {})
  if (stillDenied.response.status !== 404) throw new Error('re-enable resurrected a revoked credential')
  const rotated = await credentialMutation(webhook.id, 'rotate', revoked.body.secretRevision, `reactivate-${Date.now()}`)
  if (!rotated.body.webhookToken) throw new Error(JSON.stringify(rotated.body))
  webhook = { ...webhook, ...rotated.body }
  issuedWebhookTokens.push(webhook.webhookToken)
  if ((await invokeWebhook(webhook, 'after-reactivate', {})).response.status !== 202) throw new Error('explicit post-revocation rotation did not reactivate credential')
})

await test('webhook plaintext credentials never enter durable product state or audit logs', async () => {
  const files = [path.resolve('data/workflow-triggers.json'), path.resolve('data/audit.log'), path.resolve(`data/workflows/${workflowId}.json`)]
  const versionRoot = path.resolve('data/workflow-versions')
  if (fs.existsSync(versionRoot)) for (const name of fs.readdirSync(versionRoot)) if (name.includes(workflowId)) files.push(path.join(versionRoot, name))
  const persisted = files.filter(file => fs.existsSync(file) && fs.statSync(file).isFile()).map(file => fs.readFileSync(file, 'utf8')).join('\n')
  for (const token of issuedWebhookTokens) if (persisted.includes(token)) throw new Error(`plaintext credential leaked into durable state: ${path.basename(files.find(file => fs.readFileSync(file, 'utf8').includes(token)) || '')}`)
  if (/workflow_webhook_secret_(?:rotated|revoked).*?(?:tokenHash|webhookToken|webhookEndpoint|idempotency)/i.test(persisted)) throw new Error('credential metadata leaked into an audit event')
})

await test('watched folder emits redacted create, modify, and rename deliveries exactly once', async () => {
  const directory = path.resolve('state/.fixture-trigger-folder'); fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory, { recursive: true })
  const created = await request(`/api/workflows/${workflowId}/triggers`, { method: 'POST', ...json({ type: 'folder', config: { path: directory, pollMs: 1000, settleMs: 0, debounceMs: 0, extensions: ['txt'] } }) })
  if (created.response.status !== 201) throw new Error(JSON.stringify(created.body)); folderTrigger = created.body
  const file = path.join(directory, 'new.txt'), renamed = path.join(directory, 'renamed.txt')
  const waitForEvents = async count => {
    let events = []
    for (let i = 0; i < 12; i++) { await wait(500); events = (await request(`/api/triggers/history?triggerId=${folderTrigger.id}`)).body; if (events.filter(item => item.status === 'started').length >= count) return events }
    throw new Error(`folder history did not reach ${count} started deliveries`)
  }
  fs.writeFileSync(file, 'trigger me'); await waitForEvents(1)
  fs.writeFileSync(file, 'trigger me again with a different size'); await waitForEvents(2)
  fs.renameSync(file, renamed); const events = await waitForEvents(3)
  await wait(1200)
  const finalEvents = (await request(`/api/triggers/history?triggerId=${folderTrigger.id}`)).body.filter(item => item.status === 'started')
  fs.rmSync(directory, { recursive: true, force: true })
  const types = finalEvents.map(item => item.evidence?.event).sort()
  if (finalEvents.length !== 3 || types.join(',') !== 'created,modified,renamed') throw new Error(JSON.stringify(finalEvents))
  const serialized = JSON.stringify(events)
  if (serialized.includes('new.txt') || serialized.includes('renamed.txt') || serialized.includes(directory)) throw new Error('folder delivery evidence leaked a filesystem path')
})

await test('trigger lifecycle supports disable and delete', async () => {
  const disabled = await request(`/api/triggers/${webhook.id}`, { method: 'PUT', ...json({ enabled: false }) }); if (disabled.body.enabled !== false) throw new Error(JSON.stringify(disabled.body))
  for (const id of [webhook.id, folderTrigger.id]) { const removed = await request(`/api/triggers/${id}`, { method: 'DELETE' }); if (!removed.response.ok) throw new Error(JSON.stringify(removed.body)) }
  await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
