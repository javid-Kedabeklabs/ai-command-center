import assert from 'node:assert/strict'
import { authorizedHttpHeaders, remoteMcpAuthOptions, resolveBearerReference, validateCredentialSafeHttpUrl } from '../server/secrets/runtime.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
const values = new Map([['http.example', 'http-fixture-value'], ['mcp.example', 'mcp-fixture-value']])
const registry = { resolve: id => { if (!values.has(id)) throw Object.assign(new Error(`secret reference "${id}" is not configured`), { code: 'SECRET_REFERENCE_MISSING' }); return values.get(id) } }

console.log('== secret reference execution boundary ==')
await test('bearer references resolve only through the supplied registry', () => {
  assert.deepEqual(resolveBearerReference('MCP.Example', registry), { id: 'mcp.example', value: 'mcp-fixture-value' })
  assert.throws(() => resolveBearerReference('missing.example', registry), error => error.code === 'SECRET_REFERENCE_MISSING' && !error.message.includes('fixture-value'))
})
await test('HTTP headers preserve safe metadata and inject a resolved bearer credential', () => {
  assert.deepEqual(authorizedHttpHeaders({ headers: { accept: 'application/json' }, authRef: 'http.example', authMode: 'bearer' }, registry), { accept: 'application/json', authorization: 'Bearer http-fixture-value' })
})
await test('persisted inline credential headers fail closed', () => {
  for (const key of ['authorization', 'Cookie', 'x-api-key']) assert.throws(() => authorizedHttpHeaders({ headers: { [key]: 'inline-secret' } }, registry), /inline HTTP credential/)
  assert.throws(() => authorizedHttpHeaders({ authRef: 'http.example', authMode: 'basic' }, registry), /bearer/)
})
await test('inline URL credentials fail closed while safe query metadata remains usable', () => {
  assert.equal(validateCredentialSafeHttpUrl('https://example.com/path?page=2'), 'https://example.com/path?page=2')
  assert.throws(() => validateCredentialSafeHttpUrl('https://user:pass@example.com/path'), /use authRef/)
  assert.throws(() => validateCredentialSafeHttpUrl('https://example.com/path?api_key=raw'), /use authRef/)
})
await test('header injection and missing references fail before transport', () => {
  const hostile = { resolve: () => 'safe\r\ninjected: value' }
  assert.throws(() => remoteMcpAuthOptions({ authRef: 'mcp.example' }, hostile), error => error.code === 'SECRET_REFERENCE_INVALID_VALUE')
  assert.deepEqual(remoteMcpAuthOptions({}, registry), {})
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
if (failed) process.exit(1)
