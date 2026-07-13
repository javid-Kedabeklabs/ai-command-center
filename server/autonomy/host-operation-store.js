import fs from 'node:fs'
import path from 'node:path'

const OPERATIONS = new Set(['backup.create', 'backup.verify', 'service.status', 'service.reload', 'health.local', 'workflow.active_count', 'git.status'])
const RESOURCES = new Set(['command-center-repository', 'command-center-service', 'command-center-http'])
const ID = /^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

export function validateHostOperationRequest(input, now = Date.now()) {
  if (!plain(input)) throw new Error('host operation request must be an object')
  const allowed = new Set(['schemaVersion', 'requestId', 'taskId', 'operation', 'resource', 'params', 'idempotencyKey', 'createdAt', 'expiresAt'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`unsupported host operation field: ${key}`)
  if (input.schemaVersion !== 1) throw new Error('unsupported host operation schemaVersion')
  if (!ID.test(input.requestId) || !ID.test(input.taskId)) throw new Error('requestId and taskId must be safe stable identifiers')
  if (!OPERATIONS.has(input.operation)) throw new Error('host operation is not allowlisted')
  if (!RESOURCES.has(input.resource)) throw new Error('host resource is not allowlisted')
  if (!plain(input.params)) throw new Error('host operation params must be an object')
  if (typeof input.idempotencyKey !== 'string' || !/^[a-f0-9]{32,64}$/.test(input.idempotencyKey)) throw new Error('idempotencyKey must be a lowercase hex digest')
  if (!Number.isFinite(input.createdAt) || !Number.isFinite(input.expiresAt) || input.expiresAt <= now || input.expiresAt - input.createdAt > 86_400_000) throw new Error('host request expiry is invalid')
  return Object.freeze({ ...input, params: Object.freeze({ ...input.params }) })
}

export function createHostOperationStore({ root, clock = Date.now } = {}) {
  const base = path.join(fs.realpathSync(path.resolve(root)), 'state', 'host-operations')
  const directories = Object.fromEntries(['pending', 'running', 'completed', 'failed', 'superseded'].map(name => [name, path.join(base, name)]))
  Object.values(directories).forEach(directory => fs.mkdirSync(directory, { recursive: true, mode: 0o700 }))

  function find(requestId) {
    for (const [status, directory] of Object.entries(directories)) {
      const file = path.join(directory, `${requestId}.json`)
      if (fs.existsSync(file)) return { status: status.toUpperCase(), file, value: JSON.parse(fs.readFileSync(file, 'utf8')) }
    }
    return null
  }

  function enqueue(raw) {
    const request = validateHostOperationRequest(raw, clock())
    const existing = find(request.requestId)
    if (existing) {
      if (existing.value.idempotencyKey !== request.idempotencyKey) throw new Error('requestId collision with different idempotency key')
      return existing.value
    }
    const duplicate = list().find(item => item.idempotencyKey === request.idempotencyKey)
    if (duplicate) return duplicate
    atomicWrite(path.join(directories.pending, `${request.requestId}.json`), { ...request, status: 'PENDING', history: [{ at: clock(), status: 'PENDING' }] })
    return find(request.requestId).value
  }

  function list(status = null) {
    const selected = status ? { [status.toLowerCase()]: directories[status.toLowerCase()] } : directories
    return Object.entries(selected).flatMap(([name, directory]) => fs.readdirSync(directory).filter(file => file.endsWith('.json')).map(file => ({ ...JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')), queueStatus: name.toUpperCase() })))
  }

  function claim(requestId) {
    const current = find(requestId)
    if (!current || current.status !== 'PENDING') throw new Error('host request is not pending')
    const value = validateHostOperationRequest(Object.fromEntries(['schemaVersion', 'requestId', 'taskId', 'operation', 'resource', 'params', 'idempotencyKey', 'createdAt', 'expiresAt'].map(key => [key, current.value[key]])), clock())
    const next = { ...current.value, status: 'RUNNING', startedAt: clock(), history: [...(current.value.history || []), { at: clock(), status: 'RUNNING' }] }
    const destination = path.join(directories.running, `${requestId}.json`)
    atomicWrite(destination, next); fs.unlinkSync(current.file)
    return value
  }

  function finish(requestId, outcome) {
    const current = find(requestId)
    if (!current || current.status !== 'RUNNING') throw new Error('host request is not running')
    const success = outcome.ok === true, status = success ? 'COMPLETED' : 'FAILED'
    const value = { ...current.value, status, finishedAt: clock(), receipt: outcome.receipt, error: success ? null : String(outcome.error || 'host operation failed').slice(0, 2_000), history: [...(current.value.history || []), { at: clock(), status }] }
    const destination = path.join(directories[status.toLowerCase()], `${requestId}.json`)
    atomicWrite(destination, value); fs.unlinkSync(current.file)
    return value
  }

  function supersede(requestId, replacementRequestId, reason = 'replaced by a corrected request') {
    const current = find(requestId)
    if (!current || current.status !== 'FAILED') throw new Error('only a failed host request may be superseded')
    if (!ID.test(String(replacementRequestId || '')) || !find(replacementRequestId)) throw new Error('replacement host request must exist')
    const status = 'SUPERSEDED'
    const value = { ...current.value, status, supersededAt: clock(), replacementRequestId, supersedeReason: String(reason).slice(0, 500), history: [...(current.value.history || []), { at: clock(), status, replacementRequestId }] }
    const destination = path.join(directories.superseded, `${requestId}.json`)
    atomicWrite(destination, value); fs.unlinkSync(current.file)
    return value
  }

  return { enqueue, list, find, claim, finish, supersede, base }
}

export const HOST_OPERATIONS = Object.freeze([...OPERATIONS])
