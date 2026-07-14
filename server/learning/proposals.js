import crypto from 'node:crypto'

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const cleanIds = values => [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))].sort()

export function learningProposalFingerprint({ workflowId, sourceWorkflowHash, kind, findingKey, patch } = {}) {
  return digest({ workflowId: String(workflowId || ''), sourceWorkflowHash: String(sourceWorkflowHash || ''), kind: String(kind || ''), findingKey: String(findingKey || kind || ''), patch: patch || null })
}

export function normalizeLearningProposal(input, { now = Date.now() } = {}) {
  const workflowId = String(input?.workflowId || ''), kind = String(input?.kind || '')
  if (!workflowId || !kind) throw Object.assign(new Error('learning proposal requires workflow and kind'), { code: 'INVALID_LEARNING_PROPOSAL', status: 400 })
  const evidence = cleanIds(input.evidence), sourceWorkflowHash = String(input.sourceWorkflowHash || ''), findingKey = String(input.findingKey || kind)
  const fingerprint = learningProposalFingerprint({ workflowId, sourceWorkflowHash, kind, findingKey, patch: input.patch })
  return {
    schemaVersion: 1,
    id: String(input.id || crypto.randomUUID()),
    fingerprint,
    workflowId,
    sourceWorkflowHash,
    kind,
    findingKey,
    title: String(input.title || kind).slice(0, 160),
    rationale: String(input.rationale || '').slice(0, 2000),
    patch: input.patch || null,
    status: ['proposed', 'approved', 'rejected', 'verified', 'adopted'].includes(input.status) ? input.status : 'proposed',
    evidence,
    observationCount: Math.max(1, Number(input.observationCount) || evidence.length || 1),
    createdAt: Number(input.createdAt) || now,
    updatedAt: now,
    expiresAt: Number(input.expiresAt) || now + 60 * 24 * 60 * 60 * 1000,
    ...(input.decision ? { decision: input.decision } : {}),
    ...(input.verification ? { verification: input.verification } : {}),
    ...(input.candidateWorkflowId ? { candidateWorkflowId: String(input.candidateWorkflowId), applied: false } : {}),
  }
}

export function mergeLearningProposals(existing, generated, { now = Date.now() } = {}) {
  const list = (Array.isArray(existing) ? existing : []).map(item => normalizeLearningProposal(item, { now: Number(item.updatedAt) || now }))
  const byFingerprint = new Map(list.map(item => [item.fingerprint, item]))
  const emitted = []
  for (const raw of generated || []) {
    const candidate = normalizeLearningProposal(raw, { now }), previous = byFingerprint.get(candidate.fingerprint)
    if (previous) {
      previous.evidence = cleanIds([...previous.evidence, ...candidate.evidence])
      previous.observationCount = Math.max(previous.observationCount, previous.evidence.length)
      previous.updatedAt = now
      previous.expiresAt = Math.max(previous.expiresAt, candidate.expiresAt)
      emitted.push(previous)
    } else {
      list.unshift(candidate); byFingerprint.set(candidate.fingerprint, candidate); emitted.push(candidate)
    }
  }
  return { proposals: list.slice(0, 500), emitted }
}

export function decideLearningProposal(proposal, { decision, commandId, actor = 'local-owner', now = Date.now() } = {}) {
  const value = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : null
  if (!value || !commandId) throw Object.assign(new Error('decision and commandId are required'), { code: 'INVALID_LEARNING_DECISION', status: 400 })
  const requestHash = digest({ proposalId: proposal.id, decision: value, actor: String(actor) })
  if (proposal.decision?.commandId === commandId) {
    if (proposal.decision.requestHash !== requestHash) throw Object.assign(new Error('learning command id was reused with different intent'), { code: 'LEARNING_COMMAND_CONFLICT', status: 409 })
    return { proposal, replay: true }
  }
  if (proposal.status !== 'proposed') throw Object.assign(new Error(`proposal is already ${proposal.status}`), { code: 'LEARNING_DECISION_CONFLICT', status: 409 })
  const next = { ...proposal, status: value, updatedAt: now, decision: { commandId, requestHash, value, actor: String(actor), decidedAt: now } }
  if (value === 'approved' && proposal.patch?.settings) next.candidateWorkflowId = `${proposal.workflowId}-learning-${proposal.id.replace(/[^a-z0-9]/gi, '').slice(-12).toLowerCase()}`, next.applied = false
  return { proposal: next, replay: false }
}

export function verifyLearningProposal(proposal, { suite, record, candidate, commandId, actor = 'local-owner', now = Date.now() } = {}) {
  if (!commandId || !suite || !record || !candidate) throw Object.assign(new Error('exact verification evidence and commandId are required'), { code: 'INVALID_LEARNING_VERIFICATION', status: 400 })
  const requestHash = digest({ proposalId: proposal.id, suiteId: suite.id, recordId: record.id, recordHash: record.recordHash, candidateId: candidate.id, actor: String(actor) })
  if (proposal.verification?.commandId === commandId) {
    if (proposal.verification.requestHash !== requestHash) throw Object.assign(new Error('learning verification command was reused with different evidence'), { code: 'LEARNING_VERIFICATION_CONFLICT', status: 409 })
    return { proposal, replay: true }
  }
  if (proposal.status !== 'approved' || proposal.candidateWorkflowId !== candidate.workflowId) throw Object.assign(new Error('approved learning candidate does not match verification evidence'), { code: 'LEARNING_CANDIDATE_EVIDENCE_MISMATCH', status: 409 })
  return { proposal: { ...proposal, status: 'verified', updatedAt: now, verification: { commandId, requestHash, actor: String(actor), suiteId: suite.id, recordId: record.id, recordHash: record.recordHash, candidateId: candidate.id, workflowVersion: candidate.workflowVersion, verifiedAt: now } }, replay: false }
}
