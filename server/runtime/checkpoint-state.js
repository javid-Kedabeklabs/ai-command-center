import crypto from 'node:crypto'

export const CHECKPOINT_SCHEMA_VERSION = 2

export const NODE_STATES = Object.freeze([
  'pending',
  'running',
  'waiting',
  'succeeded',
  'skipped',
  'failed',
  'cancelled',
  'needs_review',
])

export const EFFECT_STATES = Object.freeze(['prepared', 'inflight', 'confirmed', 'ambiguous'])

const terminalStates = new Set(['succeeded', 'skipped', 'failed', 'cancelled'])
const clone = value => structuredClone(value)
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex')

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
}

function assertNode(snapshot, nodeId) {
  const node = snapshot.nodes?.[nodeId]
  if (!node) throw new Error(`checkpoint does not contain node ${nodeId}`)
  return node
}

function next(snapshot, mutate) {
  const copy = clone(snapshot)
  mutate(copy)
  copy.revision += 1
  copy.updatedAt = Date.now()
  validateCheckpoint(copy)
  return copy
}

export function logicalExecutionKey({ logicalRunId, workflowVersionHash, nodeId, invocationPath = '' }) {
  if (!logicalRunId || !workflowVersionHash || !nodeId) throw new Error('logical execution identity requires run, workflow hash, and node')
  return `exec-${digest([logicalRunId, workflowVersionHash, invocationPath, nodeId].join('\0')).slice(0, 32)}`
}

export function effectOperationKey(execKey) {
  if (!execKey) throw new Error('effect operation key requires an execution key')
  return `op-${digest(execKey).slice(0, 32)}`
}

export function createCheckpoint({ logicalRunId, workflowVersion, workflowVersionHash, nodeIds, runtimeEpoch = crypto.randomUUID(), executionPolicy = null, triggerReceipt = null }) {
  if (!logicalRunId || !workflowVersion || !workflowVersionHash) throw new Error('checkpoint identity is incomplete')
  const uniqueNodeIds = [...new Set((nodeIds || []).map(String))]
  if (!uniqueNodeIds.length || uniqueNodeIds.some(id => !id)) throw new Error('checkpoint requires non-empty node identifiers')
  const nodes = Object.fromEntries(uniqueNodeIds.map(nodeId => {
    const execKey = logicalExecutionKey({ logicalRunId, workflowVersionHash, nodeId })
    return [nodeId, { execKey, nodeId, inputHash: null, state: 'pending', attemptsStarted: 0 }]
  }))
  const snapshot = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    revision: 0,
    logicalRunId,
    workflowVersion,
    workflowVersionHash,
    runtimeEpoch,
    nodes,
    outputs: {},
    routes: {},
    skipped: [],
    activeLeases: [],
    executionPolicy,
    ...(triggerReceipt ? { triggerReceipt: clone(triggerReceipt) } : {}),
    subworkflows: [],
    updatedAt: Date.now(),
  }
  validateCheckpoint(snapshot)
  return snapshot
}

export function migrateLegacyCheckpoint(legacy, identity) {
  assertRecord(legacy, 'legacy checkpoint')
  const snapshot = createCheckpoint(identity)
  snapshot.outputs = clone(legacy.outputs || {})
  snapshot.routes = clone(legacy.routes || {})
  snapshot.skipped = [...new Set((legacy.skipped || []).map(String))]
  snapshot.activeLeases = clone(legacy.activeLeases || [])
  if (legacy.triggerReceipt || identity.triggerReceipt) snapshot.triggerReceipt = clone(legacy.triggerReceipt || identity.triggerReceipt)
  snapshot.subworkflows = clone(legacy.subworkflows || [])
  for (const [nodeId, node] of Object.entries(snapshot.nodes)) {
    if (Object.hasOwn(snapshot.outputs, nodeId)) node.state = 'succeeded'
    if (snapshot.skipped.includes(nodeId)) node.state = 'skipped'
  }
  snapshot.migratedFromSchemaVersion = Number(legacy.schemaVersion) || 1
  // lastNodeId was written before execution and is not completion evidence.
  snapshot.legacyLastNodeId = legacy.lastNodeId || null
  validateCheckpoint(snapshot)
  return snapshot
}

export function claimNode(snapshot, nodeId, { inputHash, attemptId = crypto.randomUUID(), workerId = 'local-runtime', leaseUntilEpochMs = null } = {}) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    if (!['pending', 'failed'].includes(node.state)) throw new Error(`cannot claim ${nodeId} from ${node.state}`)
    if (!inputHash) throw new Error(`cannot claim ${nodeId} without an input hash`)
    node.state = 'running'
    node.inputHash = inputHash
    node.attemptsStarted += 1
    node.activeAttempt = {
      id: attemptId,
      number: node.attemptsStarted,
      runtimeEpoch: copy.runtimeEpoch,
      workerId,
      leaseUntilEpochMs,
      phase: 'claimed',
      startedAt: Date.now(),
    }
  })
}

function requireCurrentAttempt(node, attemptId) {
  if (node.state !== 'running' || !node.activeAttempt || node.activeAttempt.id !== attemptId) throw new Error(`stale or inactive attempt for ${node.nodeId}`)
}

export function prepareEffect(snapshot, nodeId, attemptId, { requestHash, operationKey, reconciliation = null, output = undefined } = {}) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    requireCurrentAttempt(node, attemptId)
    if (!requestHash) throw new Error(`effect for ${nodeId} requires a request hash`)
    node.activeAttempt.phase = 'effect_prepared'
    node.effect = { operationKey: operationKey || effectOperationKey(node.execKey), requestHash, state: 'prepared', ...(reconciliation ? { reconciliation: clone(reconciliation) } : {}), ...(output !== undefined ? { output } : {}) }
  })
}

export function markEffectInflight(snapshot, nodeId, attemptId) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    requireCurrentAttempt(node, attemptId)
    if (node.effect?.state !== 'prepared') throw new Error(`effect for ${nodeId} is not prepared`)
    node.activeAttempt.phase = 'effect_inflight'
    node.effect.state = 'inflight'
  })
}

export function confirmEffect(snapshot, nodeId, attemptId, receipt) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    requireCurrentAttempt(node, attemptId)
    if (!['inflight', 'prepared'].includes(node.effect?.state)) throw new Error(`effect for ${nodeId} cannot be confirmed`)
    node.activeAttempt.phase = 'effect_confirmed'
    node.effect.state = 'confirmed'
    const detail = receipt && typeof receipt === 'object' ? receipt : { receiptRef: receipt }
    node.effect.receiptRef = detail.receiptRef || null
    if (detail.output !== undefined) node.effect.output = detail.output
    if (detail.outputHash) node.effect.outputHash = detail.outputHash
  })
}

export function completeNode(snapshot, nodeId, attemptId, { output, outputHash, skipped = false } = {}) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    requireCurrentAttempt(node, attemptId)
    if (node.effect && node.effect.state !== 'confirmed') throw new Error(`effect for ${nodeId} is not confirmed`)
    node.state = skipped ? 'skipped' : 'succeeded'
    node.outputHash = outputHash || digest(output ?? '')
    delete node.activeAttempt
    if (skipped) copy.skipped = [...new Set([...copy.skipped, nodeId])]
    else copy.outputs[nodeId] = output ?? ''
  })
}

export function failNode(snapshot, nodeId, attemptId, errorRef = null, { ambiguous = false } = {}) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    requireCurrentAttempt(node, attemptId)
    node.state = ambiguous || node.effect?.state === 'inflight' ? 'needs_review' : 'failed'
    if (node.state === 'needs_review') {
      node.effect ||= { operationKey: effectOperationKey(node.execKey), requestHash: node.inputHash || 'unknown', state: 'ambiguous' }
      node.effect.state = 'ambiguous'
    }
    node.lastErrorRef = errorRef
    delete node.activeAttempt
  })
}

export function waitNode(snapshot, nodeId, attemptId, wait) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    requireCurrentAttempt(node, attemptId)
    if (!wait?.kind || !wait?.ref) throw new Error(`wait state for ${nodeId} requires a kind and reference`)
    node.state = 'waiting'
    node.wait = clone(wait)
    node.activeAttempt.phase = 'waiting'
  })
}

export function resumeWaitingNode(snapshot, nodeId, attemptId, waitRef) {
  return next(snapshot, copy => {
    const node = assertNode(copy, nodeId)
    if (node.state !== 'waiting' || node.activeAttempt?.id !== attemptId || node.wait?.ref !== waitRef) throw new Error(`stale or inactive wait for ${nodeId}`)
    node.state = 'running'
    node.activeAttempt.phase = 'claimed'
    delete node.wait
  })
}

export function resetCheckpointNodes(snapshot, nodeIds) {
  const selected = new Set((nodeIds || []).map(String))
  return next(snapshot, copy => {
    for (const nodeId of selected) {
      const node = assertNode(copy, nodeId)
      node.state = 'pending'
      node.inputHash = null
      delete node.activeAttempt
      delete node.effect
      delete node.outputHash
      delete node.lastErrorRef
      delete copy.outputs[nodeId]
      delete copy.routes[nodeId]
      copy.skipped = copy.skipped.filter(id => id !== nodeId)
    }
  })
}

export function recoverCheckpoint(snapshot, { runtimeEpoch = crypto.randomUUID(), reconcile = {}, unsafeNodeIds = [] } = {}) {
  validateCheckpoint(snapshot)
  const unsafe = new Set(unsafeNodeIds.map(String))
  return next(snapshot, copy => {
    copy.runtimeEpoch = runtimeEpoch
    for (const node of Object.values(copy.nodes)) {
      if (node.state === 'waiting') {
        node.state = 'pending'
        delete node.activeAttempt
        continue
      }
      if (node.state !== 'running') continue
      const decision = reconcile[node.nodeId]
      if (node.effect?.state === 'confirmed') {
        node.state = 'succeeded'
        if (node.effect.output !== undefined) copy.outputs[node.nodeId] = node.effect.output
        node.outputHash = node.effect.outputHash || digest(node.effect.output ?? '')
      } else if (node.effect?.state === 'inflight') {
        node.state = decision === 'absent' ? 'pending' : decision === 'confirmed' ? 'succeeded' : 'needs_review'
        if (node.state === 'succeeded') {
          node.effect.state = 'confirmed'
          if (node.effect.output !== undefined) copy.outputs[node.nodeId] = node.effect.output
          node.outputHash = node.effect.outputHash || digest(node.effect.output ?? '')
        } else if (node.state === 'needs_review') node.effect.state = 'ambiguous'
      } else if (node.effect?.state === 'prepared') {
        node.state = 'pending'
      } else if (unsafe.has(node.nodeId)) {
        node.state = 'needs_review'
        node.effect ||= { operationKey: effectOperationKey(node.execKey), requestHash: node.inputHash || 'legacy-unknown', state: 'ambiguous' }
      } else {
        node.state = 'pending'
      }
      delete node.activeAttempt
    }
  })
}

export function validateCheckpoint(snapshot) {
  assertRecord(snapshot, 'checkpoint')
  if (snapshot.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) throw new Error(`unsupported checkpoint schema ${snapshot.schemaVersion}`)
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('checkpoint revision must be a non-negative integer')
  if (!snapshot.logicalRunId || !snapshot.workflowVersion || !snapshot.workflowVersionHash || !snapshot.runtimeEpoch) throw new Error('checkpoint identity is incomplete')
  assertRecord(snapshot.nodes, 'checkpoint nodes')
  if (snapshot.triggerReceipt) {
    assertRecord(snapshot.triggerReceipt, 'checkpoint trigger receipt')
    if (!/^[a-z0-9_.-]+$/i.test(String(snapshot.triggerReceipt.deliveryId || '')) || !/^[a-f0-9]{64}$/.test(String(snapshot.triggerReceipt.deliveryKey || '')) || !/^trigger-[a-z0-9_-]{6,80}$/i.test(String(snapshot.triggerReceipt.triggerId || '')) || !/^[a-z0-9_.-]+$/i.test(String(snapshot.triggerReceipt.workflowVersion || ''))) throw new Error('checkpoint trigger receipt is incomplete')
  }
  for (const [nodeId, node] of Object.entries(snapshot.nodes)) {
    assertRecord(node, `checkpoint node ${nodeId}`)
    if (node.nodeId !== nodeId || !node.execKey) throw new Error(`checkpoint node ${nodeId} identity is invalid`)
    if (!NODE_STATES.includes(node.state)) throw new Error(`checkpoint node ${nodeId} has invalid state ${node.state}`)
    if (!Number.isInteger(node.attemptsStarted) || node.attemptsStarted < 0) throw new Error(`checkpoint node ${nodeId} has invalid attempt count`)
    if (node.state === 'running' && !node.activeAttempt) throw new Error(`running checkpoint node ${nodeId} requires an active attempt`)
    if (node.activeAttempt && node.activeAttempt.runtimeEpoch !== snapshot.runtimeEpoch) throw new Error(`checkpoint node ${nodeId} has an unfenced runtime epoch`)
    if (node.effect && (!node.effect.operationKey || !node.effect.requestHash || !EFFECT_STATES.includes(node.effect.state))) throw new Error(`checkpoint node ${nodeId} has invalid effect evidence`)
    if (terminalStates.has(node.state) && node.activeAttempt) throw new Error(`terminal checkpoint node ${nodeId} cannot retain an active attempt`)
  }
  return snapshot
}
