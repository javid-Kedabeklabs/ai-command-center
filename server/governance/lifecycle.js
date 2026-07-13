import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'
import { workflowContentHash } from '../workflows/versions.js'
import { normalizeWorkflowEnvironment } from './environments.js'
import { workflowOperationalEvidence } from './candidates.js'

export const LIFECYCLE_SCHEMA_VERSION = 1
const SAFE_ID = /^[a-z0-9_.-]+$/i
const ACTIONS = new Set(['prepare-testing', 'approve-testing', 'enter-testing', 'prepare-production', 'approve-production', 'deploy-production', 'rollback'])
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }) }
const immutableRecord = body => Object.freeze({ ...body, recordHash: digest(body) })

function legacyUnbound(records) {
  return Array.isArray(records) ? records.map(record => record && typeof record === 'object'
    ? { ...record, bindingStatus: 'legacy-unbound', promotable: false }
    : record) : records
}

export function migrateGovernanceLifecycle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('GOVERNANCE_INVALID_DOCUMENT', 'workflow document required', 400)
  const workflow = structuredClone(input)
  const governance = workflow.governance && typeof workflow.governance === 'object' && !Array.isArray(workflow.governance) ? { ...workflow.governance } : {}
  const statusSignal = String(governance.status || '').trim().toLowerCase()
  const inferredEnvironment = workflow.environment == null
    ? (['production', 'deployed'].includes(statusSignal) || governance.promotedAt || governance.deployment ? 'production' : statusSignal === 'testing' ? 'testing' : 'development')
    : workflow.environment
  const environment = normalizeWorkflowEnvironment(inferredEnvironment)
  const previous = governance.lifecycle && typeof governance.lifecycle === 'object' && !Array.isArray(governance.lifecycle) ? governance.lifecycle : null
  const inconsistentProduction = environment === 'production' && (governance.locked !== true || !previous?.deploymentId)
  const inconsistentTesting = environment === 'testing' && (governance.locked !== true || !previous?.testingApprovalId)
  const conflictingSignal = (environment === 'development' && ['testing', 'production', 'deployed'].includes(statusSignal))
    || (environment !== 'production' && Boolean(governance.promotedAt || governance.deployment))
  const reviewRequired = inconsistentProduction || inconsistentTesting || conflictingSignal || previous?.reviewRequired === true
  const defaultState = environment === 'development' ? 'development' : environment === 'testing' ? 'testing' : 'deployed'
  governance.lifecycle = {
    ...(previous || {}),
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    state: reviewRequired ? 'review-required' : String(previous?.state || defaultState),
    reviewRequired,
  }
  if (Array.isArray(governance.approvalRecords)) governance.approvalRecords = legacyUnbound(governance.approvalRecords)
  if (Array.isArray(governance.evaluationHistory)) governance.evaluationHistory = legacyUnbound(governance.evaluationHistory)
  if (governance.approval != null && !governance.approvalBindingStatus) governance.approvalBindingStatus = 'legacy-unbound'
  if (reviewRequired) {
    governance.status = 'review-required'
    governance.locked = true
  }
  workflow.environment = environment
  workflow.governance = governance
  return { workflow, changed: JSON.stringify(workflow) !== JSON.stringify(input), reviewRequired }
}

function validateRequest(request) {
  const action = String(request?.action || '')
  if (!ACTIONS.has(action)) fail('INVALID_LIFECYCLE_ACTION', 'an explicit lifecycle action is required', 400)
  for (const field of ['actor', 'reason', 'expectedWorkflowId', 'expectedWorkflowVersion', 'expectedWorkflowHash', 'expectedOperationalHash']) {
    if (!String(request?.[field] || '').trim()) fail('LIFECYCLE_EXACT_BINDING_REQUIRED', `${field} is required`, 400)
  }
  if (!Array.isArray(request.selectedGateResultIds) || request.selectedGateResultIds.some(id => !SAFE_ID.test(String(id || '')))) fail('LIFECYCLE_EXACT_BINDING_REQUIRED', 'selectedGateResultIds must be an explicit list of safe ids', 400)
  if (new Set(request.selectedGateResultIds.map(String)).size !== request.selectedGateResultIds.length) fail('LIFECYCLE_EXACT_BINDING_REQUIRED', 'selectedGateResultIds cannot contain duplicates', 400)
  return action
}

function assertExact({ workflow, candidate, versionWorkflow, request }) {
  if (!candidate || !versionWorkflow) fail('EXACT_CANDIDATE_REQUIRED', 'an exact immutable candidate is required')
  const evidence = workflowOperationalEvidence(versionWorkflow)
  const currentEvidence = workflowOperationalEvidence(workflow)
  const exact = request.expectedWorkflowId === workflow.id
    && candidate.workflowId === workflow.id
    && request.expectedWorkflowVersion === candidate.workflowVersion
    && request.expectedWorkflowHash === candidate.sourceHash
    && request.expectedOperationalHash === candidate.operationalHash
    && workflowContentHash(versionWorkflow) === candidate.sourceHash
    && evidence.operationalHash === candidate.operationalHash
    && evidence.permissionHash === candidate.permissionHash
    && evidence.secretManifestHash === candidate.secretManifestHash
    && evidence.dependencyHash === candidate.dependencyHash
    && currentEvidence.operationalHash === candidate.operationalHash
    && currentEvidence.permissionHash === candidate.permissionHash
    && currentEvidence.secretManifestHash === candidate.secretManifestHash
    && currentEvidence.dependencyHash === candidate.dependencyHash
  if (!exact) fail('STALE_LIFECYCLE_BINDING', 'workflow, version, or operational evidence is stale')
}

function lifecycleState(workflow) {
  const migrated = migrateGovernanceLifecycle(workflow)
  if (migrated.reviewRequired || migrated.workflow.governance.lifecycle.reviewRequired) fail('LIFECYCLE_REVIEW_REQUIRED', 'legacy lifecycle evidence requires explicit review')
  return migrated.workflow
}

function recordBase(type, request, candidate, now, id) {
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    id,
    type,
    workflowId: candidate.workflowId,
    workflowVersion: candidate.workflowVersion,
    workflowHash: candidate.sourceHash,
    operationalHash: candidate.operationalHash,
    permissionHash: candidate.permissionHash,
    secretManifestHash: candidate.secretManifestHash,
    dependencyHash: candidate.dependencyHash,
    candidateId: candidate.id,
    candidateRecordHash: candidate.recordHash,
    selectedGateResultIds: request.selectedGateResultIds.map(String),
    actor: String(request.actor).slice(0, 80),
    reason: String(request.reason).slice(0, 500),
    createdAt: now,
  }
}

export function emptyLifecycleRecords() {
  return { schemaVersion: LIFECYCLE_SCHEMA_VERSION, approvals: [], consumptions: [], deployments: [], rollbacks: [], workflowStates: {} }
}

export function applyLifecycleTransition({ workflow: input, candidate, versionWorkflow, request, records = emptyLifecycleRecords(), verifySelectedEvidence = () => true, now = Date.now(), idFactory = prefix => `${prefix}-${crypto.randomUUID()}` } = {}) {
  const action = validateRequest(request)
  const workflow = lifecycleState(input)
  assertExact({ workflow, candidate, versionWorkflow, request })
  const environment = normalizeWorkflowEnvironment(workflow.environment)
  const lifecycle = { ...workflow.governance.lifecycle }
  const nextRecords = structuredClone(records)
  const setState = state => { workflow.governance = { ...workflow.governance, locked: state !== 'development', lifecycle: { ...lifecycle, state, reviewRequired: false, updatedAt: now } } }
  const expectedState = (environmentName, state) => {
    if (environment !== environmentName || lifecycle.state !== state) fail('FORBIDDEN_LIFECYCLE_TRANSITION', `cannot ${action} from ${environment}/${lifecycle.state}`)
  }

  if (action === 'prepare-testing') {
    expectedState('development', 'development')
    if (candidate.environment !== 'development') fail('CANDIDATE_ENVIRONMENT_MISMATCH', 'Testing preparation requires a Development candidate')
    setState('testing-candidate')
    workflow.governance.lifecycle.testingCandidateId = candidate.id
    workflow.governance.lifecycle.testingGateResultIds = request.selectedGateResultIds.map(String)
  } else if (action === 'approve-testing' || action === 'approve-production') {
    const production = action === 'approve-production'
    expectedState(production ? 'testing' : 'development', production ? 'production-candidate' : 'testing-candidate')
    if (candidate.id !== lifecycle[production ? 'productionCandidateId' : 'testingCandidateId']) fail('STALE_LIFECYCLE_BINDING', 'approval candidate does not match prepared lifecycle candidate')
    if (JSON.stringify(request.selectedGateResultIds.map(String)) !== JSON.stringify(lifecycle[production ? 'productionGateResultIds' : 'testingGateResultIds'] || [])) fail('STALE_LIFECYCLE_EVIDENCE', 'selected gate evidence changed after candidate preparation')
    if (production) verifySelectedEvidence(request.selectedGateResultIds, candidate)
    const approval = immutableRecord({ ...recordBase('approval', request, candidate, now, idFactory('approval')), action, decision: 'approved', scope: production ? 'production' : 'testing' })
    nextRecords.approvals.push(approval)
    setState(production ? 'production-approved' : 'testing-approved')
    workflow.governance.lifecycle[production ? 'productionApprovalId' : 'testingApprovalId'] = approval.id
  } else if (action === 'enter-testing' || action === 'deploy-production') {
    const production = action === 'deploy-production'
    expectedState(production ? 'testing' : 'development', production ? 'production-approved' : 'testing-approved')
    const approvalId = String(request.approvalDecisionId || '')
    const approval = nextRecords.approvals.find(item => item.id === approvalId)
    const expectedApprovalId = lifecycle[production ? 'productionApprovalId' : 'testingApprovalId']
    if (!approval || approval.id !== expectedApprovalId || approval.candidateId !== candidate.id || approval.scope !== (production ? 'production' : 'testing')) fail('EXACT_APPROVAL_REQUIRED', 'an exact approval decision is required')
    if (JSON.stringify(request.selectedGateResultIds.map(String)) !== JSON.stringify(approval.selectedGateResultIds)) fail('STALE_LIFECYCLE_EVIDENCE', 'selected gate evidence does not match the exact approval')
    if (nextRecords.consumptions.some(item => item.approvalId === approval.id)) fail('APPROVAL_ALREADY_USED', 'approval decision is single-use')
    nextRecords.consumptions.push(immutableRecord({ schemaVersion: LIFECYCLE_SCHEMA_VERSION, id: idFactory('consumption'), type: 'approval-consumption', approvalId: approval.id, action, workflowId: workflow.id, candidateId: candidate.id, actor: String(request.actor).slice(0, 80), reason: String(request.reason).slice(0, 500), createdAt: now }))
    if (production) {
      verifySelectedEvidence(request.selectedGateResultIds, candidate)
      const previousDeploymentId = nextRecords.deployments.filter(item => item.workflowId === workflow.id).at(-1)?.id || null
      const deployment = immutableRecord({ ...recordBase('deployment', request, candidate, now, idFactory('deployment')), approvalId: approval.id, previousDeploymentId })
      nextRecords.deployments.push(deployment)
      workflow.environment = 'production'
      workflow.governance = { ...workflow.governance, status: 'production', locked: true, lifecycle: { ...workflow.governance.lifecycle, state: 'deployed', deploymentId: deployment.id, updatedAt: now } }
    } else {
      workflow.environment = 'testing'
      workflow.governance = { ...workflow.governance, status: 'testing', locked: true, lifecycle: { ...workflow.governance.lifecycle, state: 'testing', updatedAt: now } }
    }
  } else if (action === 'prepare-production') {
    expectedState('testing', 'testing')
    if (candidate.environment !== 'testing') fail('CANDIDATE_ENVIRONMENT_MISMATCH', 'Production preparation requires a Testing candidate')
    verifySelectedEvidence(request.selectedGateResultIds, candidate)
    setState('production-candidate')
    workflow.governance.lifecycle.productionCandidateId = candidate.id
    workflow.governance.lifecycle.productionGateResultIds = request.selectedGateResultIds.map(String)
  } else if (action === 'rollback') {
    expectedState('production', 'deployed')
    const deployment = nextRecords.deployments.find(item => item.id === lifecycle.deploymentId)
    if (!deployment || deployment.candidateId !== candidate.id || String(request.deploymentId || '') !== deployment.id) fail('EXACT_DEPLOYMENT_REQUIRED', 'rollback requires the exact current deployment')
    if (JSON.stringify(request.selectedGateResultIds.map(String)) !== JSON.stringify(deployment.selectedGateResultIds)) fail('STALE_LIFECYCLE_EVIDENCE', 'rollback evidence does not match the exact deployment')
    const rollback = immutableRecord({ ...recordBase('rollback', request, candidate, now, idFactory('rollback')), deploymentId: deployment.id, targetEnvironment: 'testing' })
    nextRecords.rollbacks.push(rollback)
    workflow.environment = 'testing'
    workflow.governance = { ...workflow.governance, status: 'testing', locked: true, lifecycle: { ...workflow.governance.lifecycle, state: 'testing', rollbackId: rollback.id, updatedAt: now } }
  }
  return { workflow, records: nextRecords }
}

export function createLifecycleStore({ file } = {}) {
  const target = path.resolve(file)
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
      if (parsed?.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) fail('LIFECYCLE_STORE_CORRUPT', 'lifecycle record store schema is invalid', 500)
      if (parsed.workflowStates == null) parsed.workflowStates = {}
      if (!parsed.workflowStates || typeof parsed.workflowStates !== 'object' || Array.isArray(parsed.workflowStates)) fail('LIFECYCLE_STORE_CORRUPT', 'lifecycle record workflow states are invalid', 500)
      for (const field of ['approvals', 'consumptions', 'deployments', 'rollbacks']) {
        if (!Array.isArray(parsed[field])) fail('LIFECYCLE_STORE_CORRUPT', `lifecycle record store ${field} is invalid`, 500)
        const ids = new Set()
        for (const item of parsed[field]) {
          const { recordHash, ...body } = item || {}
          if (!SAFE_ID.test(String(item?.id || '')) || ids.has(item.id) || recordHash !== digest(body)) fail('LIFECYCLE_STORE_CORRUPT', `lifecycle record store ${field} failed integrity validation`, 500)
          ids.add(item.id)
        }
      }
      for (const [workflowId, item] of Object.entries(parsed.workflowStates)) {
        const { recordHash, ...body } = item || {}
        if (!SAFE_ID.test(workflowId) || item?.workflowId !== workflowId || recordHash !== digest(body)) fail('LIFECYCLE_STORE_CORRUPT', 'lifecycle workflow state failed integrity validation', 500)
      }
      return parsed
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyLifecycleRecords()
      if (error?.code === 'LIFECYCLE_STORE_CORRUPT') throw error
      fail('LIFECYCLE_STORE_CORRUPT', 'lifecycle record store cannot be read', 500)
    }
  }
  const write = records => { atomicWriteJsonSync(target, records); return structuredClone(records) }
  const commitWorkflowState = (records, workflow) => {
    const next = structuredClone(records)
    next.workflowStates ||= {}
    const body = { schemaVersion: LIFECYCLE_SCHEMA_VERSION, type: 'workflow-state', workflowId: workflow.id, workflow: structuredClone(workflow), updatedAt: workflow.governance?.lifecycle?.updatedAt || Date.now() }
    next.workflowStates[workflow.id] = immutableRecord(body)
    return write(next)
  }
  const reconcileWorkflowFiles = directory => {
    const records = read()
    for (const state of Object.values(records.workflowStates || {})) atomicWriteJsonSync(path.join(directory, `${state.workflowId}.json`), state.workflow)
    return Object.keys(records.workflowStates || {}).length
  }
  return { file: target, read, write, commitWorkflowState, reconcileWorkflowFiles }
}
