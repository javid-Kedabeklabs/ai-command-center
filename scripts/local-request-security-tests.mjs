import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createLocalRequestGuard, requireMutationIntent } from '../server/security/local-request-guard.js'

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`  PASS ${name}`) }
const app = express(), port = 18471
app.use(createLocalRequestGuard({ port, sessionToken: 'deterministic-session-token' }))
app.use(express.json())
app.get('/api/read', (_req, res) => res.json({ ok: true }))
app.post('/api/write', (req, res) => res.json({ ok: true, value: req.body.value }))
app.post('/api/killall', requireMutationIntent('emergency-stop'), (_req, res) => res.json({ ok: true }))
const server = http.createServer(app)
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
const request = (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, options)
const rawRequest = ({ path = '/', method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
  const outgoing = http.request({ hostname: '127.0.0.1', port, path, method, headers }, response => {
    let text = ''; response.setEncoding('utf8'); response.on('data', chunk => text += chunk); response.on('end', () => resolve({ status: response.statusCode, body: text }))
  })
  outgoing.on('error', reject); if (body) outgoing.write(body); outgoing.end()
})

console.log('== local request boundary ==')
try {
  await test('configured extra origins remain loopback-only', async () => {
    assert.throws(() => createLocalRequestGuard({ port, allowedOrigins: ['https://attacker.example'] }), /loopback HTTP origins/)
  })
  await test('safe GET establishes an HttpOnly Strict local session', async () => {
    const response = await request('/api/read')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('set-cookie') || '', /acc_local_session=deterministic-session-token; Path=\/; HttpOnly; SameSite=Strict/)
  })
  await test('hostile Host is rejected before routing', async () => {
    const response = await rawRequest({ path: '/api/read', headers: { host: 'attacker.example' } })
    assert.equal(response.status, 403); assert.equal(JSON.parse(response.body).code, 'LOCAL_HOST_REJECTED')
  })
  await test('hostile Origin and cross-site fetch metadata are rejected', async () => {
    let response = await request('/api/write', { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'LOCAL_ORIGIN_REJECTED')
    response = await request('/api/write', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'CROSS_SITE_REQUEST_REJECTED')
  })
  await test('same-origin browser mutation requires the established session cookie', async () => {
    const headers = { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }
    let response = await request('/api/write', { method: 'POST', headers, body: '{"value":1}' })
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'LOCAL_SESSION_REQUIRED')
    response = await request('/api/write', { method: 'POST', headers: { ...headers, cookie: 'acc_local_session=deterministic-session-token' }, body: '{"value":1}' })
    assert.equal(response.status, 200); assert.equal((await response.json()).value, 1)
  })
  await test('loopback CLI and internal calls without browser Origin remain compatible', async () => {
    const response = await request('/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":2}' })
    assert.equal(response.status, 200); assert.equal((await response.json()).value, 2)
  })
  await test('emergency stop requires an explicit destructive intent', async () => {
    let response = await request('/api/killall', { method: 'POST' }); assert.equal(response.status, 400)
    response = await request('/api/killall', { method: 'POST', headers: { 'x-command-center-intent': 'emergency-stop' } }); assert.equal(response.status, 200)
  })
} finally { await new Promise(resolve => server.close(resolve)) }
console.log(`local request security tests: ${passed}/7 passed`)
