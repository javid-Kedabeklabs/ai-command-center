import crypto from 'node:crypto'

export const RUN_CONTROL_SCHEMA_VERSION = 1

const clone = value => structuredClone(value)
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex')

export function createRunControl(existing = null) {
  if (existing) {
    validateRunControl(existing)
    return clone(existing)
  }
  return { schemaVersion: RUN_CONTROL_SCHEMA_VERSION, revision: 0, manualPause: { paused: false, generation: 0 }, approvals: {}, commandReceipts: {}, updatedAt: Date.now() }
}

function update(control, mutate) {
  const copy = createRunControl(control)
  mutate(copy)
  copy.revision += 1
  copy.updatedAt = Date.now()
  validateRunControl(copy)
  return copy
}

export function approvalSubjectHash({ runId, workflowVersionHash, nodeExecKey, operationKey, inputHash, permissionHash, message }) {
  return digest(JSON.stringify({ runId, workflowVersionHash, nodeExecKey, operationKey: operationKey || null, inputHash, permissionHash: permissionHash || null, message: message || '' }))
}

export function requestApproval(control, input) {
  const subjectHash = approvalSubjectHash(input)
  const approvalId = `approval-${digest(`${input.runId}\0${input.nodeExecKey}\0${subjectHash}`).slice(0, 32)}`
  const existing = control.approvals[approvalId]
  if (existing) return { control: createRunControl(control), approval: clone(existing) }
  const approval = {
    id: approvalId,
    runId: input.runId,
    nodeId: input.nodeId,
    nodeExecKey: input.nodeExecKey,
    subjectHash,
    revision: 0,
    state: 'pending',
    requestedAt: Date.now(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  }
  const next = update(control, copy => { copy.approvals[approvalId] = approval })
  return { control: next, approval: clone(next.approvals[approvalId]) }
}

export function decideApproval(control, { approvalId, decision, commandId, expectedRevision, expectedSubjectHash, actorId = 'local-owner', commentRef = null }) {
  if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('approval decision must be approved or rejected'), { code: 'INVALID_APPROVAL_DECISION' })
  if (!commandId) throw Object.assign(new Error('approval decision requires a command id'), { code: 'APPROVAL_COMMAND_REQUIRED' })
  const requestHash = digest(JSON.stringify({ approvalId, decision, expectedRevision, expectedSubjectHash, actorId, commentRef }))
  const previousReceipt = control.commandReceipts[commandId]
  if (previousReceipt) {
    if (previousReceipt.requestHash !== requestHash) throw Object.assign(new Error('command id was already used for a different approval decision'), { code: 'APPROVAL_COMMAND_CONFLICT' })
    return { control: createRunControl(control), receipt: clone(previousReceipt), replay: true }
  }
  const current = control.approvals[approvalId]
  if (!current) throw Object.assign(new Error('approval request was not found'), { code: 'APPROVAL_NOT_FOUND' })
  if (expectedRevision != null && Number(expectedRevision) !== current.revision) throw Object.assign(new Error('approval revision is stale'), { code: 'STALE_APPROVAL_REVISION' })
  if (expectedSubjectHash && expectedSubjectHash !== current.subjectHash) throw Object.assign(new Error('approval subject is stale'), { code: 'STALE_APPROVAL_SUBJECT' })
  if (current.state !== 'pending') throw Object.assign(new Error('approval already has a terminal decision'), { code: 'APPROVAL_DECISION_CONFLICT' })
  let receipt
  const next = update(control, copy => {
    const approval = copy.approvals[approvalId]
    approval.state = decision
    approval.revision += 1
    approval.decision = { commandId, value: decision, actorId, decidedAt: Date.now(), ...(commentRef ? { commentRef } : {}) }
    receipt = { commandId, requestHash, approvalId, decision, approvalRevision: approval.revision, committedAt: approval.decision.decidedAt }
    copy.commandReceipts[commandId] = receipt
  })
  return { control: next, receipt: clone(receipt), replay: false }
}

export function setManualPause(control, { paused, commandId, expectedGeneration = null }) {
  if (!commandId) throw Object.assign(new Error('pause command requires a command id'), { code: 'PAUSE_COMMAND_REQUIRED' })
  const requestHash = digest(JSON.stringify({ paused: !!paused, expectedGeneration }))
  const previousReceipt = control.commandReceipts[commandId]
  if (previousReceipt) {
    if (previousReceipt.requestHash !== requestHash) throw Object.assign(new Error('command id was already used for a different pause command'), { code: 'PAUSE_COMMAND_CONFLICT' })
    return { control: createRunControl(control), receipt: clone(previousReceipt), replay: true }
  }
  if (expectedGeneration != null && Number(expectedGeneration) !== control.manualPause.generation) throw Object.assign(new Error('manual pause generation is stale'), { code: 'STALE_PAUSE_GENERATION' })
  let receipt
  const next = update(control, copy => {
    copy.manualPause.paused = !!paused
    copy.manualPause.generation += 1
    copy.manualPause.lastCommandId = commandId
    receipt = { commandId, requestHash, paused: !!paused, generation: copy.manualPause.generation, committedAt: Date.now() }
    copy.commandReceipts[commandId] = receipt
  })
  return { control: next, receipt: clone(receipt), replay: false }
}

export function pendingApprovalForNode(control, nodeId) {
  return Object.values(control.approvals).find(item => item.nodeId === nodeId && item.state === 'pending') || null
}

export function validateRunControl(control) {
  if (!control || typeof control !== 'object' || control.schemaVersion !== RUN_CONTROL_SCHEMA_VERSION) throw new Error('unsupported run control schema')
  if (!Number.isInteger(control.revision) || control.revision < 0) throw new Error('run control revision is invalid')
  if (!control.manualPause || typeof control.manualPause.paused !== 'boolean' || !Number.isInteger(control.manualPause.generation) || control.manualPause.generation < 0) throw new Error('manual pause state is invalid')
  for (const [id, approval] of Object.entries(control.approvals || {})) {
    if (approval.id !== id || !approval.runId || !approval.nodeId || !approval.nodeExecKey || !approval.subjectHash || !['pending', 'approved', 'rejected', 'expired', 'cancelled', 'superseded'].includes(approval.state)) throw new Error(`approval ${id} is invalid`)
  }
  if (!control.commandReceipts || typeof control.commandReceipts !== 'object') throw new Error('command receipts are invalid')
  return control
}
