import crypto from 'node:crypto'
import { runGit } from './worktree-manager.js'

export function createIntegrationManager({ repositoryRoot, worktreeManager }) {
  if (!worktreeManager) throw new Error('worktreeManager is required')
  const plans = new Map()

  function requireCleanTarget() {
    if (runGit(repositoryRoot, ['status', '--porcelain', '--untracked-files=all'])) throw Object.assign(new Error('integration target must be clean'), { code: 'COLLABORATION_DIRTY_INTEGRATION_TARGET' })
    return runGit(repositoryRoot, ['rev-parse', 'HEAD'])
  }

  function prepare({ taskId, taskPacket }) {
    const targetSha = requireCleanTarget()
    const verification = worktreeManager.inspect(taskId, { taskPacket, requireCommit: true })
    const baseOnTarget = runGit(repositoryRoot, ['merge-base', verification.baseSha, targetSha])
    if (baseOnTarget !== verification.baseSha) throw Object.assign(new Error('integration target does not contain the approved worker base'), { code: 'COLLABORATION_UNEXPECTED_BASE' })
    const plan = Object.freeze({ schemaVersion: 1, planId: crypto.randomUUID(), status: 'VERIFIED', taskId, targetSha, baseSha: verification.baseSha, commitSha: verification.headSha, filesChanged: verification.filesChanged, createdAt: Date.now() })
    plans.set(plan.planId, plan)
    return { ...plan }
  }

  function integrate(planId, { approved = false } = {}) {
    const plan = plans.get(planId)
    if (!plan) throw Object.assign(new Error('integration plan is unknown'), { code: 'COLLABORATION_UNKNOWN_INTEGRATION_PLAN' })
    if (!approved) throw Object.assign(new Error('explicit integration approval is required'), { code: 'COLLABORATION_INTEGRATION_NOT_APPROVED' })
    const currentTarget = requireCleanTarget()
    if (currentTarget !== plan.targetSha) throw Object.assign(new Error('integration target changed after verification'), { code: 'COLLABORATION_INTEGRATION_TARGET_CHANGED' })
    const currentWorktree = worktreeManager.get(plan.taskId)
    if (!currentWorktree || runGit(currentWorktree.path, ['rev-parse', 'HEAD']) !== plan.commitSha) throw Object.assign(new Error('worker commit changed after verification'), { code: 'COLLABORATION_WORKER_CHANGED' })
    try {
      runGit(repositoryRoot, ['cherry-pick', plan.commitSha])
    } catch (cause) {
      try { runGit(repositoryRoot, ['cherry-pick', '--abort']) } catch {}
      const error = new Error('approved integration conflicted and was aborted safely')
      error.code = 'COLLABORATION_INTEGRATION_CONFLICT'; error.cause = cause
      throw error
    }
    const integratedSha = runGit(repositoryRoot, ['rev-parse', 'HEAD'])
    plans.set(planId, Object.freeze({ ...plan, status: 'INTEGRATED', integratedSha, integratedAt: Date.now() }))
    worktreeManager.markInactive(plan.taskId)
    return { ...plans.get(planId) }
  }

  function reject(planId) {
    const plan = plans.get(planId)
    if (!plan) throw new Error('integration plan is unknown')
    plans.set(planId, Object.freeze({ ...plan, status: 'REJECTED', rejectedAt: Date.now() }))
    worktreeManager.markInactive(plan.taskId)
    return { ...plans.get(planId) }
  }

  function get(planId) { const plan = plans.get(planId); return plan ? { ...plan } : null }
  return { prepare, integrate, reject, get }
}
