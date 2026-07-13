import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeDelivery, normalizeEvidence, normalizeError, normalizeTriggerDefinition, redactedDeliveryKey, stableDeliveryId, TRIGGER_STORE_VERSION } from './schema.js'
import { normalizeFolderOperationalState } from './folder.js'

const emptyStore = retention => ({ schemaVersion: TRIGGER_STORE_VERSION, retention, secrets: {}, schedules: {}, folders: {}, deliveries: [], identities: {} })

function normalizeWebhookSecretRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('webhook secret record is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
  const allowed = new Set(['tokenHash', 'revision', 'operationKeyHash', 'rotatedAt'])
  if (Object.keys(value).some(key => !allowed.has(key))) throw Object.assign(new Error('webhook secret record contains unsupported fields'), { code: 'TRIGGER_STORE_CORRUPT' })
  const tokenHash = String(value.tokenHash || '')
  const revision = Math.max(1, Math.floor(Number(value.revision) || 1))
  const operationKeyHash = value.operationKeyHash == null ? null : String(value.operationKeyHash)
  if (!/^[a-f0-9]{64}$/.test(tokenHash) || (operationKeyHash && !/^[a-f0-9]{64}$/.test(operationKeyHash))) throw Object.assign(new Error('webhook secret record is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
  return { tokenHash, revision, ...(operationKeyHash ? { operationKeyHash } : {}), rotatedAt: Number(value.rotatedAt) || 0 }
}

function verifiedBackup(file, now = Date.now()) {
  if (!fs.existsSync(file)) return null
  const source = fs.readFileSync(file)
  const backup = `${file}.backup-${new Date(now).toISOString().replace(/[:.]/g, '-')}`
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
  const copied = fs.readFileSync(backup)
  if (source.length !== copied.length || !crypto.timingSafeEqual(crypto.createHash('sha256').update(source).digest(), crypto.createHash('sha256').update(copied).digest())) {
    throw new Error(`trigger migration backup verification failed for ${path.basename(file)}`)
  }
  return backup
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
  try { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir) } finally { fs.closeSync(dir) } } catch {}
}

function parseExisting(file) {
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { const wrapped = new Error(`trigger store is corrupt: ${error.message}`); wrapped.code = 'TRIGGER_STORE_CORRUPT'; throw wrapped }
}

function validateStore(raw, retention) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== TRIGGER_STORE_VERSION || !Array.isArray(raw.deliveries) || !raw.identities || typeof raw.identities !== 'object' || Array.isArray(raw.identities) || !raw.secrets || typeof raw.secrets !== 'object') {
    const error = new Error('trigger store has an unsupported or corrupt shape')
    error.code = 'TRIGGER_STORE_CORRUPT'
    throw error
  }
  const deliveries = raw.deliveries.map(normalizeDelivery)
  const byId = new Map(deliveries.map(item => [item.id, item]))
  const identities = {}
  for (const [identity, rawEntry] of Object.entries(raw.identities)) {
    const deliveryId = typeof rawEntry === 'string' ? rawEntry : rawEntry?.deliveryId
    const delivery = byId.get(String(deliveryId))
    if (!/^[a-f0-9]{64}$/.test(identity) || !deliveryId || (typeof rawEntry === 'string' && !delivery)) throw Object.assign(new Error('trigger store identity index is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
    identities[identity] = typeof rawEntry === 'string' ? { deliveryId, runId: delivery.runId, state: delivery.state, createdAt: delivery.createdAt } : { deliveryId: String(deliveryId), runId: rawEntry.runId || null, state: String(rawEntry.state || 'suppressed'), createdAt: Number(rawEntry.createdAt) || 0 }
  }
  const schedules = {}
  for (const [triggerId, schedule] of Object.entries(raw.schedules || {})) {
    if (!/^trigger-[a-z0-9_-]{6,80}$/i.test(triggerId) || !schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw Object.assign(new Error('trigger schedule cursor is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
    for (const key of ['lastEvaluatedAt', 'lastScheduledFor', 'nextFireAt', 'queuedAt']) if (schedule[key] != null && !Number.isFinite(Number(schedule[key]))) throw Object.assign(new Error('trigger schedule cursor is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
    schedules[triggerId] = { ...schedule }
  }
  const folders = {}
  for (const [triggerId, folderState] of Object.entries(raw.folders || {})) {
    if (!/^trigger-[a-z0-9_-]{6,80}$/i.test(triggerId)) throw Object.assign(new Error('trigger folder state is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
    try { folders[triggerId] = normalizeFolderOperationalState(folderState, { maxFiles: 100000 }) }
    catch (error) { throw Object.assign(new Error(`trigger folder state is corrupt: ${error.message}`), { code: 'TRIGGER_STORE_CORRUPT' }) }
  }
  const secrets = {}
  for (const [triggerId, secret] of Object.entries(raw.secrets)) {
    if (!/^trigger-[a-z0-9_-]{6,80}$/i.test(triggerId)) throw Object.assign(new Error('webhook secret owner is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
    secrets[triggerId] = normalizeWebhookSecretRecord(secret)
  }
  return { ...raw, schemaVersion: TRIGGER_STORE_VERSION, retention: { ...retention, ...(raw.retention || {}) }, deliveries, identities, secrets, schedules, folders }
}

function legacyDelivery(item, index) {
  const triggerId = String(item?.triggerId || '')
  const rawKey = String(item?.dedupeKey || item?.deliveryKey || item?.runId || item?.id || `legacy-${index}`)
  const deliveryKey = /^[a-f0-9]{64}$/.test(rawKey) ? rawKey : redactedDeliveryKey(rawKey)
  const state = item?.status === 'failed' ? 'failed' : item?.status === 'started' ? 'started' : 'suppressed'
  return normalizeDelivery({
    id: stableDeliveryId(triggerId, deliveryKey),
    triggerId,
    workflowId: String(item?.workflowId || ''),
    workflowVersion: item?.workflowVersion || null,
    deliveryKey,
    source: item?.source || 'legacy',
    scheduledAt: item?.at,
    state,
    runId: item?.runId || null,
    evidence: { ...(item?.error ? { error: normalizeError(item.error) } : {}), reason: 'migrated legacy history' },
    createdAt: item?.at,
    updatedAt: item?.at,
  })
}

export function createTriggerStore({ storeFile, legacyHistoryFile, retention = {}, migrateConfigurations = async () => {} }) {
  const policy = { history: Math.max(10, Number(retention.history) || 500), identities: Math.max(100, Number(retention.identities) || 10000) }
  let state = null, disabledError = null, queue = Promise.resolve(), initialized = null
  const mutate = operation => {
    const result = queue.then(async () => {
      await initialize()
      if (disabledError) throw disabledError
      const draft = structuredClone(state)
      const output = await operation(draft)
      atomicWrite(storeFile, draft)
      state = draft
      return output
    })
    queue = result.catch(() => {})
    return result
  }

  async function initialize() {
    if (initialized) return initialized
    initialized = (async () => {
      try {
        const raw = parseExisting(storeFile)
        if (raw && !Array.isArray(raw)) { state = validateStore(raw, policy); return state }
        const legacyTriggers = Array.isArray(raw) ? raw.map(item => normalizeTriggerDefinition(item)) : []
        const legacyHistoryRaw = parseExisting(legacyHistoryFile)
        if (legacyHistoryRaw != null && !Array.isArray(legacyHistoryRaw)) throw Object.assign(new Error('legacy trigger history is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
        const backups = []
        if (raw != null) backups.push(verifiedBackup(storeFile))
        if (legacyHistoryRaw != null) backups.push(verifiedBackup(legacyHistoryFile))
        await migrateConfigurations(legacyTriggers)
        const deliveries = (legacyHistoryRaw || []).map(legacyDelivery)
        const identities = Object.fromEntries(deliveries.map(item => [redactedDeliveryKey(`${item.triggerId}\0${item.deliveryKey}`), { deliveryId: item.id, runId: item.runId, state: item.state, createdAt: item.createdAt }]))
        const secrets = Object.fromEntries(legacyTriggers.filter(item => item.tokenHash).map(item => [item.id, normalizeWebhookSecretRecord({ tokenHash: item.tokenHash, revision: item.secretRevision || 1 })]))
        state = { ...emptyStore(policy), deliveries: deliveries.slice(-policy.history), identities, secrets, migration: { completedAt: Date.now(), backups: backups.filter(Boolean).map(file => path.basename(file)) } }
        atomicWrite(storeFile, state)
        return state
      } catch (error) {
        disabledError = Object.assign(new Error(`trigger service disabled: ${error.message}`), { code: error.code || 'TRIGGER_STORE_DISABLED' })
        throw disabledError
      }
    })()
    return initialized
  }

  const identityFor = (triggerId, deliveryKey) => redactedDeliveryKey(`${triggerId}\0${deliveryKey}`)

  async function reserve({ trigger, deliveryKey, source, scheduledAt = Date.now(), workflowVersion = null, manual = false }) {
    return mutate(draft => {
      const redactedKey = /^[a-f0-9]{64}$/.test(String(deliveryKey)) ? String(deliveryKey) : redactedDeliveryKey(deliveryKey)
      const identity = identityFor(trigger.id, redactedKey)
      const existingEntry = draft.identities[identity]
      const existingId = existingEntry?.deliveryId
      const existing = existingId && draft.deliveries.find(item => item.id === existingId)
      if (existing) return { delivery: existing, duplicate: true }
      if (existingEntry) return { delivery: { id: existingEntry.deliveryId, triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source, state: existingEntry.state, runId: existingEntry.runId, evidence: { duplicate: true } }, duplicate: true }
      const now = Date.now()
      const delivery = normalizeDelivery({ id: stableDeliveryId(trigger.id, redactedKey), triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source, scheduledAt, state: 'reserved', attempt: 1, evidence: { manual }, createdAt: now, updatedAt: now })
      draft.deliveries.push(delivery)
      draft.identities[identity] = { deliveryId: delivery.id, runId: null, state: delivery.state, createdAt: delivery.createdAt }
      prune(draft)
      return { delivery, duplicate: false }
    })
  }

  async function reserveWebhook({ trigger, suppliedTokenHash, deliveryKey, source = 'webhook', scheduledAt = Date.now(), workflowVersion = null }) {
    return mutate(draft => {
      const secret = draft.secrets[trigger.id]
      const supplied = Buffer.from(String(suppliedTokenHash || '')), expected = Buffer.from(String(secret?.tokenHash || ''))
      if (!secret || secret.revision !== trigger.secretRevision || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return { authenticated: false }
      const redactedKey = /^[a-f0-9]{64}$/.test(String(deliveryKey)) ? String(deliveryKey) : redactedDeliveryKey(deliveryKey)
      const identity = identityFor(trigger.id, redactedKey), existingEntry = draft.identities[identity]
      const existing = existingEntry?.deliveryId && draft.deliveries.find(item => item.id === existingEntry.deliveryId)
      if (existing || existingEntry) return { authenticated: true, delivery: existing || { id: existingEntry.deliveryId, triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source, state: existingEntry.state, runId: existingEntry.runId, evidence: { duplicate: true } }, duplicate: true }
      const now = Date.now()
      const delivery = normalizeDelivery({ id: stableDeliveryId(trigger.id, redactedKey), triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source, scheduledAt, state: 'reserved', attempt: 1, evidence: {}, createdAt: now, updatedAt: now })
      draft.deliveries.push(delivery); draft.identities[identity] = { deliveryId: delivery.id, runId: null, state: delivery.state, createdAt: delivery.createdAt }; prune(draft)
      return { authenticated: true, delivery, duplicate: false }
    })
  }

  async function applySchedulePlan({ trigger, scheduleState, reservations = [], workflowVersion = null }) {
    return mutate(draft => {
      draft.schedules ||= {}
      draft.schedules[trigger.id] = structuredClone(scheduleState)
      const results = []
      for (const item of reservations) {
        const redactedKey = /^[a-f0-9]{64}$/.test(String(item.deliveryKey)) ? String(item.deliveryKey) : redactedDeliveryKey(item.deliveryKey)
        const identity = identityFor(trigger.id, redactedKey), existingEntry = draft.identities[identity]
        const existing = existingEntry?.deliveryId && draft.deliveries.find(delivery => delivery.id === existingEntry.deliveryId)
        if (existing || existingEntry) { results.push({ delivery: existing || { id: existingEntry.deliveryId, triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source: item.source, state: existingEntry.state, runId: existingEntry.runId }, duplicate: true }); continue }
        const now = Date.now(), stateName = item.state === 'suppressed' ? 'suppressed' : 'reserved'
        const delivery = normalizeDelivery({ id: stableDeliveryId(trigger.id, redactedKey), triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source: item.source, scheduledAt: item.scheduledAt, state: stateName, attempt: 1, evidence: item.evidence, createdAt: now, updatedAt: now })
        draft.deliveries.push(delivery); draft.identities[identity] = { deliveryId: delivery.id, runId: null, state: delivery.state, createdAt: delivery.createdAt }
        results.push({ delivery, duplicate: false })
      }
      prune(draft)
      return results
    })
  }

  async function applyFolderPlan({ trigger, folderState, reservations = [], workflowVersion = null }) {
    return mutate(draft => {
      draft.folders ||= {}
      draft.folders[trigger.id] = normalizeFolderOperationalState(folderState, { maxFiles: Number(trigger.config?.maxFiles) || 2000 })
      const results = []
      for (const item of reservations) {
        const redactedKey = /^[a-f0-9]{64}$/.test(String(item.deliveryKey)) ? String(item.deliveryKey) : redactedDeliveryKey(item.deliveryKey)
        const identity = identityFor(trigger.id, redactedKey), existingEntry = draft.identities[identity]
        const existing = existingEntry?.deliveryId && draft.deliveries.find(delivery => delivery.id === existingEntry.deliveryId)
        if (existing || existingEntry) { results.push({ delivery: existing || { id: existingEntry.deliveryId, triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source: 'folder', state: existingEntry.state, runId: existingEntry.runId }, duplicate: true, input: item.input }); continue }
        const now = Date.now()
        const delivery = normalizeDelivery({ id: stableDeliveryId(trigger.id, redactedKey), triggerId: trigger.id, workflowId: trigger.workflowId, workflowVersion, deliveryKey: redactedKey, source: 'folder', scheduledAt: item.scheduledAt, state: 'reserved', attempt: 1, evidence: item.evidence, createdAt: now, updatedAt: now })
        draft.deliveries.push(delivery); draft.identities[identity] = { deliveryId: delivery.id, runId: null, state: delivery.state, createdAt: delivery.createdAt }
        results.push({ delivery, duplicate: false, input: item.input })
      }
      prune(draft)
      return results
    })
  }

  function prune(draft) {
    if (draft.deliveries.length <= policy.history) return
    const recent = draft.deliveries.slice(-policy.history)
    const pending = draft.deliveries.filter(item => ['reserved', 'starting', 'recovering'].includes(item.state))
    draft.deliveries = [...new Map([...pending, ...recent].map(item => [item.id, item])).values()].slice(-Math.max(policy.history, pending.length))
    const orderedIdentities = Object.entries(draft.identities).sort((left, right) => Number(right[1].createdAt || 0) - Number(left[1].createdAt || 0))
    for (const [key] of orderedIdentities.slice(policy.identities)) delete draft.identities[key]
  }

  async function transition(id, stateName, changes = {}) {
    return mutate(draft => {
      const index = draft.deliveries.findIndex(item => item.id === id)
      if (index < 0) throw new Error('delivery not found')
      draft.deliveries[index] = normalizeDelivery({ ...draft.deliveries[index], ...changes, state: stateName, attempt: changes.attempt ?? draft.deliveries[index].attempt, evidence: { ...draft.deliveries[index].evidence, ...normalizeEvidence(changes.evidence) }, updatedAt: Date.now() })
      const delivery = draft.deliveries[index], identity = identityFor(delivery.triggerId, delivery.deliveryKey)
      if (draft.identities[identity]) draft.identities[identity] = { ...draft.identities[identity], deliveryId: delivery.id, runId: delivery.runId, state: delivery.state }
      return draft.deliveries[index]
    })
  }

  async function noteDuplicate(id) {
    return mutate(draft => {
      const delivery = draft.deliveries.find(item => item.id === id)
      if (delivery) { delivery.evidence = normalizeEvidence({ ...delivery.evidence, duplicate: true }); delivery.updatedAt = Date.now() }
      for (const entry of Object.values(draft.identities)) if (entry.deliveryId === id) entry.duplicate = true
      return delivery || null
    })
  }

  async function list({ triggerId, workflowId, state: stateFilter, runId, cursor = 0, limit = 100 } = {}) {
    await initialize()
    if (disabledError) throw disabledError
    const filtered = state.deliveries.filter(item => (!triggerId || item.triggerId === triggerId) && (!workflowId || item.workflowId === workflowId) && (!stateFilter || item.state === stateFilter) && (!runId || item.runId === runId)).sort((a, b) => b.createdAt - a.createdAt)
    const offset = Math.max(0, Number(cursor) || 0), size = Math.max(1, Math.min(200, Number(limit) || 100))
    return { items: filtered.slice(offset, offset + size), nextCursor: offset + size < filtered.length ? String(offset + size) : null, total: filtered.length }
  }

  async function pending() { const result = await list({ limit: 200 }); return result.items.filter(item => ['reserved', 'starting', 'recovering'].includes(item.state)) }
  async function getSecret(triggerId) { await initialize(); if (disabledError) throw disabledError; return state.secrets[triggerId] ? structuredClone(state.secrets[triggerId]) : null }
  async function getSchedule(triggerId) { await initialize(); if (disabledError) throw disabledError; return state.schedules?.[triggerId] ? structuredClone(state.schedules[triggerId]) : null }
  async function clearSchedule(triggerId) { return mutate(draft => { draft.schedules ||= {}; delete draft.schedules[triggerId] }) }
  async function getFolderState(triggerId) { await initialize(); if (disabledError) throw disabledError; return state.folders?.[triggerId] ? structuredClone(state.folders[triggerId]) : null }
  async function clearFolderState(triggerId) { return mutate(draft => { draft.folders ||= {}; delete draft.folders[triggerId] }) }
  async function setSecret(triggerId, value) { return mutate(draft => { if (value) draft.secrets[triggerId] = normalizeWebhookSecretRecord(value); else delete draft.secrets[triggerId] }) }
  async function removeSecret(triggerId) { return setSecret(triggerId, null) }
  async function reconcileSecrets(validTriggerIds) { const allowed = new Set(validTriggerIds); return mutate(draft => { for (const id of Object.keys(draft.secrets)) if (!allowed.has(id)) delete draft.secrets[id] }) }
  const status = () => ({ enabled: !disabledError, error: disabledError ? normalizeError(disabledError) : null })

  return { initialize, reserve, reserveWebhook, applySchedulePlan, applyFolderPlan, transition, noteDuplicate, list, pending, getSchedule, clearSchedule, getFolderState, clearFolderState, getSecret, setSecret, removeSecret, reconcileSecrets, status, files: { storeFile, legacyHistoryFile }, retention: policy }
}

export { atomicWrite, normalizeWebhookSecretRecord, verifiedBackup }
