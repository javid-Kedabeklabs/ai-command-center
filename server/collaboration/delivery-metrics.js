import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'

export const DELIVERY_METRICS_SCHEMA_VERSION = 1
const OUTCOMES = new Set(['accepted', 'rejected', 'quarantined', 'cancelled'])
const DEFECT_SEVERITIES = new Set(['S1', 'S2', 'S3', 'S4'])
const QWEN_VERDICTS = new Set(['PASS', 'PASS_WITH_NOTES', 'FAIL', 'NOT_RUN'])

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safeId = (value, label) => {
  const text = String(value || '').trim()
  if (!/^[a-z0-9](?:[a-z0-9-]{1,126}[a-z0-9])?$/.test(text)) throw new Error(`${label} is invalid`)
  return text
}
const integer = (value, label, max = 31_536_000) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${label} must be an integer from 0 to ${max}`)
  return value
}
const median = values => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function validateQwenReview(value) {
  if (value == null) return { verdict: 'NOT_RUN', reviewSeconds: 0, materialFindings: 0, acceptedFindings: 0, falseBlockingFindings: 0 }
  if (!plainObject(value) || !QWEN_VERDICTS.has(value.verdict)) throw new Error('qwenReview is invalid')
  const materialFindings = integer(value.materialFindings, 'qwenReview.materialFindings', 10_000)
  const acceptedFindings = integer(value.acceptedFindings, 'qwenReview.acceptedFindings', 10_000)
  const falseBlockingFindings = integer(value.falseBlockingFindings, 'qwenReview.falseBlockingFindings', 10_000)
  if (acceptedFindings > materialFindings) throw new Error('qwenReview.acceptedFindings cannot exceed materialFindings')
  return { verdict: value.verdict, reviewSeconds: integer(value.reviewSeconds, 'qwenReview.reviewSeconds'), materialFindings, acceptedFindings, falseBlockingFindings }
}

function validateOutcome(input) {
  if (!plainObject(input)) throw new Error('delivery outcome must be an object')
  const allowed = new Set(['schemaVersion', 'commandId', 'taskId', 'outcome', 'firstPassAccepted', 'reviewActiveSeconds', 'reworkActiveSeconds', 'reworkCycles', 'automatedGateFailures', 'boundaryViolations', 'codexBaselineSeconds', 'qwenReview'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`delivery outcome contains unsupported field: ${key}`)
  if (input.schemaVersion !== 1) throw new Error('delivery outcome schemaVersion must be 1')
  if (!OUTCOMES.has(input.outcome)) throw new Error('delivery outcome is invalid')
  if (typeof input.firstPassAccepted !== 'boolean') throw new Error('firstPassAccepted must be boolean')
  if (input.outcome !== 'accepted' && input.firstPassAccepted) throw new Error('only an accepted outcome can be first-pass accepted')
  return {
    schemaVersion: 1, commandId: safeId(input.commandId, 'commandId'), taskId: safeId(input.taskId, 'taskId'), outcome: input.outcome,
    firstPassAccepted: input.firstPassAccepted, reviewActiveSeconds: integer(input.reviewActiveSeconds, 'reviewActiveSeconds'),
    reworkActiveSeconds: integer(input.reworkActiveSeconds, 'reworkActiveSeconds'), reworkCycles: integer(input.reworkCycles, 'reworkCycles', 100),
    automatedGateFailures: integer(input.automatedGateFailures, 'automatedGateFailures', 10_000), boundaryViolations: integer(input.boundaryViolations, 'boundaryViolations', 100),
    codexBaselineSeconds: input.codexBaselineSeconds == null ? null : integer(input.codexBaselineSeconds, 'codexBaselineSeconds'),
    qwenReview: validateQwenReview(input.qwenReview),
  }
}

function initialState(timestamp) {
  return { schemaVersion: 1, revision: 0, updatedAt: timestamp, observations: {}, commandReceipts: {}, defects: [] }
}

function validateState(value) {
  if (!plainObject(value) || value.schemaVersion !== 1 || !plainObject(value.observations) || !plainObject(value.commandReceipts) || !Array.isArray(value.defects)) {
    throw Object.assign(new Error('collaboration delivery metrics are corrupt'), { code: 'COLLABORATION_METRICS_CORRUPT' })
  }
  if (!Number.isInteger(value.revision) || value.revision < 0 || !Number.isFinite(value.updatedAt)) throw Object.assign(new Error('collaboration delivery metrics revision is corrupt'), { code: 'COLLABORATION_METRICS_CORRUPT' })
  for (const [taskId, item] of Object.entries(value.observations)) {
    if (!plainObject(item) || item.taskId !== taskId || !OUTCOMES.has(item.outcome) || !Number.isFinite(item.acceptedAt) || !plainObject(item.qwenReview)) throw Object.assign(new Error('collaboration delivery observation is corrupt'), { code: 'COLLABORATION_METRICS_CORRUPT' })
  }
  for (const item of value.defects) if (!plainObject(item) || !value.observations[item.taskId] || !DEFECT_SEVERITIES.has(item.severity)) throw Object.assign(new Error('collaboration escaped defect evidence is corrupt'), { code: 'COLLABORATION_METRICS_CORRUPT' })
  return value
}

function publicObservation(value) {
  return {
    observationId: value.observationId, taskId: value.taskId, taskType: value.taskType, worker: value.worker, outcome: value.outcome,
    firstPassAccepted: value.firstPassAccepted, readyAt: value.readyAt, startedAt: value.startedAt, handedOffAt: value.handedOffAt,
    acceptedAt: value.acceptedAt, calendarLeadSeconds: value.calendarLeadSeconds, reviewActiveSeconds: value.reviewActiveSeconds,
    reworkActiveSeconds: value.reworkActiveSeconds, reworkCycles: value.reworkCycles, automatedGateFailures: value.automatedGateFailures,
    boundaryViolations: value.boundaryViolations, codexBaselineSeconds: value.codexBaselineSeconds, qwenReview: value.qwenReview,
  }
}

function summarizeObservations(observations, defects) {
  const groups = new Map()
  for (const item of observations) {
    const key = `${item.taskType}:${item.worker}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  const byTaskClass = [...groups.entries()].map(([key, rows]) => {
    const [taskType, worker] = key.split(':'), accepted = rows.filter(item => item.outcome === 'accepted')
    const relevantDefects = defects.filter(item => rows.some(row => row.taskId === item.taskId)), criticalDefects = relevantDefects.filter(item => ['S1', 'S2'].includes(item.severity)).length
    const baselineRows = accepted.filter(item => item.codexBaselineSeconds != null), medianLead = median(accepted.map(item => item.calendarLeadSeconds)), medianBaseline = median(baselineRows.map(item => item.codexBaselineSeconds))
    const firstPassRate = accepted.length ? accepted.filter(item => item.firstPassAccepted).length / accepted.length : null
    const eligible = accepted.length >= 12 && baselineRows.length >= 12 && firstPassRate >= 0.8 && rows.every(item => item.boundaryViolations === 0) && criticalDefects === 0 && medianLead <= medianBaseline * 0.85
    return {
      taskType, worker, observations: rows.length, accepted: accepted.length, firstPassRate,
      medianCalendarLeadSeconds: medianLead, medianCodexBaselineSeconds: medianBaseline,
      medianReviewSeconds: median(accepted.map(item => item.reviewActiveSeconds)), medianReworkSeconds: median(accepted.map(item => item.reworkActiveSeconds)),
      boundaryViolations: rows.reduce((sum, item) => sum + item.boundaryViolations, 0), criticalDefects,
      recommendation: eligible ? 'ELIGIBLE_FOR_FABLE_DEFAULT_REVIEW' : 'INSUFFICIENT_OR_NONQUALIFYING_EVIDENCE',
      automaticAuthority: false,
    }
  }).sort((a, b) => a.taskType.localeCompare(b.taskType) || a.worker.localeCompare(b.worker))
  const qwenRows = observations.filter(item => item.qwenReview.verdict !== 'NOT_RUN'), qwenFindings = qwenRows.reduce((sum, item) => sum + item.qwenReview.materialFindings, 0), acceptedFindings = qwenRows.reduce((sum, item) => sum + item.qwenReview.acceptedFindings, 0)
  return {
    schemaVersion: 1, mode: 'SHADOW_ONLY', observations: observations.length, defects: defects.length, byTaskClass,
    qwen: {
      observations: qwenRows.length, acceptedFindingRate: qwenFindings ? acceptedFindings / qwenFindings : null,
      falseBlockingFindings: qwenRows.reduce((sum, item) => sum + item.qwenReview.falseBlockingFindings, 0),
      medianReviewSeconds: median(qwenRows.map(item => item.qwenReview.reviewSeconds)),
      recommendation: qwenRows.length >= 20 && qwenFindings > 0 && acceptedFindings / qwenFindings >= 0.25 && qwenRows.every(item => item.qwenReview.falseBlockingFindings === 0) ? 'ELIGIBLE_FOR_QWEN_PREFLIGHT_REVIEW' : 'INSUFFICIENT_OR_NONQUALIFYING_EVIDENCE',
      automaticAuthority: false,
    },
  }
}

export function createDeliveryMetricsStore({ repositoryRoot, storeFile = path.join(repositoryRoot, 'state', 'collaboration', 'delivery-metrics.json'), now = () => Date.now() } = {}) {
  const rootInput = path.resolve(repositoryRoot), storeInput = path.resolve(storeFile)
  if (!inside(rootInput, storeInput)) throw new Error('delivery metrics store must be a regular path inside the repository')
  const root = fs.realpathSync(rootInput), target = path.resolve(root, path.relative(rootInput, storeInput))
  if (!inside(root, target) || fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('delivery metrics store must be a regular path inside the repository')
  let existingParent = path.dirname(target)
  while (!fs.existsSync(existingParent)) existingParent = path.dirname(existingParent)
  if (!inside(root, fs.realpathSync(existingParent))) throw new Error('delivery metrics store parent resolves outside the repository')
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  let disabledError = null, state
  try { state = fs.existsSync(target) ? validateState(JSON.parse(fs.readFileSync(target, 'utf8'))) : initialState(now()) }
  catch (cause) { disabledError = Object.assign(new Error('collaboration delivery metrics are disabled because the persisted store is corrupt'), { code: 'COLLABORATION_METRICS_CORRUPT', cause }) }
  let queue = Promise.resolve()
  const persist = () => atomicWriteJsonSync(target, state)
  const mutate = operation => {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }

  async function recordOutcome(input, { taskRecord, lease = null } = {}) {
    return mutate(() => {
      if (disabledError) throw disabledError
      const value = validateOutcome(input), requestHash = hash(value), existingCommand = state.commandReceipts[value.commandId]
      if (existingCommand) {
        if (existingCommand.requestHash !== requestHash) throw Object.assign(new Error('delivery metric command conflicts with an existing receipt'), { code: 'COLLABORATION_METRICS_COMMAND_CONFLICT' })
        return { observation: publicObservation(state.observations[existingCommand.taskId]), duplicate: true, receipt: existingCommand }
      }
      if (!taskRecord || taskRecord.taskId !== value.taskId || !['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(taskRecord.status)) throw new Error('delivery metrics require the exact terminal task record')
      if (state.observations[value.taskId]) throw Object.assign(new Error('task already has a delivery observation'), { code: 'COLLABORATION_METRICS_TASK_RECORDED' })
      const readOnly = taskRecord.task.permissionProfile === 'READ_ONLY_ADVISOR'
      if (value.outcome === 'accepted' && !readOnly && lease?.state !== 'INTEGRATED') throw Object.assign(new Error('accepted modifying work requires an integrated lease receipt'), { code: 'COLLABORATION_METRICS_INTEGRATION_REQUIRED' })
      if (value.outcome === 'rejected' && !readOnly && lease?.state !== 'REJECTED') throw Object.assign(new Error('rejected modifying work requires a rejected lease receipt'), { code: 'COLLABORATION_METRICS_REJECTION_REQUIRED' })
      const readyAt = taskRecord.createdAt, startedAt = taskRecord.dispatch?.startedAt || null
      const terminalReceipt = taskRecord.evidence?.dispatchReceipt || {}, handedOffAt = terminalReceipt.completedAt || terminalReceipt.failedAt || taskRecord.updatedAt
      const acceptedAt = now(), observationId = `observation-${crypto.randomBytes(10).toString('hex')}`
      const observation = {
        ...value, observationId, taskType: taskRecord.task.taskType, worker: taskRecord.task.assignedWorker,
        readyAt, startedAt, handedOffAt, acceptedAt, calendarLeadSeconds: Math.max(0, Math.round((acceptedAt - readyAt) / 1000)),
      }
      const receipt = { commandId: value.commandId, taskId: value.taskId, requestHash, observationId, committedAt: acceptedAt }
      state = { ...state, revision: Number(state.revision || 0) + 1, updatedAt: acceptedAt, observations: { ...state.observations, [value.taskId]: observation }, commandReceipts: { ...state.commandReceipts, [value.commandId]: receipt } }
      persist()
      return { observation: publicObservation(observation), duplicate: false, receipt }
    })
  }

  async function recordDefect(input) {
    return mutate(() => {
      if (disabledError) throw disabledError
      if (!plainObject(input) || input.schemaVersion !== 1 || !DEFECT_SEVERITIES.has(input.severity) || typeof input.attributed !== 'boolean') throw new Error('escaped defect record is invalid')
      for (const key of Object.keys(input)) if (!['schemaVersion', 'commandId', 'taskId', 'severity', 'attributed'].includes(key)) throw new Error(`escaped defect record contains unsupported field: ${key}`)
      const commandId = safeId(input.commandId, 'commandId'), taskId = safeId(input.taskId, 'taskId'), request = { schemaVersion: 1, commandId, taskId, severity: input.severity, attributed: input.attributed === true }, requestHash = hash(request)
      const existing = state.commandReceipts[commandId]
      if (existing) {
        if (existing.requestHash !== requestHash) throw Object.assign(new Error('delivery metric command conflicts with an existing receipt'), { code: 'COLLABORATION_METRICS_COMMAND_CONFLICT' })
        return { defect: state.defects.find(item => item.defectId === existing.defectId), duplicate: true, receipt: existing }
      }
      if (!state.observations[taskId]) throw new Error('escaped defect requires an existing delivery observation')
      const committedAt = now(), defect = { defectId: `defect-${crypto.randomBytes(10).toString('hex')}`, taskId, severity: input.severity, attributed: input.attributed === true, detectedAt: committedAt }
      const receipt = { commandId, taskId, requestHash, defectId: defect.defectId, committedAt }
      state = { ...state, revision: Number(state.revision || 0) + 1, updatedAt: committedAt, defects: [...state.defects, defect], commandReceipts: { ...state.commandReceipts, [commandId]: receipt } }
      persist()
      return { defect, duplicate: false, receipt }
    })
  }

  async function summary() {
    await queue
    if (disabledError) return { schemaVersion: 1, mode: 'DISABLED_CORRUPT', observations: 0, defects: 0, byTaskClass: [], qwen: { observations: 0, acceptedFindingRate: null, falseBlockingFindings: 0, medianReviewSeconds: null, recommendation: 'INSUFFICIENT_OR_NONQUALIFYING_EVIDENCE', automaticAuthority: false }, error: { code: disabledError.code } }
    return summarizeObservations(Object.values(state.observations).map(publicObservation), state.defects)
  }
  async function list() { await queue; return disabledError ? [] : Object.values(state.observations).map(publicObservation).sort((a, b) => b.acceptedAt - a.acceptedAt) }
  return { recordOutcome, recordDefect, summary, list, status: () => ({ enabled: !disabledError, error: disabledError ? { code: disabledError.code } : null }), files: { store: target } }
}

export { summarizeObservations, validateOutcome }
