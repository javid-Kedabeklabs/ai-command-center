const DEFAULT_MAX_CONCURRENT_CALLS = 2
const MAX_CONCURRENT_CALLS = 32

function positiveInteger(value, fallback = null) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

export function normalizeGlobalModelPolicy(policy = {}) {
  const maxConcurrentCalls = positiveInteger(policy.maxConcurrentCalls, DEFAULT_MAX_CONCURRENT_CALLS)
  const memoryBudgetBytes = positiveInteger(policy.memoryBudgetBytes)
  return {
    maxConcurrentCalls: Math.min(MAX_CONCURRENT_CALLS, maxConcurrentCalls),
    memoryBudgetBytes,
  }
}

export function globalModelPolicyFromEnv(env = process.env) {
  const memoryBudgetGb = Number(env.CC_GLOBAL_MODEL_MEMORY_GB)
  return normalizeGlobalModelPolicy({
    maxConcurrentCalls: env.CC_GLOBAL_MODEL_CALLS,
    memoryBudgetBytes: Number.isFinite(memoryBudgetGb) && memoryBudgetGb > 0
      ? Math.floor(memoryBudgetGb * 1024 ** 3)
      : null,
  })
}

// Only fields whose names explicitly describe memory are accepted. Model file
// size, parameter counts, quantization names, and context lengths are not
// reliable runtime-memory estimates.
export function explicitModelBytes(model) {
  for (const field of ['estimated_memory_bytes', 'loaded_size_bytes', 'memory_size_bytes', 'memory_bytes']) {
    const value = positiveInteger(model?.[field])
    if (value) return value
  }
  return null
}

function cancellationError(reason = 'global model wait cancelled') {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  error.name = 'AbortError'
  error.code ||= 'RESOURCE_CANCELLED'
  return error
}

export class GlobalModelCoordinator {
  constructor(policy = {}, callbacks = {}) {
    this.policy = normalizeGlobalModelPolicy(policy)
    this.callbacks = callbacks
    this.queue = []
    this.active = new Map()
    this.nextId = 1
    this.closed = false
  }

  snapshot() {
    const active = [...this.active.values()]
    const queued = this.queue.filter(request => !request.settled)
    const sumKnown = items => items.reduce((sum, item) => sum + (item.estimatedBytes || 0), 0)
    return {
      limits: { ...this.policy },
      active: active.length,
      queued: queued.length,
      activeEstimatedBytes: sumKnown(active),
      queuedEstimatedBytes: sumKnown(queued),
      activeUnknownEstimates: active.filter(item => !item.estimatedBytes).length,
      queuedUnknownEstimates: queued.filter(item => !item.estimatedBytes).length,
    }
  }

  acquire({ modelId = null, runId = null, nodeId = null, estimatedBytes = null, signal } = {}) {
    if (this.closed || signal?.aborted) return Promise.reject(cancellationError(signal?.reason || 'global model coordinator stopped'))
    const knownBytes = positiveInteger(estimatedBytes)
    if (knownBytes && this.policy.memoryBudgetBytes && knownBytes > this.policy.memoryBudgetBytes) {
      const error = new Error('model estimate exceeds the configured global model-memory budget')
      error.code = 'MODEL_MEMORY_BUDGET_EXCEEDED'
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const request = { id: this.nextId++, modelId, runId, nodeId, estimatedBytes: knownBytes, signal, resolve, reject, queuedAt: Date.now(), settled: false }
      if (signal) {
        request.onAbort = () => this.rejectRequest(request, cancellationError(signal.reason))
        signal.addEventListener('abort', request.onAbort, { once: true })
      }
      this.queue.push(request)
      if (!this.canAcquire(request) || this.queue[0] !== request) this.callbacks.onWait?.(this.publicRequest(request), this.snapshot())
      this.pump()
    })
  }

  publicRequest(request) {
    return { id: request.id, modelId: request.modelId, runId: request.runId, nodeId: request.nodeId, estimatedBytes: request.estimatedBytes, queuedAt: request.queuedAt }
  }

  canAcquire(request) {
    if (this.closed || this.active.size >= this.policy.maxConcurrentCalls) return false
    if (!request.estimatedBytes || !this.policy.memoryBudgetBytes) return true
    return this.snapshot().activeEstimatedBytes + request.estimatedBytes <= this.policy.memoryBudgetBytes
  }

  pump() {
    // Strict head-of-line admission gives callers fair FIFO ordering across runs.
    while (!this.closed) {
      const request = this.queue.find(item => !item.settled)
      if (!request || !this.canAcquire(request)) return
      request.settled = true
      this.queue = this.queue.filter(item => item !== request)
      if (request.signal && request.onAbort) request.signal.removeEventListener('abort', request.onAbort)
      const lease = { ...this.publicRequest(request), acquiredAt: Date.now(), released: false }
      this.active.set(lease.id, lease)
      this.callbacks.onAcquire?.({ ...lease }, this.snapshot())
      request.resolve(() => this.release(lease.id))
    }
  }

  release(id) {
    const lease = this.active.get(id)
    if (!lease || lease.released) return
    lease.released = true
    this.active.delete(id)
    this.callbacks.onRelease?.({ ...lease }, this.snapshot())
    this.pump()
  }

  rejectRequest(request, error) {
    if (request.settled) return
    request.settled = true
    if (request.signal && request.onAbort) request.signal.removeEventListener('abort', request.onAbort)
    this.queue = this.queue.filter(item => item !== request)
    request.reject(error)
    this.callbacks.onCancel?.(this.publicRequest(request), this.snapshot())
    this.pump()
  }

  async withModel(options, operation) {
    const release = await this.acquire(options)
    try { return await operation() } finally { release() }
  }

  shutdown(reason = 'server shutting down') {
    this.closed = true
    for (const request of [...this.queue]) this.rejectRequest(request, cancellationError(reason))
    for (const id of [...this.active.keys()]) this.release(id)
  }
}
