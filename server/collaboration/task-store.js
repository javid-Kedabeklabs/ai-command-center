import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { redactSensitive } from './result-parser.js'
import { TASK_STATUSES, validateTaskPacket } from './task-schema.js'
import { assertOwnershipAvailable } from './conflict-detector.js'

export const COLLABORATION_TASK_STORE_VERSION = 1

const STATUS_DIRECTORY = Object.freeze({
  QUEUED: 'queue',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PARTIAL: 'failed',
  FAILED: 'failed',
  CANCELLED: 'failed',
  BLOCKED: 'blocked',
})

const TRANSITIONS = Object.freeze({
  QUEUED: new Set(['RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED']),
  RUNNING: new Set(['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED']),
  BLOCKED: new Set(['QUEUED', 'FAILED', 'CANCELLED']),
  COMPLETED: new Set(),
  PARTIAL: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
})

const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)
const safeId = (value, label) => {
  const normalized = String(value || '').trim()
  if (!/^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/i.test(normalized)) throw new Error(`${label} has an invalid format`)
  return normalized
}

function assertConstrainedStoreRoot(repositoryRoot, storeRoot) {
  const repositoryInput = path.resolve(repositoryRoot)
  const targetInput = path.resolve(storeRoot)
  if (!isInside(repositoryInput, targetInput) || targetInput === repositoryInput) {
    const error = new Error('collaboration store root must be a dedicated path inside the repository root')
    error.code = 'COLLABORATION_PATH_OUTSIDE_REPOSITORY'
    throw error
  }
  const repository = fs.realpathSync(repositoryInput)
  const target = path.resolve(repository, path.relative(repositoryInput, targetInput))
  let existing = target
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const realExisting = fs.realpathSync(existing)
  if (!isInside(repository, realExisting)) {
    const error = new Error('collaboration store root resolves outside the repository root')
    error.code = 'COLLABORATION_PATH_OUTSIDE_REPOSITORY'
    throw error
  }
  return { repository, target }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
  try {
    const directory = fs.openSync(path.dirname(file), 'r')
    try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
  } catch {}
}

function boundedText(value, max = 500) {
  return String(redactSensitive(String(value ?? ''))).replace(/\s+/g, ' ').trim().slice(0, max)
}

function sanitizedEvidence(value) {
  if (value == null) return null
  let clean = redactSensitive(value)
  let serialized
  try { serialized = JSON.stringify(clean) } catch { clean = { note: 'unserializable evidence omitted' }; serialized = JSON.stringify(clean) }
  if (serialized.length > 16_000) clean = { note: 'evidence exceeded storage limit', preview: boundedText(serialized, 2_000) }
  return clean
}

function corrupt(message) {
  return Object.assign(new Error(`collaboration task store is corrupt: ${message}`), { code: 'COLLABORATION_STORE_CORRUPT' })
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { throw corrupt(`${path.basename(file)}: ${error.message}`) }
}

function validateIndex(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== COLLABORATION_TASK_STORE_VERSION || !raw.tasks || typeof raw.tasks !== 'object' || Array.isArray(raw.tasks)) throw corrupt('task index has an unsupported shape')
  for (const [taskId, item] of Object.entries(raw.tasks)) {
    safeId(taskId, 'task index id')
    if (!item || typeof item !== 'object' || item.taskId !== taskId || !TASK_STATUSES.includes(item.status) || typeof item.relativePath !== 'string') throw corrupt(`invalid index entry for ${taskId}`)
    const expected = `${STATUS_DIRECTORY[item.status]}/${taskId}.json`
    if (item.relativePath !== expected) throw corrupt(`unexpected task path for ${taskId}`)
  }
  return raw
}

function validateRecord(raw, expectedId) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== COLLABORATION_TASK_STORE_VERSION || raw.taskId !== expectedId || !TASK_STATUSES.includes(raw.status) || !raw.task) throw corrupt(`invalid task record for ${expectedId}`)
  const task = validateTaskPacket(raw.task)
  if (task.taskId !== expectedId || task.status !== raw.status) throw corrupt(`task record status mismatch for ${expectedId}`)
  return { ...raw, task }
}

export function createCollaborationTaskStore({ repositoryRoot, storeRoot = path.join(repositoryRoot, 'state', 'collaboration'), now = () => Date.now() }) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required')
  const constrained = assertConstrainedStoreRoot(repositoryRoot, storeRoot)
  const indexFile = path.join(constrained.target, 'task-index.json')
  let index = null
  let disabledError = null
  let initialized = null
  let queue = Promise.resolve()

  const recordPath = (status, taskId) => path.join(constrained.target, STATUS_DIRECTORY[status], `${safeId(taskId, 'taskId')}.json`)
  const relativeRecordPath = (status, taskId) => `${STATUS_DIRECTORY[status]}/${safeId(taskId, 'taskId')}.json`

  async function initialize() {
    if (initialized) return initialized
    initialized = (async () => {
      try {
        for (const directory of new Set(Object.values(STATUS_DIRECTORY))) fs.mkdirSync(path.join(constrained.target, directory), { recursive: true, mode: 0o700 })
        if (!fs.existsSync(indexFile)) {
          index = { schemaVersion: COLLABORATION_TASK_STORE_VERSION, tasks: {}, updatedAt: now() }
          atomicWrite(indexFile, index)
          return { recovered: [] }
        }
        index = validateIndex(readJson(indexFile))
        const indexedPaths = new Set(Object.values(index.tasks).map(item => item.relativePath))
        for (const directory of new Set(Object.values(STATUS_DIRECTORY))) {
          for (const name of fs.readdirSync(path.join(constrained.target, directory))) {
            if (!name.endsWith('.json')) continue
            const relative = `${directory}/${name}`
            if (!indexedPaths.has(relative)) throw corrupt(`unindexed task record found at ${relative}`)
          }
        }
        for (const [taskId, item] of Object.entries(index.tasks)) {
          const absolute = path.join(constrained.target, item.relativePath)
          if (!isInside(constrained.target, absolute) || !fs.existsSync(absolute)) throw corrupt(`indexed task file is missing for ${taskId}`)
          validateRecord(readJson(absolute), taskId)
        }
        const recovered = []
        for (const [taskId, item] of Object.entries({ ...index.tasks })) {
          if (item.status !== 'RUNNING') continue
          const previousFile = path.join(constrained.target, item.relativePath)
          const record = validateRecord(readJson(previousFile), taskId)
          const timestamp = now()
          const next = {
            ...record,
            status: 'BLOCKED',
            task: { ...record.task, status: 'BLOCKED' },
            updatedAt: timestamp,
            recovery: {
              status: 'FAILED_SAFELY',
              reason: 'ORPHANED_AFTER_RESTART',
              recoveredAt: timestamp,
              evidence: sanitizedEvidence({ previousPid: record.dispatch?.pid || null, previousProcessGroup: record.dispatch?.processGroup || null }),
            },
          }
          const nextFile = recordPath('BLOCKED', taskId)
          atomicWrite(nextFile, next)
          fs.rmSync(previousFile, { force: true })
          index.tasks[taskId] = { ...item, status: 'BLOCKED', relativePath: relativeRecordPath('BLOCKED', taskId), updatedAt: timestamp }
          recovered.push(taskId)
        }
        if (recovered.length) { index.updatedAt = now(); atomicWrite(indexFile, index) }
        return { recovered }
      } catch (error) {
        disabledError = error.code === 'COLLABORATION_STORE_CORRUPT' ? error : Object.assign(new Error(`collaboration task store disabled: ${error.message}`), { code: error.code || 'COLLABORATION_STORE_DISABLED' })
        throw disabledError
      }
    })()
    return initialized
  }

  const mutate = operation => {
    const result = queue.then(async () => {
      await initialize()
      if (disabledError) throw disabledError
      return operation()
    })
    queue = result.catch(() => {})
    return result
  }

  async function createTask(packet, evidence = null) {
    return mutate(() => {
      const task = validateTaskPacket(redactSensitive(packet))
      if (task.status !== 'QUEUED') throw new Error('new collaboration task must be QUEUED')
      if (index.tasks[task.taskId]) return { task: readTaskRecord(task.taskId), duplicate: true }
      const timestamp = now()
      const record = { schemaVersion: COLLABORATION_TASK_STORE_VERSION, taskId: task.taskId, status: 'QUEUED', task, createdAt: timestamp, updatedAt: timestamp, evidence: sanitizedEvidence(evidence), history: [{ from: null, to: 'QUEUED', at: timestamp, reason: 'CREATED' }] }
      const file = recordPath('QUEUED', task.taskId)
      atomicWrite(file, record)
      index.tasks[task.taskId] = { taskId: task.taskId, status: 'QUEUED', relativePath: relativeRecordPath('QUEUED', task.taskId), createdAt: timestamp, updatedAt: timestamp, dispatchId: null }
      index.updatedAt = timestamp
      atomicWrite(indexFile, index)
      return { task: structuredClone(record), duplicate: false }
    })
  }

  function readTaskRecord(taskId) {
    const id = safeId(taskId, 'taskId')
    const entry = index?.tasks[id]
    if (!entry) return null
    return validateRecord(readJson(path.join(constrained.target, entry.relativePath)), id)
  }

  async function getTask(taskId) {
    await initialize()
    if (disabledError) throw disabledError
    const record = readTaskRecord(taskId)
    return record ? structuredClone(record) : null
  }

  async function listTasks({ status } = {}) {
    await initialize()
    if (disabledError) throw disabledError
    if (status != null && !TASK_STATUSES.includes(status)) throw new Error('unknown task status')
    return Object.values(index.tasks).filter(item => !status || item.status === status).sort((a, b) => b.createdAt - a.createdAt).map(item => structuredClone(item))
  }

  async function transitionTask(taskId, nextStatus, { reason = 'STATE_TRANSITION', evidence = null, dispatch = null } = {}) {
    return mutate(() => {
      if (!TASK_STATUSES.includes(nextStatus)) throw new Error('unknown task status')
      const current = readTaskRecord(taskId)
      if (!current) throw new Error('collaboration task not found')
      if (!TRANSITIONS[current.status].has(nextStatus)) {
        const error = new Error(`invalid collaboration task transition: ${current.status} -> ${nextStatus}`)
        error.code = 'COLLABORATION_INVALID_TRANSITION'
        throw error
      }
      const timestamp = now()
      const next = {
        ...current,
        status: nextStatus,
        task: { ...current.task, status: nextStatus },
        updatedAt: timestamp,
        evidence: sanitizedEvidence(evidence) ?? current.evidence,
        ...(dispatch ? { dispatch: sanitizedEvidence(dispatch) } : {}),
        history: [...(current.history || []), { from: current.status, to: nextStatus, at: timestamp, reason: boundedText(reason, 160) }].slice(-100),
      }
      const oldFile = path.join(constrained.target, index.tasks[current.taskId].relativePath)
      const newFile = recordPath(nextStatus, current.taskId)
      atomicWrite(newFile, next)
      if (oldFile !== newFile) fs.rmSync(oldFile, { force: true })
      index.tasks[current.taskId] = { ...index.tasks[current.taskId], status: nextStatus, relativePath: relativeRecordPath(nextStatus, current.taskId), updatedAt: timestamp, dispatchId: next.dispatch?.dispatchId || index.tasks[current.taskId].dispatchId || null }
      index.updatedAt = timestamp
      atomicWrite(indexFile, index)
      return structuredClone(next)
    })
  }

  async function claimTask(taskId, { dispatchId, workerId = null, pid = null, processGroup = null } = {}) {
    return mutate(() => {
      const current = readTaskRecord(taskId)
      if (!current) throw new Error('collaboration task not found')
      if (current.status === 'RUNNING') return { task: structuredClone(current), duplicate: true }
      if (current.status !== 'QUEUED') throw Object.assign(new Error(`task cannot be dispatched from ${current.status}`), { code: 'COLLABORATION_DUPLICATE_DISPATCH' })
      const activeReservations = Object.values(index.tasks).filter(item => item.status === 'RUNNING' && item.taskId !== current.taskId).map(item => {
        const active = readTaskRecord(item.taskId).task
        return { taskId: active.taskId, patterns: active.filesAllowed, readOnly: active.permissionProfile === 'READ_ONLY_ADVISOR' }
      })
      if (current.task.permissionProfile !== 'READ_ONLY_ADVISOR') assertOwnershipAvailable({ taskId: current.taskId, patterns: current.task.filesAllowed, readOnly: false }, activeReservations)
      const id = safeId(dispatchId, 'dispatchId')
      const timestamp = now()
      const dispatch = { dispatchId: id, workerId: workerId ? boundedText(workerId, 100) : null, pid: Number.isInteger(pid) && pid > 0 ? pid : null, processGroup: Number.isInteger(processGroup) && processGroup > 0 ? processGroup : null, startedAt: timestamp }
      const next = { ...current, status: 'RUNNING', task: { ...current.task, status: 'RUNNING' }, updatedAt: timestamp, dispatch, history: [...(current.history || []), { from: 'QUEUED', to: 'RUNNING', at: timestamp, reason: 'DISPATCHED' }].slice(-100) }
      const oldFile = path.join(constrained.target, index.tasks[current.taskId].relativePath)
      const newFile = recordPath('RUNNING', current.taskId)
      atomicWrite(newFile, next)
      fs.rmSync(oldFile, { force: true })
      index.tasks[current.taskId] = { ...index.tasks[current.taskId], status: 'RUNNING', relativePath: relativeRecordPath('RUNNING', current.taskId), updatedAt: timestamp, dispatchId: id }
      index.updatedAt = timestamp
      atomicWrite(indexFile, index)
      return { task: structuredClone(next), duplicate: false }
    })
  }

  async function updateDispatch(taskId, dispatchId, processEvidence) {
    return mutate(() => {
      const current = readTaskRecord(taskId)
      if (!current || current.status !== 'RUNNING' || current.dispatch?.dispatchId !== safeId(dispatchId, 'dispatchId')) throw Object.assign(new Error('dispatch receipt does not match the active task'), { code: 'COLLABORATION_DISPATCH_MISMATCH' })
      const process = sanitizedEvidence(processEvidence)
      if (!Number.isInteger(process?.pid) || process.pid <= 0 || process.taskId !== current.taskId || process.state !== 'RUNNING') throw Object.assign(new Error('owned process evidence is invalid'), { code: 'COLLABORATION_PROCESS_RECEIPT_INVALID' })
      const timestamp = now()
      const dispatch = { ...current.dispatch, pid: process.pid, processGroup: Number.isInteger(process.processGroup) && process.processGroup > 0 ? process.processGroup : null, executable: boundedText(process.executable, 120), processStartedAt: process.startedAt, receiptRecordedAt: timestamp }
      const next = { ...current, dispatch, updatedAt: timestamp }
      atomicWrite(recordPath('RUNNING', current.taskId), next)
      index.tasks[current.taskId] = { ...index.tasks[current.taskId], updatedAt: timestamp, dispatchId: dispatch.dispatchId }
      index.updatedAt = timestamp; atomicWrite(indexFile, index)
      return structuredClone(next)
    })
  }

  const status = () => ({ enabled: !disabledError, error: disabledError ? { code: disabledError.code, message: boundedText(disabledError.message) } : null })
  return { initialize, createTask, getTask, listTasks, transitionTask, claimTask, updateDispatch, status, files: { root: constrained.target, index: indexFile } }
}

export { atomicWrite, assertConstrainedStoreRoot, sanitizedEvidence }
