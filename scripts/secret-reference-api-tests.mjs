import assert from 'node:assert/strict'
import express from 'express'
import { createSecretReferenceRouter } from '../server/secrets/router.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }

const records = new Map(), values = new Map(), audits = []
let now = 100
const registry = {
  list: () => [...records.values()].map(record => ({ ...record, configured: values.has(record.id), status: values.has(record.id) ? 'connected' : 'missing', secretStore: 'test-keychain' })),
  put: ({ id, label, value }) => {
    if (!value) throw Object.assign(new Error('secret value is required'), { code: 'SECRET_VALUE_INVALID' })
    const prior = records.get(id), record = { id, label: String(label || prior?.label || id), revision: (prior?.revision || 0) + 1, createdAt: prior?.createdAt || now, updatedAt: ++now }
    records.set(id, record); values.set(id, String(value)); return { ...record, configured: true, secretStore: 'test-keychain' }
  },
  remove: id => { records.delete(id); values.delete(id); return { ok: true } },
}
const usage = id => id === 'used.reference' ? [{ type: 'workflow', id: 'wf-1', name: 'Fixture' }] : []
const app = express()
app.use(express.json({ limit: '32kb' }))
app.use('/api/secret-references', createSecretReferenceRouter({ registry, usage, appendAudit: (event, detail) => audits.push({ event, detail }) }))
const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)) })
const base = `http://127.0.0.1:${server.address().port}/api/secret-references`
const request = (url = '', options = {}) => fetch(`${base}${url}`, options)
const write = (method, url, body, intent = true) => request(url, { method, headers: { 'content-type': 'application/json', ...(intent ? { 'x-command-center-intent': 'secret-reference-change' } : {}) }, body: JSON.stringify(body) })

console.log('== secret reference API ==')
await test('write operations require an explicit JSON intent', async () => {
  const response = await write('POST', '', { id: 'mcp.example', value: 'never-return-this' }, false)
  assert.equal(response.status, 400)
})
await test('create returns metadata only and disables response caching', async () => {
  const secret = 'never-return-this', response = await write('POST', '', { id: 'mcp.example', label: 'Example', value: secret })
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json(); assert.equal(body.id, 'mcp.example'); assert.equal(body.revision, 1); assert.equal(JSON.stringify(body).includes(secret), false)
  assert.equal(audits[0].detail.id, 'mcp.example'); assert.equal(JSON.stringify(audits).includes(secret), false)
})
await test('listing and usage expose bounded metadata but never values', async () => {
  const response = await request(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json(); assert.equal(body[0].configured, true); assert.equal(JSON.stringify(body).includes(values.get('mcp.example')), false)
  const usageResponse = await request('/used.reference/usage'); assert.deepEqual(await usageResponse.json(), [{ type: 'workflow', id: 'wf-1', name: 'Fixture' }])
})
await test('rotation is optimistic and never echoes the new value', async () => {
  let response = await write('PUT', '/mcp.example/value', { expectedRevision: 9, value: 'rotated-secret' }); assert.equal(response.status, 409)
  response = await write('PUT', '/mcp.example/value', { expectedRevision: 1, value: 'rotated-secret' }); assert.equal(response.status, 200)
  const body = await response.json(); assert.equal(body.revision, 2); assert.equal(JSON.stringify(body).includes('rotated-secret'), false)
})
await test('deletion requires the exact revision and rejects active bindings', async () => {
  await write('POST', '', { id: 'used.reference', value: 'bound-secret' })
  let response = await write('DELETE', '/used.reference', { expectedRevision: 1 }); assert.equal(response.status, 409); assert.equal((await response.json()).usage.length, 1)
  response = await write('DELETE', '/mcp.example', { expectedRevision: 1 }); assert.equal(response.status, 409)
  response = await write('DELETE', '/mcp.example', { expectedRevision: 2 }); assert.equal(response.status, 200); assert.equal(records.has('mcp.example'), false)
})

server.close()
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
if (failed) process.exit(1)
