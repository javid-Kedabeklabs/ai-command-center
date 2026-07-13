import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync as defaultExecFileSync } from 'node:child_process'

const SAFE_REFERENCE = /^[a-z][a-z0-9._-]{2,79}$/

export function normalizeSecretReferenceId(value) {
  const id = String(value || '').trim().toLowerCase()
  if (!SAFE_REFERENCE.test(id)) throw Object.assign(new Error('secret reference must use 3-80 lowercase letters, numbers, dots, underscores, or hyphens'), { code: 'SECRET_REFERENCE_INVALID' })
  return id
}

export function createMacKeychainSecretStore({ account = 'ai-command-center', servicePrefix = 'ai-command-center-secret-', execFileSync = defaultExecFileSync } = {}) {
  const service = id => `${servicePrefix}${normalizeSecretReferenceId(id)}`
  function get(id) {
    try { return String(execFileSync('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service(id), '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '').replace(/\r?\n$/, '') }
    catch (error) { if (Number(error?.status) === 44) return ''; throw Object.assign(new Error('macOS Keychain access was denied or unavailable'), { code: 'SECRET_REFERENCE_DENIED' }) }
  }
  function put(id, value) {
    const secret = String(value ?? '')
    if (!secret || secret.length > 16_384 || secret.includes('\0')) throw Object.assign(new Error('secret value must contain 1-16384 non-NUL characters'), { code: 'SECRET_VALUE_INVALID' })
    execFileSync('/usr/bin/security', ['add-generic-password', '-U', '-a', account, '-s', service(id), '-w', secret], { stdio: 'ignore' })
    if (get(id) !== secret) throw Object.assign(new Error('Keychain verification failed'), { code: 'SECRET_STORE_FAILED' })
  }
  function remove(id) { try { execFileSync('/usr/bin/security', ['delete-generic-password', '-a', account, '-s', service(id)], { stdio: 'ignore' }) } catch {} }
  function configured(id) { try { execFileSync('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service(id)], { stdio: 'ignore' }); return true } catch (error) { if (Number(error?.status) === 44) return false; throw Object.assign(new Error('macOS Keychain access was denied or unavailable'), { code: 'SECRET_REFERENCE_DENIED' }) } }
  return { get, put, remove, configured }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

export function createSecretReferenceRegistry({ file, keychain, clock = Date.now } = {}) {
  if (!file || !keychain) throw new Error('secret reference registry requires file and keychain')
  const load = () => {
    if (!fs.existsSync(file)) return { schemaVersion: 1, references: {} }
    let raw
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw Object.assign(new Error('secret reference registry is corrupt'), { code: 'SECRET_REFERENCE_STORE_CORRUPT' }) }
    if (raw?.schemaVersion !== 1 || !raw.references || typeof raw.references !== 'object' || Array.isArray(raw.references)) throw Object.assign(new Error('secret reference registry has an unsupported shape'), { code: 'SECRET_REFERENCE_STORE_CORRUPT' })
    const references = {}
    for (const [key, value] of Object.entries(raw.references)) {
      const id = normalizeSecretReferenceId(key)
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(field => !['id', 'label', 'revision', 'createdAt', 'updatedAt'].includes(field))) throw Object.assign(new Error('secret reference metadata is corrupt'), { code: 'SECRET_REFERENCE_STORE_CORRUPT' })
      references[id] = { id, label: String(value.label || id).slice(0, 120), revision: Math.max(1, Math.floor(Number(value.revision) || 1)), createdAt: Number(value.createdAt) || 0, updatedAt: Number(value.updatedAt) || 0 }
    }
    return { schemaVersion: 1, references }
  }
  function list() { const state = load(); return Object.values(state.references).sort((a, b) => a.id.localeCompare(b.id)).map(item => { try { const configured = keychain.configured(item.id); return { ...item, configured, status: configured ? 'connected' : 'missing', secretStore: 'macos-keychain' } } catch { return { ...item, configured: false, status: 'denied', secretStore: 'macos-keychain' } } }) }
  function put({ id: rawId, label, value }) {
    const id = normalizeSecretReferenceId(rawId), state = load(), now = clock(), prior = state.references[id]
    keychain.put(id, value)
    state.references[id] = { id, label: String(label || prior?.label || id).trim().slice(0, 120) || id, revision: (prior?.revision || 0) + 1, createdAt: prior?.createdAt || now, updatedAt: now }
    atomicWrite(file, state)
    return { ...state.references[id], configured: true, secretStore: 'macos-keychain' }
  }
  function remove(rawId) { const id = normalizeSecretReferenceId(rawId), state = load(); keychain.remove(id); delete state.references[id]; atomicWrite(file, state); return { ok: true } }
  function resolve(rawId) {
    const id = normalizeSecretReferenceId(rawId), state = load()
    if (!state.references[id]) throw Object.assign(new Error(`secret reference "${id}" is not registered`), { code: 'SECRET_REFERENCE_MISSING' })
    const value = keychain.get(id)
    if (!value) throw Object.assign(new Error(`secret reference "${id}" is not configured`), { code: 'SECRET_REFERENCE_MISSING' })
    return value
  }
  return { list, put, remove, resolve, file }
}
