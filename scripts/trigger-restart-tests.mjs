import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const base = 'http://127.0.0.1:1717'; let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, options = {}) { const response = await fetch(base + route); const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { response, body } }
async function send(route, method, body) { const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }); let value; try { value = await response.json() } catch { value = {} }; return { response, body: value } }
async function waitHealthy() { for (let i = 0; i < 30; i++) { try { const result = await request('/api/system'); if (result.response.ok) return } catch {}; await new Promise(resolve => setTimeout(resolve, 200)) } throw new Error('server did not become healthy') }
async function restart() { execFileSync(process.execPath, ['scripts/autonomy/host-operation.mjs', 'enqueue', '--task', 'trigger-restart-test', '--operation', 'service.reload', '--resource', 'command-center-service', '--params', '{}'], { stdio: 'ignore' }); execFileSync(process.execPath, ['scripts/autonomy/host-operation.mjs', 'process-once'], { stdio: 'ignore' }); await waitHealthy() }
async function credentialMutation(id, action, expectedRevision, key = '') { const response = await fetch(`${base}/api/triggers/${id}/webhook-secret/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-intent': 'webhook-credential-change', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify({ expectedRevision }) }); return { response, body: await response.json() } }
async function invokeWebhook(credential, key) { const response = await fetch(`${base}${credential.webhookEndpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential.webhookToken}`, 'idempotency-key': key }, body: '{}' }); return { response, body: await response.json() } }

console.log('== trigger restart recovery ==')
const workflowId = 'trigger-restart-fixture'
const workflow = { schemaVersion: 2, id: workflowId, name: 'Trigger restart fixture', nodes: [{ id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } }, { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } }], edges: [{ id: 'e', source: 'in', target: 'out' }] }
let trigger, cronTrigger, webhookTrigger
await test('persistent interval configuration is created', async () => { await send('/api/workflows', 'POST', workflow); const created = await send(`/api/workflows/${workflowId}/triggers`, 'POST', { type: 'interval', config: { intervalMs: 1000, input: 'after restart' } }); if (!created.response.ok) throw new Error(JSON.stringify(created.body)); trigger = created.body })
await test('enabled trigger reloads and fires after application restart', async () => {
  await restart()
  let history = []
  for (let i = 0; i < 15; i++) { await new Promise(resolve => setTimeout(resolve, 250)); history = (await request(`/api/triggers/history?triggerId=${trigger.id}`)).body; if (history.some(item => item.status === 'started')) break }
  const listed = (await request(`/api/triggers?workflowId=${workflowId}`)).body
  if (!listed.some(item => item.id === trigger.id && item.enabled) || !history.some(item => item.status === 'started')) throw new Error(JSON.stringify({ listed, history }))
})
await test('cron intended-instant cursor remains stable across restart without waiting for a minute boundary', async () => {
  // Keep the next intended instant comfortably beyond the restart window so
  // this assertion cannot become a minute-boundary race on a slow host.
  const target = new Date(Date.now() + 5 * 60_000)
  const cron = `${target.getUTCMinutes()} ${target.getUTCHours()} * * *`
  const created = await send(`/api/workflows/${workflowId}/triggers`, 'POST', { type: 'cron', config: { cron, timezone: 'UTC', misfirePolicy: 'skip', overlapPolicy: 'skip', maxCatchUp: 1, input: 'cursor only' } })
  if (!created.response.ok) throw new Error(JSON.stringify(created.body)); cronTrigger = created.body
  const storeFile = path.resolve('data/workflow-triggers.json')
  let before
  for (let i = 0; i < 20; i++) { const store = JSON.parse(fs.readFileSync(storeFile, 'utf8')); before = store.schedules?.[cronTrigger.id]; if (before?.nextFireAt) break; await new Promise(resolve => setTimeout(resolve, 50)) }
  if (!before?.nextFireAt || !/^[a-f0-9]{64}$/.test(before.scheduleDefinitionHash || '')) throw new Error('cron cursor did not persist')
  await restart()
  const after = JSON.parse(fs.readFileSync(storeFile, 'utf8')).schedules?.[cronTrigger.id]
  if (!after || after.nextFireAt !== before.nextFireAt || after.scheduleDefinitionHash !== before.scheduleDefinitionHash) throw new Error(JSON.stringify({ before, after }))
})
await test('rotated and revoked webhook credentials retain exact state across restart', async () => {
  const created = await send(`/api/workflows/${workflowId}/triggers`, 'POST', { type: 'webhook', config: {} })
  if (!created.response.ok) throw new Error(JSON.stringify(created.body)); webhookTrigger = created.body
  const rotated = await credentialMutation(webhookTrigger.id, 'rotate', webhookTrigger.secretRevision, `restart-rotate-${Date.now()}`)
  if (!rotated.response.ok || !rotated.body.webhookToken) throw new Error(JSON.stringify(rotated.body))
  const old = webhookTrigger; webhookTrigger = { ...webhookTrigger, ...rotated.body }
  await restart()
  if ((await invokeWebhook(old, 'restart-old')).response.status !== 404 || (await invokeWebhook(webhookTrigger, 'restart-new')).response.status !== 202) throw new Error('rotation state changed across restart')
  const revoked = await credentialMutation(webhookTrigger.id, 'revoke', webhookTrigger.secretRevision)
  if (!revoked.response.ok) throw new Error(JSON.stringify(revoked.body))
  await restart()
  const listed = (await request(`/api/triggers?workflowId=${workflowId}`)).body.find(item => item.id === webhookTrigger.id)
  if ((await invokeWebhook(webhookTrigger, 'restart-revoked')).response.status !== 404 || listed?.webhookCredentialStatus !== 'revoked') throw new Error('revocation state changed across restart')
})
for (const item of [trigger, cronTrigger, webhookTrigger]) if (item?.id) await send(`/api/triggers/${item.id}`, 'DELETE'); await send(`/api/workflows/${workflowId}`, 'DELETE')
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`); process.exitCode = failed ? 1 : 0
