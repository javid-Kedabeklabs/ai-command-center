import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'
import { normalizeRoleCard } from './role-card-schema.js'
import { normalizeAgentInstance, normalizeWorkflowAssignment } from './instance-schema.js'
import { buildLegacyMigrationArtifacts, previewLegacyAgentMigration } from './migration-preview.js'
import { resolveRoleCard } from './resolver.js'

export const AGENT_ARCHITECTURE_SCHEMA_VERSION = 1
const clone = value => value == null ? value : structuredClone(value)
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const defaultState = () => ({ schemaVersion: AGENT_ARCHITECTURE_SCHEMA_VERSION, revision: 0, roleCards: {}, instructionProfiles: {}, agentInstances: {}, workflowAssignments: {}, migrationReceipts: [] })

function validateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('agent architecture store must be an object')
  if (Number(input.schemaVersion) !== AGENT_ARCHITECTURE_SCHEMA_VERSION) throw new Error('agent architecture store uses an unsupported schema version')
  if (!Number.isSafeInteger(Number(input.revision)) || Number(input.revision) < 0) throw new Error('agent architecture store revision is invalid')
  for (const field of ['roleCards', 'instructionProfiles', 'agentInstances', 'workflowAssignments']) if (!input[field] || typeof input[field] !== 'object' || Array.isArray(input[field])) throw new Error(`agent architecture store ${field} is invalid`)
  if (!Array.isArray(input.migrationReceipts)) throw new Error('agent architecture migration receipts are invalid')
  for (const [key, roleCard] of Object.entries(input.roleCards)) {
    if (`${roleCard.id}@${roleCard.version}` !== key) throw new Error('agent architecture role-card key is inconsistent')
    normalizeRoleCard(roleCard)
  }
  for (const [key, instance] of Object.entries(input.agentInstances)) if (normalizeAgentInstance(instance).id !== key) throw new Error('agent architecture instance key is inconsistent')
  for (const [key, assignment] of Object.entries(input.workflowAssignments)) if (normalizeWorkflowAssignment(assignment).id !== key) throw new Error('agent architecture assignment key is inconsistent')
  return clone(input)
}

export function createAgentArchitectureStore(file) {
  const target = path.resolve(file)
  const read = () => {
    if (!fs.existsSync(target)) return defaultState()
    let parsed
    try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')) } catch (error) { throw new Error(`agent architecture store is corrupt: ${error.message}`) }
    return validateState(parsed)
  }
  const write = state => { const normalized = validateState(state); atomicWriteJsonSync(target, normalized); return clone(normalized) }
  const mutate = (expectedRevision, fn) => {
    const state = read()
    if (Number(expectedRevision) !== state.revision) throw Object.assign(new Error('agent architecture revision conflict'), { code: 'REVISION_CONFLICT', currentRevision: state.revision })
    const next = clone(state); fn(next); next.revision += 1
    return write(next)
  }
  return {
    read,
    preview(legacyAgents) {
      const preview = previewLegacyAgentMigration(legacyAgents)
      return { ...preview, architectureRevision: read().revision, proposals: preview.proposals.map(proposal => ({ ...proposal, legacySnapshotHash: digest(proposal.preservedLegacyConfiguration) })) }
    },
    migrate({ legacyAgents, legacyAgentId, primitiveId = null, expectedLegacyHash, expectedRevision, commandId }) {
      if (!commandId) throw new Error('agent migration requires a commandId')
      const state = read()
      const replay = state.migrationReceipts.find(receipt => receipt.commandId === commandId)
      if (replay) {
        const requestHash = digest({ legacyAgentId, primitiveId, expectedLegacyHash, expectedRevision })
        if (replay.requestHash !== requestHash) throw new Error('agent migration commandId was reused with a different request')
        return { replayed: true, receipt: clone(replay), state }
      }
      const agent = legacyAgents.find(item => item?.id === legacyAgentId)
      if (!agent) throw new Error('legacy agent was not found')
      const actualHash = digest(agent)
      if (actualHash !== expectedLegacyHash) throw new Error('legacy agent changed after migration preview')
      const preview = previewLegacyAgentMigration([agent]).proposals[0]
      const selectedPrimitive = primitiveId || preview.primitiveId
      if (!selectedPrimitive) throw new Error('ambiguous legacy agent requires an explicit primitive decision')
      const artifacts = buildLegacyMigrationArtifacts(agent, selectedPrimitive)
      const roleCard = normalizeRoleCard({ ...artifacts.roleCard, status: 'active' })
      const instance = normalizeAgentInstance(artifacts.agentInstance)
      const roleKey = `${roleCard.id}@${roleCard.version}`
      const requestHash = digest({ legacyAgentId, primitiveId, expectedLegacyHash, expectedRevision })
      const result = mutate(expectedRevision, next => {
        const existingRole = next.roleCards[roleKey]
        const existingInstance = next.agentInstances[instance.id]
        if ((existingRole || existingInstance) && !(existingRole?.status === 'disabled' && existingInstance?.currentStatus === 'legacy-fallback')) throw new Error('legacy agent already has architecture records')
        if (existingRole || existingInstance) {
          const prior = next.migrationReceipts.find(receipt => receipt.action === 'migrate' && receipt.roleCardId === roleCard.id && receipt.roleCardVersion === roleCard.version && receipt.agentInstanceId === instance.id)
          if (!prior || prior.legacySnapshotHash !== actualHash || prior.primitiveId !== selectedPrimitive) throw new Error('rolled-back architecture can only reactivate its exact immutable migration')
        }
        next.roleCards[roleKey] = roleCard
        if (artifacts.instructionProfile) next.instructionProfiles[artifacts.instructionProfile.id] = artifacts.instructionProfile
        next.agentInstances[instance.id] = instance
        const receiptBase = { id: `agent-migration-${crypto.randomUUID()}`, action: 'migrate', commandId, requestHash, legacyAgentId, legacySnapshotHash: actualHash, roleCardId: roleCard.id, roleCardVersion: roleCard.version, agentInstanceId: instance.id, primitiveId: selectedPrimitive, status: 'applied', appliedAt: Date.now(), preservedLegacyConfiguration: clone(agent) }
        next.migrationReceipts.unshift({ ...receiptBase, receiptHash: digest(receiptBase) })
      })
      return { replayed: false, receipt: clone(result.migrationReceipts[0]), state: result }
    },
    rollback({ legacyAgents, legacyAgentId, expectedLegacyHash, expectedRevision, commandId }) {
      if (!commandId) throw new Error('agent migration rollback requires a commandId')
      const state = read()
      const requestHash = digest({ action: 'rollback', legacyAgentId, expectedLegacyHash, expectedRevision })
      const replay = state.migrationReceipts.find(receipt => receipt.commandId === commandId)
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error('agent migration commandId was reused with a different request')
        return { replayed: true, receipt: clone(replay), state }
      }
      const agent = legacyAgents.find(item => item?.id === legacyAgentId)
      if (!agent) throw new Error('legacy agent was not found')
      const actualHash = digest(agent)
      if (actualHash !== expectedLegacyHash) throw new Error('legacy agent changed after rollback preview')
      const applied = state.migrationReceipts.find(receipt => receipt.action === 'migrate' && receipt.legacyAgentId === legacyAgentId && receipt.status === 'applied')
      if (!applied) throw new Error('legacy agent has no applied migration to roll back')
      const result = mutate(expectedRevision, next => {
        const roleKey = `${applied.roleCardId}@${applied.roleCardVersion}`
        const roleCard = next.roleCards[roleKey]
        const instance = next.agentInstances[applied.agentInstanceId]
        if (!roleCard || !instance) throw new Error('migration rollback evidence is incomplete')
        next.roleCards[roleKey] = normalizeRoleCard({ ...roleCard, status: 'disabled' })
        next.agentInstances[applied.agentInstanceId] = normalizeAgentInstance({ ...instance, currentStatus: 'legacy-fallback' })
        for (const [id, assignment] of Object.entries(next.workflowAssignments)) {
          if (assignment.agentInstanceId === applied.agentInstanceId) next.workflowAssignments[id] = normalizeWorkflowAssignment({ ...assignment, status: 'disabled' })
        }
        const receiptBase = { id: `agent-migration-rollback-${crypto.randomUUID()}`, action: 'rollback', commandId, requestHash, legacyAgentId, legacySnapshotHash: actualHash, migratedReceiptHash: applied.receiptHash, roleCardId: applied.roleCardId, roleCardVersion: applied.roleCardVersion, agentInstanceId: applied.agentInstanceId, status: 'rolled-back', appliedAt: Date.now(), preservedLegacyConfiguration: clone(agent) }
        next.migrationReceipts.unshift({ ...receiptBase, receiptHash: digest(receiptBase) })
      })
      return { replayed: false, receipt: clone(result.migrationReceipts[0]), state: result }
    },
    putAssignment(input, expectedRevision) {
      const assignment = normalizeWorkflowAssignment(input)
      return mutate(expectedRevision, next => {
        const instance = next.agentInstances[assignment.agentInstanceId]
        const roleCard = next.roleCards[`${assignment.roleCardId}@${assignment.roleCardVersion}`]
        if (!instance || !roleCard) throw new Error('workflow assignment references unavailable architecture records')
        if (instance.roleCardId !== assignment.roleCardId || instance.roleCardVersion !== assignment.roleCardVersion) throw new Error('workflow assignment role card does not match its agent instance')
        resolveRoleCard(roleCard, { agentInstance: instance, workflowAssignment: assignment })
        next.workflowAssignments[assignment.id] = assignment
      })
    },
    resolveAgent(agentId, assignmentId = null) {
      const state = read(), instance = state.agentInstances[agentId]
      if (!instance || instance.currentStatus === 'legacy-fallback') return null
      const roleCard = state.roleCards[`${instance.roleCardId}@${instance.roleCardVersion}`]
      if (!roleCard) throw new Error('agent instance role card is unavailable')
      const assignment = assignmentId ? state.workflowAssignments[assignmentId] : {}
      if (assignmentId && !assignment) throw new Error('workflow assignment is unavailable')
      return resolveRoleCard(roleCard, { agentInstance: instance, workflowAssignment: assignment })
    },
  }
}
