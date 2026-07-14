import crypto from 'node:crypto'
import { isReadOnlyTaskType } from './task-schema.js'
import { verifyTaskContract } from './contract-verifier.js'

const BLOCKING_FAILURES = new Set(['AUTH_REQUIRED', 'RATE_LIMITED', 'USAGE_LIMIT_REACHED', 'MODEL_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'PERMISSION_ERROR', 'COLLABORATION_START_RECEIPT_FAILED'])
const resultStatus = status => ({ COMPLETED: 'COMPLETED', PARTIAL: 'PARTIAL', BLOCKED: 'BLOCKED', FAILED_SAFELY: 'FAILED' })[status] || 'FAILED'
const publicLease = lease => lease ? { taskId: lease.taskId, branch: lease.branch, baseSha: lease.baseSha, state: lease.state, createdAt: lease.createdAt } : null
const publicInspection = value => value ? { taskId: value.taskId, branch: value.branch, baseSha: value.baseSha, headSha: value.headSha, commitCount: value.commitCount, filesChanged: value.filesChanged, clean: value.clean } : null
const receiptHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function createCollaborationDispatcher({ taskStore, worktreeManager, runner, now = () => Date.now(), randomId = () => crypto.randomBytes(10).toString('hex') } = {}) {
  if (!taskStore || !worktreeManager || !runner) throw new Error('taskStore, worktreeManager, and runner are required')

  async function dispatch(taskId, { baseSha = null, branchName = null, allowDirtyPrimaryPatterns = [] } = {}) {
    const record = await taskStore.getTask(taskId)
    if (!record) throw Object.assign(new Error('collaboration task not found'), { code: 'COLLABORATION_TASK_NOT_FOUND' })
    if (record.status !== 'QUEUED') throw Object.assign(new Error(`task cannot dispatch from ${record.status}`), { code: 'COLLABORATION_DUPLICATE_DISPATCH' })
    const task = record.task, readOnly = isReadOnlyTaskType(task.taskType)
    if (!readOnly && worktreeManager.available === false) throw Object.assign(new Error('a source Git checkout is required for modifying collaboration tasks'), { code: 'COLLABORATION_WORKTREE_UNAVAILABLE' })
    if (!baseSha) throw Object.assign(new Error('a reviewed base SHA is required'), { code: 'COLLABORATION_BASE_REQUIRED' })
    worktreeManager.assertPrimaryClean?.({ allowDirtyPrimaryPatterns })
    const contractVerification = verifyTaskContract({ repositoryRoot: worktreeManager.repositoryRoot, taskPacket: task, requestedBaseSha: baseSha })
    const dispatchId = `dispatch-${randomId()}`
    let lease = null, claimed = false, inspection = null
    try {
      if (!readOnly) lease = worktreeManager.create({ taskId: task.taskId, baseSha, branchName: branchName || `claude/${task.taskId}`, allowDirtyPrimaryPatterns })
      await taskStore.claimTask(task.taskId, { dispatchId, workerId: task.assignedWorker })
      claimed = true
      const worker = await runner.run(task, {
        worktree: lease ? { ...lease, verified: true } : null,
        onStarted: process => taskStore.updateDispatch(task.taskId, dispatchId, process),
      })
      if (lease) {
        inspection = worktreeManager.inspect(task.taskId, { taskPacket: task, requireCommit: task.requiresCommit })
        const reported = worker.result.commitSha
        if (!reported || (reported !== inspection.headSha && !inspection.headSha.startsWith(reported))) throw Object.assign(new Error('worker-reported commit does not match the inspected worktree'), { code: 'COLLABORATION_COMMIT_MISMATCH' })
        if (inspection.filesChanged.length > contractVerification.maxChangedFiles) throw Object.assign(new Error('worker commit exceeds the frozen changed-file budget'), { code: 'COLLABORATION_TASK_SIZE_EXCEEDED' })
        worktreeManager.markInactive(task.taskId)
      }
      const completedAt = now()
      const receipt = {
        schemaVersion: 1, dispatchId, taskId: task.taskId, status: resultStatus(worker.result.status),
        requestedModel: worker.requestedModel, actualModel: worker.actualModel, fallbackUsed: worker.fallbackUsed,
        process: worker.process, lease: publicLease(lease), inspection: publicInspection(inspection), contractVerification,
        result: worker.result, completedAt,
      }
      receipt.receiptSha256 = receiptHash(receipt)
      await taskStore.transitionTask(task.taskId, receipt.status, { reason: 'WORKER_RESULT_RECORDED', evidence: { dispatchReceipt: receipt } })
      return receipt
    } catch (error) {
      if (lease && worktreeManager.get(task.taskId)?.active) {
        try { worktreeManager.markInactive(task.taskId) } catch {}
      }
      if (claimed) {
        const failedAt = now(), status = BLOCKING_FAILURES.has(error.code) ? 'BLOCKED' : 'FAILED'
        const failure = { schemaVersion: 1, dispatchId, taskId: task.taskId, status, code: error.code || 'COLLABORATION_DISPATCH_FAILED', failedAt, lease: publicLease(lease), inspection: publicInspection(inspection) }
        failure.receiptSha256 = receiptHash(failure)
        try { await taskStore.transitionTask(task.taskId, status, { reason: failure.code, evidence: { dispatchReceipt: failure } }) } catch {}
        error.dispatchReceipt = failure
      }
      throw error
    }
  }

  return { dispatch }
}
