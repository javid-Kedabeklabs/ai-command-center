import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { redactSensitive } from './result-parser.js'

const SAFE_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGKILL'])
const bounded = (value, max = 500) => String(redactSensitive(String(value ?? ''))).replace(/\s+/g, ' ').trim().slice(0, max)
const safeTaskId = value => {
  const taskId = String(value || '').trim()
  if (!/^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/i.test(taskId)) throw new Error('taskId has an invalid format')
  return taskId
}

const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)

function canonicalDirectory(root, candidate, label) {
  const resolved = fs.realpathSync(path.resolve(candidate || root))
  if (!isInside(root, resolved)) {
    const error = new Error(`${label} must remain inside the repository root`)
    error.code = 'COLLABORATION_PATH_OUTSIDE_REPOSITORY'
    throw error
  }
  return resolved
}

export function createCollaborationProcessManager({ repositoryRoot, allowedExecutables = [], allowedEnvKeys = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL'], spawnImpl = spawn, killImpl = process.kill.bind(process), now = () => Date.now(), platform = process.platform } = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required')
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  const executableAllowlist = new Set(allowedExecutables.map(value => fs.realpathSync(path.resolve(value))))
  if (!executableAllowlist.size) throw new Error('at least one allowed executable is required')
  const environmentAllowlist = new Set(allowedEnvKeys)
  const owned = new Map()

  function publicRecord(record) {
    if (!record) return null
    const { child: _child, ...safe } = record
    return structuredClone(safe)
  }

  function spawnOwned({ taskId, command, args = [], cwd, env, detached = platform !== 'win32', stdio = ['ignore', 'pipe', 'pipe'] }) {
    const id = safeTaskId(taskId)
    if (owned.has(id) && owned.get(id).state === 'RUNNING') throw Object.assign(new Error('task already owns a running process'), { code: 'COLLABORATION_PROCESS_ALREADY_RUNNING' })
    if (typeof command !== 'string' || !path.isAbsolute(command) || command.includes('\0')) throw new Error('command must be an absolute executable path')
    const executable = fs.realpathSync(command)
    if (!executableAllowlist.has(executable)) {
      const error = new Error('executable is not allowlisted for collaboration workers')
      error.code = 'COLLABORATION_EXECUTABLE_DENIED'
      throw error
    }
    if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string' || argument.includes('\0'))) throw new Error('process arguments must be strings')
    const workingDirectory = canonicalDirectory(root, cwd, 'worker cwd')
    const requestedEnvironment = env && typeof env === 'object' && !Array.isArray(env) ? env : {}
    const safeEnvironment = {}
    for (const key of environmentAllowlist) {
      const value = requestedEnvironment[key] ?? process.env[key]
      if (typeof value === 'string') safeEnvironment[key] = value
    }
    const child = spawnImpl(executable, args, { cwd: workingDirectory, env: safeEnvironment, detached, stdio, shell: false })
    const startedAt = now()
    const record = {
      schemaVersion: 1,
      taskId: id,
      pid: child.pid || null,
      processGroup: detached && child.pid ? child.pid : null,
      executable: bounded(path.basename(executable), 120),
      state: 'RUNNING',
      startedAt,
      endedAt: null,
      exitCode: null,
      signal: null,
      cancellationRequestedAt: null,
      error: null,
      child,
    }
    owned.set(id, record)
    child.once('error', error => {
      record.error = { code: bounded(error.code || 'SPAWN_ERROR', 80), message: bounded(error.message) }
      if (!record.endedAt) { record.state = 'FAILED'; record.endedAt = now() }
    })
    child.once('close', (code, signal) => {
      record.exitCode = Number.isInteger(code) ? code : null
      record.signal = signal ? bounded(signal, 30) : null
      record.endedAt = now()
      record.state = record.cancellationRequestedAt ? 'CANCELLED' : code === 0 ? 'COMPLETED' : 'FAILED'
    })
    return { child, record: publicRecord(record) }
  }

  function cancelOwned(taskId, { pid = null, signal = 'SIGTERM' } = {}) {
    const id = safeTaskId(taskId)
    if (!SAFE_SIGNALS.has(signal)) throw new Error('unsupported process signal')
    const record = owned.get(id)
    if (!record || record.state !== 'RUNNING' || (pid != null && pid !== record.pid)) {
      const error = new Error('refusing to cancel an unregistered or non-running process')
      error.code = 'COLLABORATION_PROCESS_NOT_OWNED'
      throw error
    }
    record.cancellationRequestedAt = now()
    try {
      if (record.processGroup && platform !== 'win32') killImpl(-record.processGroup, signal)
      else record.child.kill(signal)
    } catch (error) {
      record.error = { code: bounded(error.code || 'CANCEL_ERROR', 80), message: bounded(error.message) }
      throw Object.assign(new Error(`owned process cancellation failed: ${record.error.message}`), { code: 'COLLABORATION_CANCEL_FAILED' })
    }
    return publicRecord(record)
  }

  function get(taskId) { return publicRecord(owned.get(safeTaskId(taskId))) }
  function list() { return [...owned.values()].map(publicRecord) }
  function forget(taskId) {
    const id = safeTaskId(taskId), record = owned.get(id)
    if (record?.state === 'RUNNING') throw new Error('cannot forget a running owned process')
    return owned.delete(id)
  }

  return { spawnOwned, cancelOwned, get, list, forget }
}
