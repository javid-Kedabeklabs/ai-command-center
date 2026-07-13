import express from 'express'

const publicError = error => ({ error: String(error?.message || error).slice(0, 500), code: error?.code || 'LOCAL_FACTORY_ERROR' })

export function createLocalFactoryRouter({ factory, appendAudit = () => {} } = {}) {
  if (!factory) throw new Error('local factory is required')
  const router = express.Router()

  router.get('/status', async (_req, res) => {
    try {
      await factory.initialize()
      res.json({ enabled: true, model: 'qwen-coder-factory', endpoint: factory.endpoint, ...factory.snapshot() })
    } catch (error) { res.status(503).json(publicError(error)) }
  })

  router.get('/tasks', async (_req, res) => {
    try { res.json(await factory.listTasks()) }
    catch (error) { res.status(500).json(publicError(error)) }
  })

  router.get('/tasks/:taskId', async (req, res) => {
    try {
      const task = await factory.getTask(req.params.taskId)
      if (!task) return res.status(404).json({ error: 'local factory task not found' })
      res.json(task)
    } catch (error) { res.status(400).json(publicError(error)) }
  })

  router.post('/tasks', async (req, res) => {
    try {
      const accepted = await factory.enqueue(req.body)
      appendAudit('local_factory_task_queued', { taskId: accepted.taskId, taskType: req.body?.taskType, workerRole: req.body?.workerRole })
      res.status(202).json(accepted)
    } catch (error) { res.status(400).json(publicError(error)) }
  })

  router.post('/tasks/:taskId/cancel', async (req, res) => {
    try {
      const cancelled = await factory.cancel(req.params.taskId)
      if (!cancelled) return res.status(409).json({ error: 'task is not queued or running' })
      appendAudit('local_factory_task_cancelled', { taskId: req.params.taskId })
      res.json({ ok: true, taskId: req.params.taskId })
    } catch (error) { res.status(400).json(publicError(error)) }
  })

  return router
}
