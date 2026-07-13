import { loadLocalFactoryContext } from './context-loader.js'
import { createLmStudioFactoryClient } from './lmstudio-client.js'
import { createLocalFactoryTaskStore } from './task-store.js'
import { LocalFactoryWorkerPool } from './worker-pool.js'

export function createLocalModelFactory({ repositoryRoot, endpoint, concurrency = 4, maxQueue = 100, fetchImpl, storeRoot } = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required')
  const client = createLmStudioFactoryClient({ endpoint, fetchImpl })
  const store = createLocalFactoryTaskStore({ repositoryRoot, storeRoot })
  const pool = new LocalFactoryWorkerPool({
    concurrency,
    maxQueue,
    runTask: async (task, options) => {
      await store.transitionTask(task.taskId, 'RUNNING', { reason: 'WORKER_ACQUIRED' })
      try {
        const context = loadLocalFactoryContext({ repositoryRoot, files: task.contextFiles, maxInputBytes: task.maxInputBytes })
        const response = await client.run(task, context, options)
        const terminal = response.result.status === 'COMPLETED' ? 'COMPLETED'
          : response.result.status === 'PARTIAL' ? 'PARTIAL'
            : response.result.status === 'BLOCKED' ? 'BLOCKED' : 'FAILED'
        await store.transitionTask(task.taskId, terminal, { reason: 'MODEL_RESULT', result: response })
        return response
      } catch (error) {
        const cancelled = options.signal?.aborted || error?.name === 'AbortError'
        await store.transitionTask(task.taskId, cancelled ? 'CANCELLED' : 'FAILED', { reason: cancelled ? 'CANCELLED' : 'MODEL_ERROR', result: { error: error?.message || String(error), code: error?.code || null } }).catch(() => {})
        throw error
      }
    },
  })
  async function prepare(task) {
    const created = await store.createTask(task)
    if (created.duplicate) throw Object.assign(new Error('local factory task already exists in durable state'), { code: 'LOCAL_FACTORY_DUPLICATE_TASK' })
    return created.record
  }
  async function submit(task) {
    await prepare(task)
    try { return await pool.submit(task) }
    catch (error) {
      await store.transitionTask(task.taskId, 'FAILED', { reason: 'DISPATCH_FAILED', result: { error: error?.message || String(error), code: error?.code || null } }).catch(() => {})
      throw error
    }
  }
  async function enqueue(task) {
    const record = await prepare(task)
    pool.submit(task).catch(async error => {
      const current = await store.getTask(task.taskId).catch(() => null)
      if (current?.status === 'QUEUED') await store.transitionTask(task.taskId, 'FAILED', { reason: 'DISPATCH_FAILED', result: { error: error?.message || String(error), code: error?.code || null } }).catch(() => {})
    })
    return { taskId: record.taskId, status: record.status }
  }
  async function cancel(taskId) {
    const cancelled = pool.cancel(taskId)
    if (!cancelled) return false
    const current = await store.getTask(taskId).catch(() => null)
    if (current && ['QUEUED', 'RUNNING'].includes(current.status)) await store.transitionTask(taskId, 'CANCELLED', { reason: 'USER_CANCELLED' }).catch(() => {})
    return true
  }
  return Object.freeze({ initialize: () => store.initialize(), submit, enqueue, cancel, shutdown: reason => pool.shutdown(reason), snapshot: () => pool.snapshot(), listTasks: () => store.listTasks(), getTask: taskId => store.getTask(taskId), endpoint: client.endpoint })
}
