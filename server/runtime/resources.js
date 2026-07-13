export const RESOURCE_POLICY_FIELDS = Object.freeze({
  model: 'maxModelCalls',
  subprocess: 'maxSubprocesses',
  http: 'maxHttpRequests',
  mcp: 'maxMcpCalls',
})

export const DEFAULT_RESOURCE_POLICY = Object.freeze({
  maxModelCalls: 2,
  maxSubprocesses: 4,
  maxHttpRequests: 8,
  maxMcpCalls: 4,
})

const MAX_RESOURCE_LIMIT = 32

export function resourcePolicyErrors(resources, label = 'workflow settings.resources') {
  if (resources == null) return []
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) return [`${label} must be an object`]
  const errors = []
  for (const field of Object.values(RESOURCE_POLICY_FIELDS)) {
    if (resources[field] == null) continue
    const value = Number(resources[field])
    if (!Number.isInteger(value) || value < 1 || value > MAX_RESOURCE_LIMIT) errors.push(`${label}.${field} must be an integer from 1 to ${MAX_RESOURCE_LIMIT}`)
  }
  return errors
}

export function normalizeResourcePolicy(resources = {}) {
  const source = resources && typeof resources === 'object' && !Array.isArray(resources) ? resources : {}
  return Object.fromEntries(Object.entries(DEFAULT_RESOURCE_POLICY).map(([field, fallback]) => {
    const value = Number(source[field])
    return [field, Number.isInteger(value) && value >= 1 && value <= MAX_RESOURCE_LIMIT ? value : fallback]
  }))
}

export function nodeResourceLimit(node, kind) {
  const field = RESOURCE_POLICY_FIELDS[kind]
  if (!field) return null
  const resources = node?.runtime?.resources ?? node?.data?.runtime?.resources
  const value = Number(resources?.[field])
  return Number.isInteger(value) && value >= 1 && value <= MAX_RESOURCE_LIMIT ? value : null
}

function cancellationError(reason = 'resource wait cancelled') {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  error.name = 'AbortError'
  error.code ||= 'RESOURCE_CANCELLED'
  return error
}

export class ResourceCoordinator {
  constructor(resources, callbacks = {}) {
    this.policy = normalizeResourcePolicy(resources)
    this.callbacks = callbacks
    this.active = new Map()
    this.activeByNode = new Map()
    this.queue = []
    this.paused = false
    this.cancelled = false
    this.nextLease = 1
  }

  capacity(kind) {
    const field = RESOURCE_POLICY_FIELDS[kind]
    if (!field) throw new Error(`unknown resource kind: ${kind}`)
    return this.policy[field]
  }

  snapshot() {
    const active = Object.fromEntries(Object.keys(RESOURCE_POLICY_FIELDS).map(kind => [kind, this.active.get(kind) || 0]))
    const queued = Object.fromEntries(Object.keys(RESOURCE_POLICY_FIELDS).map(kind => [kind, this.queue.filter(item => item.kind === kind && !item.settled).length]))
    return { limits: { ...this.policy }, active, queued, paused: this.paused }
  }

  acquire(kind, { nodeId = null, limit = null, signal } = {}) {
    this.capacity(kind)
    if (this.cancelled || signal?.aborted) return Promise.reject(cancellationError(signal?.reason))
    return new Promise((resolve, reject) => {
      const request = { id: this.nextLease++, kind, nodeId, limit, signal, resolve, reject, settled: false, queuedAt: Date.now() }
      if (signal) {
        request.onAbort = () => this.rejectRequest(request, cancellationError(signal.reason))
        signal.addEventListener('abort', request.onAbort, { once: true })
      }
      this.queue.push(request)
      if (!this.canAcquire(request)) this.callbacks.onWait?.(request, this.snapshot())
      this.pump()
    })
  }

  rejectRequest(request, error) {
    if (request.settled) return
    request.settled = true
    if (request.signal && request.onAbort) request.signal.removeEventListener('abort', request.onAbort)
    request.reject(error)
    this.queue = this.queue.filter(item => item !== request)
    this.callbacks.onCancel?.(request, this.snapshot())
    this.pump()
  }

  canAcquire(request) {
    if (this.paused || this.cancelled) return false
    if ((this.active.get(request.kind) || 0) >= this.capacity(request.kind)) return false
    if (!request.nodeId || !request.limit) return true
    return (this.activeByNode.get(`${request.nodeId}:${request.kind}`) || 0) < request.limit
  }

  pump() {
    if (this.paused || this.cancelled) return
    for (const request of [...this.queue]) {
      if (request.settled || !this.canAcquire(request)) continue
      request.settled = true
      this.queue = this.queue.filter(item => item !== request)
      if (request.signal && request.onAbort) request.signal.removeEventListener('abort', request.onAbort)
      this.active.set(request.kind, (this.active.get(request.kind) || 0) + 1)
      const nodeKey = request.nodeId ? `${request.nodeId}:${request.kind}` : null
      if (nodeKey) this.activeByNode.set(nodeKey, (this.activeByNode.get(nodeKey) || 0) + 1)
      const lease = { id: request.id, kind: request.kind, nodeId: request.nodeId, acquiredAt: Date.now(), released: false }
      this.callbacks.onAcquire?.(lease, this.snapshot())
      request.resolve(() => {
        if (lease.released) return
        lease.released = true
        this.active.set(lease.kind, Math.max(0, (this.active.get(lease.kind) || 1) - 1))
        if (nodeKey) this.activeByNode.set(nodeKey, Math.max(0, (this.activeByNode.get(nodeKey) || 1) - 1))
        this.callbacks.onRelease?.(lease, this.snapshot())
        this.pump()
      })
    }
  }

  async withResource(kind, options, operation) {
    const release = await this.acquire(kind, options)
    try { return await operation() } finally { release() }
  }

  setPaused(paused) {
    this.paused = !!paused
    this.callbacks.onPause?.(this.snapshot())
    if (!this.paused) this.pump()
  }

  cancelAll(reason = 'resource wait cancelled') {
    this.cancelled = true
    for (const request of [...this.queue]) this.rejectRequest(request, cancellationError(reason))
  }
}
