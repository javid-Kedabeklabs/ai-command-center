import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMacKeychainSecretStore, createSecretReferenceRegistry, normalizeSecretReferenceId } from '../server/secrets/keychain.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-secret-ref-'))

console.log('== Keychain-backed secret references ==')
await test('reference ids are bounded opaque identifiers', () => {
  assert.equal(normalizeSecretReferenceId('MCP.Example'), 'mcp.example')
  for (const value of ['', '../escape', 'a', 'has space', 'x'.repeat(81)]) assert.throws(() => normalizeSecretReferenceId(value))
})
await test('Keychain adapter uses argument arrays and never exposes a secret in errors or metadata', () => {
  const values = new Map(), calls = []
  const execFileSync = (_command, args) => { calls.push(args); const service = args[args.indexOf('-s') + 1]; if (args[0] === 'add-generic-password') { values.set(service, args[args.indexOf('-w') + 1]); return '' } if (args[0] === 'find-generic-password') { if (!values.has(service)) { const error = new Error('not found'); error.status = 44; throw error } return args.includes('-w') ? `${values.get(service)}\n` : '' } if (args[0] === 'delete-generic-password') { values.delete(service); return '' } }
  const keychain = createMacKeychainSecretStore({ execFileSync }), secret = 'fixture-super-secret'
  keychain.put('mcp.example', secret); assert.equal(keychain.get('mcp.example'), secret); keychain.remove('mcp.example'); assert.equal(keychain.get('mcp.example'), '')
  assert(calls.every(args => Array.isArray(args))); assert.throws(() => keychain.put('mcp.example', ''), error => !String(error.message).includes(secret))
  keychain.put('mcp.example', secret); assert.equal(keychain.configured('mcp.example'), true); assert.equal(calls.at(-1).includes('-w'), false)
})
await test('registry persists metadata only and resolves at the privileged boundary', () => {
  const dir = fixture(), values = new Map(), keychain = { put: (id, value) => values.set(id, value), get: id => values.get(id) || '', remove: id => values.delete(id), configured: id => values.has(id) }
  const file = path.join(dir, 'references.json'), registry = createSecretReferenceRegistry({ file, keychain, clock: () => 100 })
  const secret = 'never-persist-this', first = registry.put({ id: 'mcp.example', label: 'Example MCP', value: secret })
  const second = registry.put({ id: 'mcp.example', label: 'Example MCP', value: `${secret}-rotated` }); assert.equal(first.revision, 1); assert.equal(second.revision, 2)
  assert.equal(registry.resolve('mcp.example'), `${secret}-rotated`); assert.equal(registry.list()[0].configured, true)
  const persisted = fs.readFileSync(file, 'utf8'); assert(!persisted.includes(secret)); assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  registry.remove('mcp.example'); assert.throws(() => registry.resolve('mcp.example'), error => error.code === 'SECRET_REFERENCE_MISSING')
  fs.rmSync(dir, { recursive: true, force: true })
})
await test('missing Keychain values and corrupt metadata fail closed', () => {
  const dir = fixture(), file = path.join(dir, 'references.json'), keychain = { put() {}, get: () => '', remove() {}, configured: () => false }
  let registry = createSecretReferenceRegistry({ file, keychain }); assert.throws(() => registry.resolve('mcp.missing'), error => error.code === 'SECRET_REFERENCE_MISSING')
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, references: { 'mcp.example': { id: 'mcp.example', value: 'inline-secret' } } }))
  registry = createSecretReferenceRegistry({ file, keychain }); assert.throws(() => registry.list(), error => error.code === 'SECRET_REFERENCE_STORE_CORRUPT')
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
if (failed) process.exit(1)
