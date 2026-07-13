import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertOrdinaryWorkflowSave,
  assertWorkflowDelete,
  assertWorkflowImport,
  assertWorkflowMutable,
  assertWorkflowRestore,
  createDevelopmentWorkflowCandidate,
  preserveWorkflowLifecycle,
} from '../server/governance/mutations.js'
import { governanceAuditDetail } from '../server/governance/audit.js'
import { createCandidateRecord } from '../server/governance/candidates.js'
import { applyLifecycleTransition, createLifecycleStore, emptyLifecycleRecords, migrateGovernanceLifecycle } from '../server/governance/lifecycle.js'
import { workflowContentHash } from '../server/workflows/versions.js'

let passed = 0
async function test(name, fn) {
  await fn()
  passed++
  console.log(`  PASS ${name}`)
}

const development = { id: 'fixture', environment: 'development', governance: { status: 'draft', locked: false } }
const production = { id: 'fixture', environment: 'production', governance: { status: 'production', locked: true } }

console.log('== governance mutation boundary ==')
await test('ordinary saves reject the legacy _unlock bypass', () => {
  assert.throws(() => assertOrdinaryWorkflowSave({ input: { ...development, _unlock: true }, existing: production }), error => error.code === 'GOVERNANCE_RESERVED_FIELD' && error.status === 400)
})
await test('new workflows cannot be created outside Development', () => {
  assert.throws(() => assertOrdinaryWorkflowSave({ input: { ...development, environment: 'production' } }), error => error.code === 'GOVERNANCE_ENVIRONMENT_CREATION')
})
await test('ordinary saves cannot change environment', () => {
  assert.throws(() => assertOrdinaryWorkflowSave({ input: { ...development, environment: 'testing' }, existing: development }), error => error.code === 'GOVERNANCE_ENVIRONMENT_TRANSITION')
})
await test('ordinary saves cannot change server-owned lifecycle state', () => {
  assert.throws(() => assertOrdinaryWorkflowSave({ input: { ...development, governance: { status: 'production', locked: false } }, existing: development }), error => error.code === 'GOVERNANCE_LIFECYCLE_FIELD')
})
await test('locked Production saves fail closed without a client escape hatch', () => {
  assert.throws(() => assertOrdinaryWorkflowSave({ input: production, existing: production }), error => error.code === 'GOVERNANCE_LOCKED' && error.status === 423)
  assert.throws(() => assertOrdinaryWorkflowSave({ input: { ...production, governance: { status: 'production', locked: false } }, existing: { ...production, governance: { status: 'production', locked: false } } }), error => error.code === 'GOVERNANCE_LOCKED' && error.status === 423)
})
await test('locked Production delete and restore fail closed', () => {
  assert.throws(() => assertWorkflowDelete({ existing: production }), error => error.code === 'GOVERNANCE_LOCKED')
  assert.throws(() => assertWorkflowRestore({ existing: production, candidate: production }), error => error.code === 'GOVERNANCE_LOCKED')
})
await test('all alternate mutations reject Production even when a legacy lock is missing', () => {
  const legacyProduction = { ...production, governance: { status: 'review-required', locked: false } }
  assert.throws(() => assertWorkflowMutable({ existing: legacyProduction, operation: 'trigger update' }), error => error.code === 'GOVERNANCE_LOCKED')
  assert.throws(() => assertWorkflowImport({ input: development, existing: legacyProduction }), error => error.code === 'GOVERNANCE_LOCKED')
})
await test('imports reject reserved fields and unsafe workflow identities', () => {
  assert.throws(() => assertWorkflowImport({ input: { ...development, _unlock: true } }), error => error.code === 'GOVERNANCE_RESERVED_FIELD')
  assert.throws(() => assertWorkflowImport({ input: { ...development, id: '../../escape' } }), error => error.code === 'GOVERNANCE_INVALID_WORKFLOW_ID')
})
await test('learning adoption creates an unlocked Development candidate without mutating its source', () => {
  const source = { ...production, _unlock: true, settings: { retries: 0 }, nodes: [{ id: 'code', data: { locked: true, codeMode: 'locked' } }] }
  const candidate = createDevelopmentWorkflowCandidate(source, { id: 'fixture-learning-1', settings: { retries: 2 }, status: 'learning-candidate', provenance: { sourceWorkflowId: source.id }, now: 10 })
  assert.equal(candidate.environment, 'development')
  assert.equal(candidate.governance.locked, false)
  assert.equal(candidate.governance.status, 'learning-candidate')
  assert.equal(candidate.settings.retries, 2)
  assert.equal(candidate.nodes[0].data.locked, false)
  assert.equal(candidate._unlock, undefined)
  assert.equal(source.environment, 'production')
  assert.equal(source.settings.retries, 0)
})
await test('restore cannot cross environments or recreate a locked candidate', () => {
  assert.throws(() => assertWorkflowRestore({ existing: null, candidate: development }), error => error.code === 'GOVERNANCE_WORKFLOW_NOT_FOUND' && error.status === 404)
  assert.throws(() => assertWorkflowRestore({ existing: development, candidate: { ...development, environment: 'testing' } }), error => error.code === 'GOVERNANCE_ENVIRONMENT_TRANSITION')
  assert.throws(() => assertWorkflowRestore({ existing: development, candidate: { ...production, environment: 'development' } }), error => error.code === 'GOVERNANCE_LOCKED_CANDIDATE')
})
await test('Development saves preserve lifecycle state and additive safe fields', () => {
  assert.doesNotThrow(() => assertOrdinaryWorkflowSave({ input: { ...development, metadata: { additive: true } }, existing: development }))
  const preserved = preserveWorkflowLifecycle(development, { ...development, metadata: { additive: true }, governance: { status: 'draft', locked: false, promotionGates: { evaluations: ['suite'] } } })
  assert.equal(preserved.metadata.additive, true)
  assert.deepEqual(preserved.governance.promotionGates, { evaluations: ['suite'] })
  assert.equal(preserved.governance.status, 'draft')
})
await test('audit evidence is bounded and does not echo untrusted values', () => {
  const detail = governanceAuditDetail({ operation: 'save', outcome: 'denied', workflowId: 'fixture', code: 'GOVERNANCE_RESERVED_FIELD', environment: 'secret-value-that-must-not-be-logged' })
  assert.deepEqual(detail, { operation: 'save', outcome: 'denied', workflow: 'fixture', code: 'GOVERNANCE_RESERVED_FIELD', environment: null })
})

console.log('== exact environment lifecycle ==')
const lifecycleWorkflow = {
  schemaVersion: 2,
  id: 'lifecycle-fixture',
  name: 'Lifecycle fixture',
  environment: 'development',
  nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'out', type: 'output', data: {} }],
  edges: [{ id: 'edge', source: 'in', target: 'out' }],
  permissions: { network: [] },
  secretReferences: [],
  governance: { status: 'draft', locked: false },
}
const lifecycleVersion = '2026-07-13T00-00-00-000Z-' + workflowContentHash(lifecycleWorkflow)
const developmentCandidate = createCandidateRecord({ id: 'candidate-development', workflow: lifecycleWorkflow, workflowVersion: lifecycleVersion, sourceHash: workflowContentHash(lifecycleWorkflow), environment: 'development', now: 1 })
const exactRequest = (action, candidate, extra = {}) => ({ action, actor: 'owner', reason: `${action} fixture`, expectedWorkflowId: lifecycleWorkflow.id, expectedWorkflowVersion: candidate.workflowVersion, expectedWorkflowHash: candidate.sourceHash, expectedOperationalHash: candidate.operationalHash, selectedGateResultIds: [], ...extra })

await test('legacy ambiguity migrates additively to review-required and legacy-unbound', () => {
  const legacy = { ...lifecycleWorkflow, extension: { preserved: true }, environment: 'production', governance: { status: 'production', locked: false, approvalRecords: [{ id: 'old' }], evaluationHistory: [{ id: 'old-eval', passed: true }] } }
  const migrated = migrateGovernanceLifecycle(legacy)
  assert.equal(migrated.workflow.extension.preserved, true)
  assert.equal(migrated.workflow.governance.lifecycle.state, 'review-required')
  assert.equal(migrated.workflow.governance.locked, true)
  assert.equal(migrated.workflow.governance.approvalRecords[0].bindingStatus, 'legacy-unbound')
  assert.equal(migrated.workflow.governance.evaluationHistory[0].promotable, false)
})

await test('direct Development to Production and stale exact hashes fail closed', () => {
  assert.throws(() => applyLifecycleTransition({ workflow: lifecycleWorkflow, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('prepare-production', developmentCandidate) }), error => error.code === 'FORBIDDEN_LIFECYCLE_TRANSITION')
  assert.throws(() => applyLifecycleTransition({ workflow: lifecycleWorkflow, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('prepare-testing', developmentCandidate, { expectedOperationalHash: 'stale' }) }), error => error.code === 'STALE_LIFECYCLE_BINDING')
})

await test('Testing and Production approvals are exact, selected, and single-use', () => {
  let records = emptyLifecycleRecords(), workflow = lifecycleWorkflow
  let result = applyLifecycleTransition({ workflow, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('prepare-testing', developmentCandidate), records, now: 2, idFactory: prefix => `${prefix}-testing` })
  ;({ workflow, records } = result)
  result = applyLifecycleTransition({ workflow, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('approve-testing', developmentCandidate), records, now: 3, idFactory: prefix => `${prefix}-testing` })
  ;({ workflow, records } = result)
  result = applyLifecycleTransition({ workflow, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('enter-testing', developmentCandidate, { approvalDecisionId: 'approval-testing' }), records, now: 4, idFactory: prefix => `${prefix}-enter` })
  ;({ workflow, records } = result)
  assert.equal(workflow.environment, 'testing')
  assert.throws(() => applyLifecycleTransition({ workflow: { ...workflow, environment: 'development', governance: { ...workflow.governance, lifecycle: { ...workflow.governance.lifecycle, state: 'testing-approved' } } }, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('enter-testing', developmentCandidate, { approvalDecisionId: 'approval-testing' }), records }), error => ['APPROVAL_ALREADY_USED', 'LIFECYCLE_REVIEW_REQUIRED'].includes(error.code))

  const testingVersionWorkflow = structuredClone(workflow)
  const testingVersion = '2026-07-13T00-00-01-000Z-' + workflowContentHash(testingVersionWorkflow)
  const testingCandidate = createCandidateRecord({ id: 'candidate-testing', workflow: testingVersionWorkflow, workflowVersion: testingVersion, sourceHash: workflowContentHash(testingVersionWorkflow), environment: 'testing', now: 5 })
  const testingRequest = (action, extra = {}) => ({ action, actor: 'owner', reason: `${action} fixture`, expectedWorkflowId: workflow.id, expectedWorkflowVersion: testingCandidate.workflowVersion, expectedWorkflowHash: testingCandidate.sourceHash, expectedOperationalHash: testingCandidate.operationalHash, selectedGateResultIds: ['gate-exact'], ...extra })
  const verify = ids => assert.deepEqual(ids, ['gate-exact'])
  result = applyLifecycleTransition({ workflow, candidate: testingCandidate, versionWorkflow: testingVersionWorkflow, request: testingRequest('prepare-production'), records, verifySelectedEvidence: verify, now: 6, idFactory: prefix => `${prefix}-production` })
  ;({ workflow, records } = result)
  result = applyLifecycleTransition({ workflow, candidate: testingCandidate, versionWorkflow: testingVersionWorkflow, request: testingRequest('approve-production'), records, verifySelectedEvidence: verify, now: 7, idFactory: prefix => `${prefix}-production` })
  ;({ workflow, records } = result)
  result = applyLifecycleTransition({ workflow, candidate: testingCandidate, versionWorkflow: testingVersionWorkflow, request: testingRequest('deploy-production', { approvalDecisionId: 'approval-production' }), records, verifySelectedEvidence: verify, now: 8, idFactory: prefix => `${prefix}-deploy` })
  ;({ workflow, records } = result)
  assert.equal(workflow.environment, 'production')
  assert.equal(workflow.governance.locked, true)
  assert.equal(records.deployments.length, 1)
  assert.equal(records.approvals[1].recordHash.length, 64)

  result = applyLifecycleTransition({ workflow, candidate: testingCandidate, versionWorkflow: testingVersionWorkflow, request: testingRequest('rollback', { deploymentId: 'deployment-deploy' }), records, now: 9, idFactory: prefix => `${prefix}-rollback` })
  assert.equal(result.workflow.environment, 'testing')
  assert.equal(result.records.rollbacks.length, 1)
  assert.equal(result.records.deployments[0].recordHash, records.deployments[0].recordHash)
})

await test('append-only lifecycle records survive store restart with immutable hashes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-governance-lifecycle-'))
  try {
    const file = path.join(directory, 'records.json')
    const store = createLifecycleStore({ file })
    const prepared = applyLifecycleTransition({ workflow: lifecycleWorkflow, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('prepare-testing', developmentCandidate), now: 10, idFactory: prefix => `${prefix}-restart` })
    const records = applyLifecycleTransition({ workflow: prepared.workflow, candidate: developmentCandidate, versionWorkflow: lifecycleWorkflow, request: exactRequest('approve-testing', developmentCandidate), records: prepared.records, now: 11, idFactory: prefix => `${prefix}-restart` }).records
    const workflowFile = path.join(directory, `${prepared.workflow.id}.json`)
    const committed = store.commitWorkflowState(records, prepared.workflow)
    assert.deepEqual(createLifecycleStore({ file }).read(), committed)
    fs.writeFileSync(workflowFile, '{"stale":true}')
    assert.equal(createLifecycleStore({ file }).reconcileWorkflowFiles(directory), 1)
    assert.equal(JSON.parse(fs.readFileSync(workflowFile, 'utf8')).governance.lifecycle.state, 'testing-candidate')
    const tampered = structuredClone(createLifecycleStore({ file }).read()); tampered.approvals[0].reason = 'changed after approval'
    fs.writeFileSync(file, JSON.stringify(tampered))
    assert.throws(() => createLifecycleStore({ file }).read(), error => error.code === 'LIFECYCLE_STORE_CORRUPT')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

const base = process.env.CC_URL
if (base) {
  const id = `governance-${crypto.randomUUID().slice(0, 8)}`
  const learningId = `${id}-learning`
  let learningCandidateId = null
  const marker = `audit-secret-${crypto.randomUUID()}`
  const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const request = async (pathname, options = {}) => {
    const response = await fetch(`${base}${pathname}`, options)
    const body = await response.json().catch(() => ({}))
    return { response, body }
  }
  const workflow = {
    id,
    name: 'Governance boundary fixture',
    environment: 'development',
    nodes: [
      { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
      { id: 'out', type: 'output', position: { x: 200, y: 0 }, data: { label: 'Output' } },
    ],
    edges: [],
    governance: { status: 'draft', locked: false },
  }
  const waitRun = async runId => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await request(`/api/runs/${runId}/detail`)
      if (!['running', 'paused'].includes(result.body?.status)) return result.body
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error('learning fixture run timed out')
  }

  try {
    await test('live API enforces the exact Development to Testing to Production lifecycle', async () => {
      let result = await request('/api/workflows', { method: 'POST', ...json(workflow) })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      const versions = await request(`/api/workflows/${id}/versions`)
      assert.equal(versions.response.status, 200)
      assert.ok(versions.body[0]?.id)

      result = await request('/api/workflows', { method: 'POST', ...json({ ...workflow, _unlock: true, metadata: { marker } }) })
      assert.equal(result.response.status, 400)
      assert.equal(result.body.code, 'GOVERNANCE_RESERVED_FIELD')

      result = await request('/api/workflows', { method: 'POST', ...json({ ...workflow, environment: 'production' }) })
      assert.equal(result.response.status, 409)
      assert.equal(result.body.code, 'GOVERNANCE_ENVIRONMENT_TRANSITION')

      result = await request(`/api/workflows/${id}/promote`, { method: 'POST', ...json({ by: 'governance-test', approval: 'fixture approval' }) })
      assert.equal(result.response.status, 409)
      assert.equal(result.body.code, 'LIFECYCLE_ACTION_REQUIRED')

      const makeRequest = (action, candidate, extra = {}) => ({
        action,
        actor: 'governance-test',
        reason: `${action} fixture`,
        candidateId: candidate.id,
        expectedWorkflowId: id,
        expectedWorkflowVersion: candidate.workflowVersion,
        expectedWorkflowHash: candidate.sourceHash,
        expectedOperationalHash: candidate.operationalHash,
        selectedGateResultIds: [],
        ...extra,
      })
      const developmentCandidateResult = await request(`/api/workflows/${id}/candidates`, { method: 'POST', ...json({ by: 'governance-test' }) })
      assert.equal(developmentCandidateResult.response.status, 201, JSON.stringify(developmentCandidateResult.body))
      const developmentCandidate = developmentCandidateResult.body
      for (const action of ['prepare-testing', 'approve-testing']) {
        result = await request(`/api/workflows/${id}/lifecycle`, { method: 'POST', ...json(makeRequest(action, developmentCandidate)) })
        assert.equal(result.response.status, 200, JSON.stringify(result.body))
      }
      const testingApprovalId = result.body.lifecycle.testingApprovalId
      result = await request(`/api/workflows/${id}/lifecycle`, { method: 'POST', ...json(makeRequest('enter-testing', developmentCandidate, { approvalDecisionId: testingApprovalId })) })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.environment, 'testing')
      const replay = await request(`/api/workflows/${id}/lifecycle`, { method: 'POST', ...json(makeRequest('enter-testing', developmentCandidate, { approvalDecisionId: testingApprovalId })) })
      assert.equal(replay.response.status, 409)

      const testingCandidateResult = await request(`/api/workflows/${id}/candidates`, { method: 'POST', ...json({ by: 'governance-test' }) })
      assert.equal(testingCandidateResult.response.status, 201, JSON.stringify(testingCandidateResult.body))
      const testingCandidate = testingCandidateResult.body
      for (const action of ['prepare-production', 'approve-production']) {
        result = await request(`/api/workflows/${id}/lifecycle`, { method: 'POST', ...json(makeRequest(action, testingCandidate)) })
        assert.equal(result.response.status, 200, JSON.stringify(result.body))
      }
      const productionApprovalId = result.body.lifecycle.productionApprovalId
      result = await request(`/api/workflows/${id}/lifecycle`, { method: 'POST', ...json(makeRequest('deploy-production', testingCandidate, { approvalDecisionId: productionApprovalId })) })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.environment, 'production')
      assert.equal(result.body.workflow.governance.locked, true)
      const deploymentId = result.body.lifecycle.deploymentId

      result = await request(`/api/workflows/${id}`, { method: 'DELETE' })
      assert.equal(result.response.status, 423)
      assert.equal(result.body.code, 'GOVERNANCE_LOCKED')

      result = await request(`/api/workflows/${id}/versions/${versions.body[0].id}/restore`, { method: 'POST' })
      assert.equal(result.response.status, 423)
      assert.equal(result.body.code, 'GOVERNANCE_LOCKED')

      result = await request(`/api/workflows/${id}/lifecycle`, { method: 'POST', ...json(makeRequest('rollback', testingCandidate, { deploymentId })) })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.environment, 'testing')

      const audit = await request('/api/audit')
      assert.equal(audit.response.status, 200)
      const serialized = JSON.stringify(audit.body)
      assert.ok(serialized.includes('GOVERNANCE_RESERVED_FIELD'))
      assert.ok(!serialized.includes(marker), 'audit log echoed a value from the denied request')
    })
    await test('live learning approval creates a Development candidate instead of mutating its source', async () => {
      const learningWorkflow = {
        ...workflow,
        id: learningId,
        name: 'Learning source fixture',
        settings: { retries: 0 },
        nodes: [
          { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
          { id: 'fail', type: 'shell', position: { x: 200, y: 0 }, data: { label: 'Fail', command: 'exit 7' } },
          { id: 'out', type: 'output', position: { x: 400, y: 0 }, data: { label: 'Output' } },
        ],
        edges: [{ id: 'a', source: 'in', target: 'fail' }, { id: 'b', source: 'fail', target: 'out' }],
      }
      let result = await request('/api/workflows', { method: 'POST', ...json(learningWorkflow) })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      for (let index = 0; index < 2; index++) {
        const started = await request(`/api/workflows/${learningId}/run`, { method: 'POST', ...json({ input: 'fixture' }) })
        assert.equal(started.response.status, 200, JSON.stringify(started.body))
        const run = await waitRun(started.body.runId)
        assert.equal(run.status, 'failed')
      }
      const analyzed = await request('/api/learning/analyze', { method: 'POST', ...json({ workflowId: learningId }) })
      const proposal = analyzed.body.find(item => item.kind === 'retry-policy')
      assert.ok(proposal?.id, JSON.stringify(analyzed.body))
      result = await request(`/api/learning/proposals/${proposal.id}/decision`, { method: 'POST', ...json({ decision: 'approved' }) })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      learningCandidateId = result.body.candidateWorkflowId
      assert.ok(learningCandidateId)
      const [source, candidate] = await Promise.all([request(`/api/workflows/${learningId}`), request(`/api/workflows/${learningCandidateId}`)])
      assert.equal(source.body.settings.retries, 0)
      assert.equal(candidate.body.settings.retries, 2)
      assert.equal(candidate.body.environment, 'development')
      assert.equal(candidate.body.governance.status, 'learning-candidate')
      assert.equal(result.body.applied, false)
      const replay = await request(`/api/learning/proposals/${proposal.id}/decision`, { method: 'POST', ...json({ decision: 'approved' }) })
      assert.equal(replay.response.status, 409)
    })
  } finally {
    await request(`/api/workflows/${id}`, { method: 'DELETE' })
    if (learningCandidateId) await request(`/api/workflows/${learningCandidateId}`, { method: 'DELETE' })
    await request(`/api/workflows/${learningId}`, { method: 'DELETE' })
  }
}

console.log(`governance lifecycle tests: ${passed} passed`)
