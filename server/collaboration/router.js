import express from 'express'
import { requireMutationIntent } from '../security/local-request-guard.js'
import { COLLABORATION_TASK_SCHEMA_VERSION } from './task-schema.js'
import { readOpenQuestionLedger } from './open-question-ledger.js'

const publicError = error => ({ error: String(error?.message || error).replace(/\s+/g, ' ').trim().slice(0, 500), code: error?.code || 'COLLABORATION_ERROR' })
const publicLease = lease => ({
  taskId: lease.taskId, state: lease.state, reason: lease.reason || null,
  branch: lease.branch, baseSha: lease.baseSha, createdAt: lease.createdAt,
  updatedAt: lease.updatedAt, endedAt: lease.endedAt || null,
})
const REQUEUEABLE_STATUSES = new Set(['QUEUED', 'BLOCKED'])

export function classifyTaskPacketCompatibility(records, currentSchemaVersion = COLLABORATION_TASK_SCHEMA_VERSION) {
  const packets = records.filter(Boolean)
  const legacy = packets.filter(item => item.task?.schemaVersion !== currentSchemaVersion)
  return Object.freeze({
    contractComplete: packets.length - legacy.length,
    legacyRecords: legacy.length,
    upgradeRequired: legacy.filter(item => REQUEUEABLE_STATUSES.has(item.status)).length,
    historicalLegacy: legacy.filter(item => !REQUEUEABLE_STATUSES.has(item.status)).length,
  })
}

export function createCollaborationRouter({ taskStore, worktreeManager, metricsStore = null, questionLedgerFile = null, liveDispatch = { enabled: false, reason: 'OWNER_OPT_IN_REQUIRED', dispatcher: null }, appendAudit = () => {} } = {}) {
  if (!taskStore || !worktreeManager) throw new Error('collaboration task store and worktree manager are required')
  const router = express.Router()

  router.get('/status', async (_req, res) => {
    try {
      await taskStore.initialize()
      const tasks = await taskStore.listTasks()
      const packets = await Promise.all(tasks.map(item => taskStore.getTask(item.taskId)))
      const packetCounts = classifyTaskPacketCompatibility(packets)
      const counts = Object.fromEntries(['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED'].map(status => [status, tasks.filter(item => item.status === status).length]))
      const leases = worktreeManager.list().map(publicLease)
      res.set('Cache-Control', 'no-store').json({
        enabled: taskStore.status().enabled,
        worktreeEnabled: worktreeManager.available !== false,
        worktreeUnavailableReason: worktreeManager.available === false ? worktreeManager.unavailableReason : null,
        dispatchEnabled: liveDispatch.enabled === true,
        dispatchUnavailableReason: liveDispatch.enabled ? null : liveDispatch.reason,
        dispatchContract: { schemaVersion: 1, verified: true, prerequisites: ['explicit-owner-command', 'reviewed-clean-base', 'available-fable-capacity', 'verified-worktree-lease', 'owned-process-receipt', 'codex-integration-review'] },
        taskPacketContract: { currentSchemaVersion: COLLABORATION_TASK_SCHEMA_VERSION, legacyReadOnlyCompatibility: true, newLegacyPacketsAccepted: false, ...packetCounts },
        metrics: metricsStore ? await metricsStore.summary() : { schemaVersion: 1, mode: 'UNAVAILABLE', observations: 0, defects: 0, byTaskClass: [], qwen: { observations: 0, acceptedFindingRate: null, falseBlockingFindings: 0, medianReviewSeconds: null, recommendation: 'INSUFFICIENT_OR_NONQUALIFYING_EVIDENCE', automaticAuthority: false } },
        policy: { centralRuntimeWriter: 'codex', modifyingWorker: 'claude-fable', reviewer: 'qwen-read-only', automaticIntegration: false },
        counts, activeLeases: leases.filter(item => item.state === 'ACTIVE').length,
        blockedLeases: leases.filter(item => item.state === 'BLOCKED').length,
        leaseRecovery: worktreeManager.recovery,
      })
    } catch (error) { res.status(503).set('Cache-Control', 'no-store').json(publicError(error)) }
  })

  router.get('/tasks', async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await taskStore.listTasks(req.query.status ? { status: String(req.query.status) } : {})) }
    catch (error) { res.status(400).json(publicError(error)) }
  })

  router.get('/tasks/:taskId', async (req, res) => {
    try {
      const task = await taskStore.getTask(req.params.taskId)
      if (!task) return res.status(404).json({ error: 'collaboration task not found', code: 'COLLABORATION_TASK_NOT_FOUND' })
      res.set('Cache-Control', 'no-store').json(task)
    } catch (error) { res.status(400).json(publicError(error)) }
  })

  router.get('/leases', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(worktreeManager.list().map(publicLease))
  })

  router.get('/metrics', async (_req, res) => {
    if (!metricsStore) return res.status(503).json({ error: 'collaboration delivery metrics are unavailable', code: 'COLLABORATION_METRICS_UNAVAILABLE' })
    try { res.set('Cache-Control', 'no-store').json({ summary: await metricsStore.summary(), observations: await metricsStore.list() }) }
    catch (error) { res.status(503).json(publicError(error)) }
  })

  router.get('/questions', (req, res) => {
    if (!questionLedgerFile) return res.status(503).json({ error: 'open-question ledger is unavailable', code: 'OPEN_QUESTION_LEDGER_UNAVAILABLE' })
    try {
      const ledger = readOpenQuestionLedger(questionLedgerFile), requested = req.query.status ? String(req.query.status).toUpperCase() : null
      if (requested && !Object.hasOwn(ledger.counts, requested)) return res.status(400).json({ error: 'unknown open-question status', code: 'OPEN_QUESTION_STATUS_INVALID' })
      res.set('Cache-Control', 'no-store').json({ ...ledger, questions: requested ? ledger.questions.filter(item => item.status === requested) : ledger.questions })
    } catch (error) { res.status(503).set('Cache-Control', 'no-store').json(publicError(error)) }
  })

  router.post('/tasks', requireMutationIntent('collaboration-task-change'), async (req, res) => {
    try {
      const result = await taskStore.createTask(req.body, { source: 'local-control-plane', dispatchAuthorized: false })
      appendAudit('collaboration_task_packet_saved', { taskId: result.task.taskId, assignedWorker: result.task.task.assignedWorker, taskType: result.task.task.taskType, duplicate: result.duplicate })
      res.status(result.duplicate ? 200 : 201).set('Cache-Control', 'no-store').json({ ...result, dispatchEnabled: false })
    } catch (error) { res.status(400).json(publicError(error)) }
  })

  router.post('/tasks/:taskId/dispatch', requireMutationIntent('collaboration-dispatch'), (req, res) => {
    if (!liveDispatch.enabled || !liveDispatch.dispatcher) return res.status(409).set('Cache-Control', 'no-store').json({ error: 'live collaboration dispatch requires explicit host-owner opt-in', code: 'COLLABORATION_DISPATCH_DISABLED', dispatchEnabled: false, unavailableReason: liveDispatch.reason })
    if (req.get('x-command-center-confirm') !== 'dispatch-fable') return res.status(428).json({ error: 'exact Fable dispatch confirmation is required', code: 'COLLABORATION_DISPATCH_CONFIRMATION_REQUIRED' })
    const baseSha = String(req.body?.baseSha || '')
    if (!/^[a-f0-9]{40,64}$/.test(baseSha)) return res.status(400).json({ error: 'an exact reviewed base SHA is required', code: 'COLLABORATION_BASE_REQUIRED' })
    void liveDispatch.dispatcher.dispatch(req.params.taskId, { baseSha, allowDirtyPrimaryPatterns: ['data/**'] }).then(receipt => {
      appendAudit('collaboration_dispatch_completed', { taskId: req.params.taskId, dispatchId: receipt.dispatchId, actualModel: receipt.actualModel, receiptSha256: receipt.receiptSha256 })
    }).catch(error => {
      appendAudit('collaboration_dispatch_stopped', { taskId: req.params.taskId, code: error.code || 'COLLABORATION_DISPATCH_FAILED', receiptSha256: error.dispatchReceipt?.receiptSha256 || null })
    })
    appendAudit('collaboration_dispatch_requested', { taskId: req.params.taskId, baseSha })
    res.status(202).set('Cache-Control', 'no-store').json({ accepted: true, taskId: req.params.taskId, dispatchEnabled: true })
  })

  router.post('/metrics/outcomes', requireMutationIntent('collaboration-metrics-change'), async (req, res) => {
    if (!metricsStore) return res.status(503).json({ error: 'collaboration delivery metrics are unavailable', code: 'COLLABORATION_METRICS_UNAVAILABLE' })
    try {
      const task = await taskStore.getTask(req.body?.taskId), lease = worktreeManager.get?.(req.body?.taskId) || null
      const result = await metricsStore.recordOutcome(req.body, { taskRecord: task, lease })
      appendAudit('collaboration_delivery_outcome_recorded', { taskId: result.observation.taskId, outcome: result.observation.outcome, duplicate: result.duplicate, observationId: result.observation.observationId })
      res.status(result.duplicate ? 200 : 201).set('Cache-Control', 'no-store').json(result)
    } catch (error) { res.status(error.code?.includes('CONFLICT') || error.code?.includes('RECORDED') ? 409 : 400).json(publicError(error)) }
  })

  router.post('/metrics/defects', requireMutationIntent('collaboration-metrics-change'), async (req, res) => {
    if (!metricsStore) return res.status(503).json({ error: 'collaboration delivery metrics are unavailable', code: 'COLLABORATION_METRICS_UNAVAILABLE' })
    try {
      const result = await metricsStore.recordDefect(req.body)
      appendAudit('collaboration_escaped_defect_recorded', { taskId: result.defect.taskId, severity: result.defect.severity, attributed: result.defect.attributed, duplicate: result.duplicate })
      res.status(result.duplicate ? 200 : 201).set('Cache-Control', 'no-store').json(result)
    } catch (error) { res.status(error.code?.includes('CONFLICT') ? 409 : 400).json(publicError(error)) }
  })

  return router
}
