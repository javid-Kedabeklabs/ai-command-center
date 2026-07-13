import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { redactSensitive } from '../collaboration/result-parser.js'
import { LOCAL_FACTORY_TASK_STATUSES, validateLocalFactoryTask } from './task-schema.js'

const STORE_VERSION = 1
const DIRECTORIES = Object.freeze({ QUEUED: 'queue', RUNNING: 'running', COMPLETED: 'completed', PARTIAL: 'failed', BLOCKED: 'blocked', FAILED: 'failed', CANCELLED: 'failed' })
const TRANSITIONS = Object.freeze({
  QUEUED: new Set(['RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED']),
  RUNNING: new Set(['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED']),
  BLOCKED: new Set(['QUEUED', 'FAILED', 'CANCELLED']),
  COMPLETED: new Set(), PARTIAL: new Set(), FAILED: new Set(), CANCELLED: new Set(),
})
const isInside = (root, target) => target === root || target.startsWith(`${root}${path.sep}`)

function safeId(value) {
  const id = String(value || '')
  if (!/^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/.test(id)) throw new Error('local factory taskId is invalid')
  return id
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  fs.renameSync(temporary, file)
}

function sanitizeTaskPacket(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return packet
  return {
    ...packet,
    title: redactSensitive(packet.title),
    objective: redactSensitive(packet.objective),
    background: redactSensitive(packet.background),
    acceptanceCriteria: Array.isArray(packet.acceptanceCriteria) ? packet.acceptanceCriteria.map(item => redactSensitive(item)) : packet.acceptanceCriteria,
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { throw Object.assign(new Error(`local factory store is corrupt: ${path.basename(file)}: ${error.message}`), { code: 'LOCAL_FACTORY_STORE_CORRUPT' }) }
}

export function createLocalFactoryTaskStore({ repositoryRoot, storeRoot = path.join(repositoryRoot, 'state', 'local-factory'), now = () => Date.now() } = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required')
  const repositoryInput = path.resolve(repositoryRoot), targetInput = path.resolve(storeRoot)
  if (targetInput === repositoryInput || !isInside(repositoryInput, targetInput)) throw new Error('local factory store must remain in a dedicated repository directory')
  const repository = fs.realpathSync(repositoryInput)
  const target = path.resolve(repository, path.relative(repositoryInput, targetInput))
  let existing = target
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  if (!isInside(repository, fs.realpathSync(existing))) throw new Error('local factory store resolves outside the repository')
  const indexFile = path.join(target, 'task-index.json')
  let index
  let initialized
  let mutation = Promise.resolve()
  const recordPath = (status, taskId) => path.join(target, DIRECTORIES[status], `${safeId(taskId)}.json`)
  const relativePath = (status, taskId) => `${DIRECTORIES[status]}/${safeId(taskId)}.json`

  async function initialize() {
    if (initialized) return initialized
    initialized = (async () => {
      for (const directory of new Set(Object.values(DIRECTORIES))) fs.mkdirSync(path.join(target, directory), { recursive: true, mode: 0o700 })
      if (!fs.existsSync(indexFile)) {
        index = { schemaVersion: STORE_VERSION, tasks: {}, updatedAt: now() }
        atomicWrite(indexFile, index)
        return { recovered: [] }
      }
      index = readJson(indexFile)
      if (index.schemaVersion !== STORE_VERSION || !index.tasks || typeof index.tasks !== 'object' || Array.isArray(index.tasks)) throw Object.assign(new Error('local factory store index has an unsupported shape'), { code: 'LOCAL_FACTORY_STORE_CORRUPT' })
      const recovered = []
      for (const [taskId, entry] of Object.entries(index.tasks)) {
        safeId(taskId)
        if (!entry || entry.taskId !== taskId || !LOCAL_FACTORY_TASK_STATUSES.includes(entry.status) || entry.relativePath !== relativePath(entry.status, taskId)) throw Object.assign(new Error(`local factory store index entry is invalid: ${taskId}`), { code: 'LOCAL_FACTORY_STORE_CORRUPT' })
        const file = path.join(target, entry.relativePath)
        if (!isInside(target, file) || !fs.existsSync(file)) throw Object.assign(new Error(`local factory task record is missing: ${taskId}`), { code: 'LOCAL_FACTORY_STORE_CORRUPT' })
        const record = readJson(file)
        validateLocalFactoryTask(record.task)
        if (record.taskId !== taskId || record.status !== entry.status || record.task.status !== entry.status) throw Object.assign(new Error(`local factory task record mismatch: ${taskId}`), { code: 'LOCAL_FACTORY_STORE_CORRUPT' })
        if (entry.status === 'RUNNING') {
          const timestamp = now()
          const next = { ...record, status: 'BLOCKED', task: { ...record.task, status: 'BLOCKED' }, updatedAt: timestamp, recovery: { reason: 'ORPHANED_AFTER_RESTART', recoveredAt: timestamp }, history: [...record.history, { from: 'RUNNING', to: 'BLOCKED', at: timestamp, reason: 'ORPHANED_AFTER_RESTART' }] }
          const nextFile = recordPath('BLOCKED', taskId)
          atomicWrite(nextFile, next); fs.rmSync(file, { force: true })
          index.tasks[taskId] = { ...entry, status: 'BLOCKED', relativePath: relativePath('BLOCKED', taskId), updatedAt: timestamp }
          recovered.push(taskId)
        }
      }
      if (recovered.length) { index.updatedAt = now(); atomicWrite(indexFile, index) }
      return { recovered }
    })()
    return initialized
  }

  const mutate = operation => {
    const result = mutation.then(async () => { await initialize(); return operation() })
    mutation = result.catch(() => {})
    return result
  }

  function readRecord(taskId) {
    const entry = index.tasks[safeId(taskId)]
    return entry ? readJson(path.join(target, entry.relativePath)) : null
  }

  async function createTask(packet) {
    return mutate(() => {
      const task = validateLocalFactoryTask(sanitizeTaskPacket(packet))
      if (task.status !== 'QUEUED') throw new Error('new local factory task must be QUEUED')
      if (index.tasks[task.taskId]) return { duplicate: true, record: readRecord(task.taskId) }
      const timestamp = now()
      const record = { schemaVersion: STORE_VERSION, taskId: task.taskId, status: 'QUEUED', task, createdAt: timestamp, updatedAt: timestamp, history: [{ from: null, to: 'QUEUED', at: timestamp, reason: 'CREATED' }] }
      atomicWrite(recordPath('QUEUED', task.taskId), record)
      index.tasks[task.taskId] = { taskId: task.taskId, status: 'QUEUED', relativePath: relativePath('QUEUED', task.taskId), createdAt: timestamp, updatedAt: timestamp }
      index.updatedAt = timestamp; atomicWrite(indexFile, index)
      return { duplicate: false, record: structuredClone(record) }
    })
  }

  async function transitionTask(taskId, nextStatus, { reason = 'STATE_TRANSITION', result = null } = {}) {
    return mutate(() => {
      if (!LOCAL_FACTORY_TASK_STATUSES.includes(nextStatus)) throw new Error('local factory target status is invalid')
      const current = readRecord(taskId)
      if (!current) throw new Error('local factory task was not found')
      if (!TRANSITIONS[current.status].has(nextStatus)) throw new Error(`invalid local factory transition: ${current.status} -> ${nextStatus}`)
      const timestamp = now()
      const next = { ...current, status: nextStatus, task: { ...current.task, status: nextStatus }, updatedAt: timestamp, result: result == null ? current.result || null : redactSensitive(result), history: [...current.history, { from: current.status, to: nextStatus, at: timestamp, reason: String(reason).slice(0, 200) }].slice(-100) }
      const oldFile = path.join(target, index.tasks[current.taskId].relativePath), nextFile = recordPath(nextStatus, current.taskId)
      atomicWrite(nextFile, next); if (oldFile !== nextFile) fs.rmSync(oldFile, { force: true })
      index.tasks[current.taskId] = { ...index.tasks[current.taskId], status: nextStatus, relativePath: relativePath(nextStatus, current.taskId), updatedAt: timestamp }
      index.updatedAt = timestamp; atomicWrite(indexFile, index)
      return structuredClone(next)
    })
  }

  async function getTask(taskId) { await initialize(); const value = readRecord(taskId); return value ? structuredClone(value) : null }
  async function listTasks() { await initialize(); return Object.values(index.tasks).sort((a, b) => b.createdAt - a.createdAt).map(value => structuredClone(value)) }
  return Object.freeze({ initialize, createTask, transitionTask, getTask, listTasks })
}
