import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SCHEMA_VERSION = 1
const HOST_BLOCKER = 'HOST_CAPABILITY'
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nowIso = clock => new Date(clock()).toISOString()
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex')

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function load(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (value.schemaVersion === SCHEMA_VERSION) return value
  } catch {}
  return { schemaVersion: SCHEMA_VERSION, noProgressCount: 0, lastProgressKey: null, blockers: {}, history: [] }
}

export function blockerFingerprint({ taskId, blockerClass, operation = '', resource = '', normalizedError = '', baseSha = '', environment = '' }) {
  return hash([taskId, blockerClass, operation, resource, normalizedError, baseSha, environment].map(value => String(value || '').trim().toLowerCase()).join('\0'))
}

export function createAutonomyControlPlane({ root, clock = Date.now, noProgressLimit = 3 } = {}) {
  const repositoryRoot = fs.realpathSync(path.resolve(root))
  const stateFile = path.join(repositoryRoot, 'state', 'autonomy-control.json')

  function inspect() { return structuredClone(load(stateFile)) }

  function evaluate({ iterationId, taskId, baseSha, progressMaterial, blocker = null }) {
    if (!iterationId || !taskId || !baseSha) throw new Error('iterationId, taskId, and baseSha are required')
    const state = load(stateFile)
    let newBlocker = false
    let fingerprint = null
    if (blocker) {
      fingerprint = blockerFingerprint({ taskId, baseSha, ...blocker })
      const previous = state.blockers[fingerprint]
      state.blockers[fingerprint] = {
        fingerprint,
        taskId,
        blockerClass: blocker.blockerClass,
        operation: blocker.operation || null,
        resource: blocker.resource || null,
        normalizedError: String(blocker.normalizedError || '').slice(0, 1_000),
        baseSha,
        environment: blocker.environment || null,
        status: 'OPEN',
        firstSeenAt: previous?.firstSeenAt || nowIso(clock),
        lastSeenAt: nowIso(clock),
        occurrences: Number(previous?.occurrences || 0) + 1,
      }
      newBlocker = !previous || previous.status !== 'OPEN'
    }
    const progressKey = hash(JSON.stringify({ baseSha, progressMaterial, openBlockers: Object.values(state.blockers).filter(item => item.status === 'OPEN').map(item => item.fingerprint).sort() }))
    const progressed = state.lastProgressKey !== progressKey || newBlocker
    state.noProgressCount = progressed ? 0 : Number(state.noProgressCount || 0) + 1
    state.lastProgressKey = progressKey
    state.lastIterationId = iterationId
    state.updatedAt = nowIso(clock)
    state.history.push({ iterationId, taskId, at: state.updatedAt, progressed, progressKey, blockerFingerprint: fingerprint })
    state.history = state.history.slice(-200)
    atomicWrite(stateFile, state)

    const open = fingerprint ? state.blockers[fingerprint] : null
    let action = 'CONTINUE'
    if (open?.blockerClass === HOST_BLOCKER) action = 'WAITING_HOST_OPERATION'
    if (state.noProgressCount >= noProgressLimit) action = 'HALT_NO_PROGRESS'
    return { action, progressed, noProgressCount: state.noProgressCount, blocker: open ? structuredClone(open) : null, progressKey }
  }

  function resolveBlocker(fingerprint, receiptId) {
    const state = load(stateFile), blocker = state.blockers[fingerprint]
    if (!blocker) throw new Error('unknown blocker fingerprint')
    blocker.status = 'RESOLVED'; blocker.resolvedAt = nowIso(clock); blocker.receiptId = String(receiptId || '')
    state.updatedAt = nowIso(clock); atomicWrite(stateFile, state)
    return structuredClone(blocker)
  }

  return { evaluate, inspect, resolveBlocker, stateFile }
}

export const AUTONOMY_HOST_BLOCKER = HOST_BLOCKER
