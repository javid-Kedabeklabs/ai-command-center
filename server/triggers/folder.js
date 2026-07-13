import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const FOLDER_SNAPSHOT_VERSION = 1
export const FOLDER_CANDIDATE_VERSION = 1
export const FOLDER_OPERATIONAL_VERSION = 1

const DEFAULTS = Object.freeze({
  recursive: true,
  extensions: [],
  pollMs: 3000,
  settleMs: 750,
  debounceMs: 1500,
  maxFiles: 2000,
  maxDepth: 16,
  scanTimeoutMs: 5000,
  emitDeleted: false,
})

const fail = (code, message) => { const error = new Error(message); error.code = code; throw error }
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
const integer = (value, fallback, minimum, maximum, field) => {
  const candidate = value == null ? fallback : Number(value)
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) fail('FOLDER_CONFIG_INVALID', `${field} must be an integer from ${minimum} to ${maximum}`)
  return candidate
}
const bool = (value, fallback, field) => {
  if (value == null) return fallback
  if (typeof value !== 'boolean') fail('FOLDER_CONFIG_INVALID', `${field} must be a boolean`)
  return value
}
const realpath = (file, fsModule = fs) => (fsModule.realpathSync.native || fsModule.realpathSync)(file)
const canonicalRelativePath = (root, file) => {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('FOLDER_PATH_ESCAPE', 'folder entry escaped its approved root')
  return relative.split(path.sep).join('/')
}
const stable = value => JSON.stringify(value, Object.keys(value).sort())
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex')

function canonicalApprovedRoots(roots, fsModule) {
  if (!Array.isArray(roots) || roots.length === 0) fail('FOLDER_SCOPE_REQUIRED', 'at least one explicit approved folder root is required')
  return [...new Set(roots.map((root, index) => {
    if (typeof root !== 'string' || !root.trim() || !path.isAbsolute(root)) fail('FOLDER_SCOPE_INVALID', `approvedRoots[${index}] must be an absolute path`)
    const resolved = path.resolve(root)
    let stat
    try { stat = fsModule.lstatSync(resolved) } catch { fail('FOLDER_SCOPE_INVALID', `approvedRoots[${index}] does not exist`) }
    if (stat.isSymbolicLink()) fail('FOLDER_SYMLINK_REJECTED', `approvedRoots[${index}] cannot be a symbolic link`)
    if (!stat.isDirectory()) fail('FOLDER_SCOPE_INVALID', `approvedRoots[${index}] must be a directory`)
    const canonical = realpath(resolved, fsModule)
    try { fsModule.accessSync(canonical, fsModule.constants.R_OK) } catch { fail('FOLDER_NOT_READABLE', `approvedRoots[${index}] is not readable`) }
    return canonical
  }))].sort()
}

export function normalizeFolderConfig(input = {}, { approvedRoots, fsModule = fs } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('FOLDER_CONFIG_INVALID', 'folder config must be an object')
  if (typeof input.path !== 'string' || !input.path.trim()) fail('FOLDER_PATH_REQUIRED', 'watched folder path is required')
  if (!path.isAbsolute(input.path)) fail('FOLDER_PATH_INVALID', 'watched folder path must be absolute')

  const roots = canonicalApprovedRoots(approvedRoots, fsModule)
  const resolved = path.resolve(input.path)
  let directoryStat
  try { directoryStat = fsModule.lstatSync(resolved) } catch { fail('FOLDER_PATH_INVALID', 'watched folder does not exist') }
  if (directoryStat.isSymbolicLink()) fail('FOLDER_SYMLINK_REJECTED', 'watched folder cannot be a symbolic link')
  if (!directoryStat.isDirectory()) fail('FOLDER_PATH_INVALID', 'watched folder must be a directory')
  const directory = realpath(resolved, fsModule)
  const approvedRoot = roots.find(root => inside(root, directory))
  if (!approvedRoot) fail('FOLDER_PATH_ESCAPE', 'watched folder is outside its approved filesystem roots')
  try { fsModule.accessSync(directory, fsModule.constants.R_OK) } catch { fail('FOLDER_NOT_READABLE', 'watched folder is not readable') }

  if (input.extensions != null && !Array.isArray(input.extensions)) fail('FOLDER_CONFIG_INVALID', 'extensions must be an array')
  const extensions = [...new Set((input.extensions || []).map((value, index) => {
    if (typeof value !== 'string') fail('FOLDER_CONFIG_INVALID', `extensions[${index}] must be a string`)
    const extension = value.trim().replace(/^\.+/, '').toLowerCase()
    if (!extension || !/^[a-z0-9][a-z0-9+_-]{0,31}$/.test(extension)) fail('FOLDER_CONFIG_INVALID', `extensions[${index}] is invalid`)
    return extension
  }))].sort()

  const config = {
    path: directory,
    approvedRoot,
    approvedRoots: roots,
    recursive: bool(input.recursive, DEFAULTS.recursive, 'recursive'),
    extensions,
    pollMs: integer(input.pollMs, DEFAULTS.pollMs, 1000, 300000, 'pollMs'),
    settleMs: integer(input.settleMs, DEFAULTS.settleMs, 0, 300000, 'settleMs'),
    debounceMs: integer(input.debounceMs, DEFAULTS.debounceMs, 0, 3600000, 'debounceMs'),
    maxFiles: integer(input.maxFiles, DEFAULTS.maxFiles, 1, 100000, 'maxFiles'),
    maxDepth: integer(input.maxDepth, DEFAULTS.maxDepth, 0, 64, 'maxDepth'),
    scanTimeoutMs: integer(input.scanTimeoutMs, DEFAULTS.scanTimeoutMs, 10, 300000, 'scanTimeoutMs'),
    emitDeleted: bool(input.emitDeleted, DEFAULTS.emitDeleted, 'emitDeleted'),
  }
  return { ...config, rootHash: digest(config.path) }
}

function fingerprint(stat) {
  const value = {
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
    dev: Number.isSafeInteger(Number(stat.dev)) ? String(stat.dev) : null,
    ino: Number.isSafeInteger(Number(stat.ino)) ? String(stat.ino) : null,
  }
  return { ...value, hash: digest(stable(value)) }
}

function assertCanonicalEntry(config, file, fsModule) {
  const before = fsModule.lstatSync(file)
  if (before.isSymbolicLink()) fail('FOLDER_SYMLINK_REJECTED', `symbolic link rejected: ${canonicalRelativePath(config.path, file)}`)
  const canonical = realpath(file, fsModule)
  if (!inside(config.path, canonical) || !inside(config.approvedRoot, canonical)) fail('FOLDER_PATH_ESCAPE', 'folder entry escaped its approved filesystem root')
  const after = fsModule.lstatSync(file)
  if (after.isSymbolicLink() || String(before.dev) !== String(after.dev) || String(before.ino) !== String(after.ino)) fail('FOLDER_SCAN_RACE', 'folder entry changed during security validation')
  return after
}

export function scanFolderSnapshot(config, { fsModule = fs, clock = () => Date.now() } = {}) {
  if (!config?.path || !config?.approvedRoot || !config?.rootHash) fail('FOLDER_CONFIG_INVALID', 'normalized folder config is required')
  const startedAt = Number(clock())
  const timedOut = () => Number(clock()) - startedAt > config.scanTimeoutMs
  const extensionSet = new Set(config.extensions)
  const entries = {}
  const stack = [{ directory: config.path, depth: 0 }]

  while (stack.length) {
    if (timedOut()) fail('FOLDER_SCAN_TIMEOUT', `folder scan exceeded ${config.scanTimeoutMs}ms`)
    const current = stack.pop()
    const directoryStat = assertCanonicalEntry(config, current.directory, fsModule)
    if (!directoryStat.isDirectory()) fail('FOLDER_SCAN_RACE', 'folder directory changed during scan')
    try { fsModule.accessSync(current.directory, fsModule.constants.R_OK) } catch { fail('FOLDER_NOT_READABLE', `folder is not readable: ${canonicalRelativePath(config.path, current.directory)}`) }
    const children = fsModule.readdirSync(current.directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      if (timedOut()) fail('FOLDER_SCAN_TIMEOUT', `folder scan exceeded ${config.scanTimeoutMs}ms`)
      const full = path.join(current.directory, child.name)
      const stat = assertCanonicalEntry(config, full, fsModule)
      if (stat.isDirectory()) {
        if (!config.recursive) continue
        if (current.depth >= config.maxDepth) fail('FOLDER_MAX_DEPTH', `folder scan exceeded maximum depth ${config.maxDepth}`)
        stack.push({ directory: full, depth: current.depth + 1 })
        continue
      }
      if (!stat.isFile()) continue
      const extension = path.extname(child.name).slice(1).toLowerCase()
      if (extensionSet.size && !extensionSet.has(extension)) continue
      if (Object.keys(entries).length >= config.maxFiles) fail('FOLDER_MAX_FILES', `folder scan exceeded maximum file count ${config.maxFiles}`)
      const relativePath = canonicalRelativePath(config.path, full)
      entries[relativePath] = fingerprint(stat)
    }
  }

  return { version: FOLDER_SNAPSHOT_VERSION, rootHash: config.rootHash, scannedAt: Number(clock()), entries }
}

const fileIdentity = value => value?.dev != null && value?.ino != null ? `${value.dev}:${value.ino}` : null
const eventFingerprint = event => event.fingerprint?.hash || event.previousFingerprint?.hash || ''

export function diffFolderSnapshots(previous, current, { emitDeleted = false } = {}) {
  if (previous?.rootHash !== current?.rootHash) fail('FOLDER_SNAPSHOT_MISMATCH', 'folder snapshots have different roots')
  const before = previous?.entries || {}, after = current?.entries || {}
  const events = []
  const removed = new Map(), added = new Map()

  for (const relativePath of Object.keys(before).sort()) {
    if (!(relativePath in after)) removed.set(relativePath, before[relativePath])
  }
  for (const relativePath of Object.keys(after).sort()) {
    if (!(relativePath in before)) added.set(relativePath, after[relativePath])
    else if (before[relativePath].hash !== after[relativePath].hash) {
      const type = fileIdentity(before[relativePath]) && fileIdentity(before[relativePath]) !== fileIdentity(after[relativePath]) ? 'replaced' : 'modified'
      events.push({ type, relativePath, fingerprint: after[relativePath], previousFingerprint: before[relativePath] })
    }
  }

  const removedByIdentity = new Map()
  for (const [relativePath, value] of removed) {
    const identity = fileIdentity(value)
    if (identity) removedByIdentity.set(identity, [...(removedByIdentity.get(identity) || []), relativePath])
  }
  for (const [relativePath, value] of [...added]) {
    const matches = removedByIdentity.get(fileIdentity(value)) || []
    if (matches.length !== 1) continue
    const previousRelativePath = matches[0]
    events.push({ type: 'renamed', relativePath, previousRelativePath, fingerprint: value, previousFingerprint: removed.get(previousRelativePath) })
    added.delete(relativePath); removed.delete(previousRelativePath)
  }
  for (const [relativePath, value] of added) events.push({ type: 'created', relativePath, fingerprint: value })
  if (emitDeleted) for (const [relativePath, value] of removed) events.push({ type: 'deleted', relativePath, previousFingerprint: value })
  return events.sort((left, right) => `${left.relativePath}\0${left.type}`.localeCompare(`${right.relativePath}\0${right.type}`))
}

export function folderDeliveryIdentity(triggerId, rootHash, event) {
  if (!triggerId || !/^[a-z0-9_-]+$/i.test(String(triggerId))) fail('FOLDER_IDENTITY_INVALID', 'trigger id is invalid')
  if (!/^[a-f0-9]{64}$/.test(String(rootHash || ''))) fail('FOLDER_IDENTITY_INVALID', 'folder root identity is invalid')
  const semantic = {
    type: String(event?.type || ''),
    relativePath: String(event?.relativePath || ''),
    previousRelativePath: event?.previousRelativePath ? String(event.previousRelativePath) : null,
    fingerprint: eventFingerprint(event),
  }
  if (!semantic.relativePath || semantic.relativePath.startsWith('/') || semantic.relativePath.includes('../')) fail('FOLDER_IDENTITY_INVALID', 'folder event path must be relative')
  return digest(`${triggerId}\0${rootHash}\0${stable(semantic)}`)
}

export function publicFolderEvidence(event) {
  return {
    event: String(event?.type || 'unknown').slice(0, 24),
    relativePathHash: digest(String(event?.relativePath || '')),
    ...(event?.previousRelativePath ? { previousRelativePathHash: digest(String(event.previousRelativePath)) } : {}),
    fingerprintHash: eventFingerprint(event),
  }
}

const emptyCandidateState = () => ({ version: FOLDER_CANDIDATE_VERSION, candidates: {}, recent: {} })
const candidateKey = event => digest(String(event?.relativePath || ''))

const safeRelativePath = value => {
  const candidate = String(value || '')
  if (!candidate || candidate.length > 1024 || candidate.startsWith('/') || candidate.includes('\0') || candidate.split('/').includes('..')) fail('FOLDER_STATE_INVALID', 'folder operational state contains an unsafe relative path')
  return candidate
}

function normalizePersistedFingerprint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !/^[a-f0-9]{64}$/.test(String(value.hash || ''))) fail('FOLDER_STATE_INVALID', 'folder event fingerprint is invalid')
  const size = Number(value.size), mtimeMs = Number(value.mtimeMs), ctimeMs = Number(value.ctimeMs)
  if (![size, mtimeMs, ctimeMs].every(Number.isFinite) || size < 0) fail('FOLDER_STATE_INVALID', 'folder event fingerprint metadata is invalid')
  return { size, mtimeMs, ctimeMs, dev: value.dev == null ? null : String(value.dev), ino: value.ino == null ? null : String(value.ino), hash: String(value.hash) }
}

function normalizePersistedEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('FOLDER_STATE_INVALID', 'folder operational event is invalid')
  const type = String(event.type || '')
  if (!['created', 'modified', 'replaced', 'renamed', 'deleted'].includes(type)) fail('FOLDER_STATE_INVALID', 'folder operational event type is invalid')
  return {
    type,
    relativePath: safeRelativePath(event.relativePath),
    ...(event.previousRelativePath ? { previousRelativePath: safeRelativePath(event.previousRelativePath) } : {}),
    ...(event.fingerprint ? { fingerprint: normalizePersistedFingerprint(event.fingerprint) } : {}),
    ...(event.previousFingerprint ? { previousFingerprint: normalizePersistedFingerprint(event.previousFingerprint) } : {}),
  }
}

export function normalizeFolderOperationalState(input, { maxFiles = DEFAULTS.maxFiles } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== FOLDER_OPERATIONAL_VERSION) fail('FOLDER_STATE_INVALID', 'folder operational state is invalid')
  const snapshot = input.snapshot
  if (!snapshot || snapshot.version !== FOLDER_SNAPSHOT_VERSION || !/^[a-f0-9]{64}$/.test(String(snapshot.rootHash || '')) || !snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries)) fail('FOLDER_STATE_INVALID', 'folder snapshot state is invalid')
  const rootHash = String(input.rootHash || '')
  if (!/^[a-f0-9]{64}$/.test(rootHash) || rootHash !== String(snapshot.rootHash)) fail('FOLDER_STATE_INVALID', 'folder operational root identity is invalid')
  const entries = {}
  for (const [relativePath, value] of Object.entries(snapshot.entries)) {
    if (Object.keys(entries).length >= maxFiles) fail('FOLDER_MAX_FILES', `folder operational state exceeded maximum file count ${maxFiles}`)
    const safePath = safeRelativePath(relativePath)
    entries[safePath] = normalizePersistedFingerprint(value)
  }
  const sourceCandidates = input.candidates?.version === FOLDER_CANDIDATE_VERSION ? input.candidates : emptyCandidateState()
  const candidates = {}, recent = {}
  for (const [key, value] of Object.entries(sourceCandidates.candidates || {})) {
    if (!/^[a-f0-9]{64}$/.test(key) || !value || typeof value !== 'object') fail('FOLDER_STATE_INVALID', 'folder candidate state is invalid')
    if (!/^[a-f0-9]{64}$/.test(String(value.signature || ''))) fail('FOLDER_STATE_INVALID', 'folder candidate signature is invalid')
    candidates[key] = { ...value, key, event: normalizePersistedEvent(value.event), signature: String(value.signature), firstObservedAt: Number(value.firstObservedAt) || 0, stableSince: Number(value.stableSince) || 0, lastObservedAt: Number(value.lastObservedAt) || 0 }
  }
  for (const [key, value] of Object.entries(sourceCandidates.recent || {})) {
    if (!/^[a-f0-9]{64}$/.test(key) || !value || typeof value !== 'object') fail('FOLDER_STATE_INVALID', 'folder recent state is invalid')
    if (!/^[a-f0-9]{64}$/.test(String(value.signature || ''))) fail('FOLDER_STATE_INVALID', 'folder recent signature is invalid')
    recent[key] = { emittedAt: Number(value.emittedAt) || 0, signature: String(value.signature) }
  }
  if (Object.keys(candidates).length > maxFiles || Object.keys(recent).length > maxFiles * 2) fail('FOLDER_MAX_CANDIDATES', 'folder operational candidate state is too large')
  return {
    version: FOLDER_OPERATIONAL_VERSION,
    rootHash,
    snapshot: { version: FOLDER_SNAPSHOT_VERSION, rootHash: String(snapshot.rootHash), scannedAt: Number(snapshot.scannedAt) || 0, entries },
    candidates: { version: FOLDER_CANDIDATE_VERSION, candidates, recent },
    updatedAt: Number(input.updatedAt) || 0,
  }
}

export function advanceFolderCandidates(inputState, events, { now, settleMs = DEFAULTS.settleMs, debounceMs = DEFAULTS.debounceMs, maxCandidates = DEFAULTS.maxFiles } = {}) {
  const timestamp = Number(now)
  if (!Number.isFinite(timestamp) || timestamp < 0) fail('FOLDER_CANDIDATE_INVALID', 'candidate time must be a nonnegative number')
  if (!Array.isArray(events)) fail('FOLDER_CANDIDATE_INVALID', 'candidate events must be an array')
  settleMs = integer(settleMs, DEFAULTS.settleMs, 0, 300000, 'settleMs')
  debounceMs = integer(debounceMs, DEFAULTS.debounceMs, 0, 3600000, 'debounceMs')
  maxCandidates = integer(maxCandidates, DEFAULTS.maxFiles, 1, 100000, 'maxCandidates')
  const source = inputState?.version === FOLDER_CANDIDATE_VERSION ? inputState : emptyCandidateState()
  const state = { version: FOLDER_CANDIDATE_VERSION, candidates: structuredClone(source.candidates || {}), recent: structuredClone(source.recent || {}) }

  for (const event of events) {
    const key = candidateKey(event), signature = digest(stable({ type: event.type, relativePath: event.relativePath, previousRelativePath: event.previousRelativePath || null, fingerprint: eventFingerprint(event) }))
    const existing = state.candidates[key]
    state.candidates[key] = existing && existing.signature === signature
      ? { ...existing, lastObservedAt: timestamp }
      : { key, signature, event: structuredClone(event), firstObservedAt: existing?.firstObservedAt ?? timestamp, stableSince: timestamp, lastObservedAt: timestamp }
  }
  if (Object.keys(state.candidates).length > maxCandidates) fail('FOLDER_MAX_CANDIDATES', `folder candidates exceeded maximum ${maxCandidates}`)

  const ready = []
  for (const [key, candidate] of Object.entries(state.candidates)) {
    const lastEmission = Number(state.recent[key]?.emittedAt)
    const eligibleAt = Math.max(candidate.stableSince + settleMs, Number.isFinite(lastEmission) ? lastEmission + debounceMs : 0)
    if (timestamp < eligibleAt) continue
    ready.push(candidate.event)
    state.recent[key] = { emittedAt: timestamp, signature: candidate.signature }
    delete state.candidates[key]
  }
  for (const [key, value] of Object.entries(state.recent)) if (timestamp - Number(value.emittedAt) > Math.max(debounceMs * 2, 60000)) delete state.recent[key]
  ready.sort((left, right) => `${left.relativePath}\0${left.type}`.localeCompare(`${right.relativePath}\0${right.type}`))
  return { state, ready }
}
