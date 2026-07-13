import { validateLocalFactoryTask } from './task-schema.js'

export class LocalFactoryWorkerPool {
  constructor({ concurrency = 4, maxQueue = 100, runTask }) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('local factory concurrency must be between 1 and 8')
    if (!Number.isInteger(maxQueue) || maxQueue < concurrency || maxQueue > 1_000) throw new Error('local factory maxQueue is invalid')
    if (typeof runTask !== 'function') throw new Error('local factory runTask is required')
    this.concurrency = concurrency
    this.maxQueue = maxQueue
    this.runTask = runTask
    this.queue = []
    this.active = new Map()
    this.completed = 0
    this.closed = false
  }

  snapshot() {
    return { concurrency: this.concurrency, maxQueue: this.maxQueue, queued: this.queue.length, active: this.active.size, completed: this.completed, closed: this.closed }
  }

  submit(input) {
    const task = validateLocalFactoryTask(input)
    if (task.status !== 'QUEUED') return Promise.reject(new Error('local factory can only submit QUEUED tasks'))
    if (this.closed) return Promise.reject(Object.assign(new Error('local factory is stopped'), { code: 'LOCAL_FACTORY_STOPPED' }))
    if (this.queue.length + this.active.size >= this.maxQueue) return Promise.reject(Object.assign(new Error('local factory queue is full'), { code: 'LOCAL_FACTORY_QUEUE_FULL' }))
    if (this.queue.some(item => item.task.taskId === task.taskId) || this.active.has(task.taskId)) return Promise.reject(Object.assign(new Error('local factory task is already queued or running'), { code: 'LOCAL_FACTORY_DUPLICATE_TASK' }))
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject, controller: new AbortController(), queuedAt: Date.now() })
      this.queue.sort((a, b) => b.task.priority - a.task.priority || a.queuedAt - b.queuedAt)
      this.pump()
    })
  }

  cancel(taskId, reason = 'local factory task cancelled') {
    const queued = this.queue.find(item => item.task.taskId === taskId)
    if (queued) {
      this.queue = this.queue.filter(item => item !== queued)
      queued.controller.abort(reason)
      queued.reject(Object.assign(new Error(reason), { name: 'AbortError', code: 'LOCAL_FACTORY_CANCELLED' }))
      return true
    }
    const active = this.active.get(taskId)
    if (!active) return false
    active.controller.abort(reason)
    return true
  }

  pump() {
    while (!this.closed && this.active.size < this.concurrency && this.queue.length) {
      const item = this.queue.shift()
      this.active.set(item.task.taskId, item)
      Promise.resolve(this.runTask(item.task, { signal: item.controller.signal }))
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active.delete(item.task.taskId)
          this.completed++
          this.pump()
        })
    }
  }

  shutdown(reason = 'local factory stopped') {
    this.closed = true
    for (const item of this.queue.splice(0)) {
      item.controller.abort(reason)
      item.reject(Object.assign(new Error(reason), { name: 'AbortError', code: 'LOCAL_FACTORY_STOPPED' }))
    }
    for (const item of this.active.values()) item.controller.abort(reason)
  }
}
