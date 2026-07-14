export const AGENT_INSTANCE_SCHEMA_VERSION = 1
export const WORKFLOW_ASSIGNMENT_SCHEMA_VERSION = 1

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)
const clone = value => value == null ? value : structuredClone(value)
const safeId = /^[a-z0-9][a-z0-9_-]{1,79}$/

const requiredId = (value, label) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!safeId.test(normalized)) throw new Error(`${label} has an invalid id`)
  return normalized
}

export function normalizeAgentInstance(input) {
  if (!plain(input)) throw new Error('agent instance must be an object')
  if (input.schemaVersion != null && Number(input.schemaVersion) !== AGENT_INSTANCE_SCHEMA_VERSION) throw new Error('agent instance uses an unsupported schema version')
  const roleCardVersion = Number(input.roleCardVersion)
  if (!Number.isSafeInteger(roleCardVersion) || roleCardVersion < 1) throw new Error('agent instance roleCardVersion must be a positive integer')
  return {
    ...clone(input),
    schemaVersion: AGENT_INSTANCE_SCHEMA_VERSION,
    id: requiredId(input.id, 'agent instance'),
    roleCardId: requiredId(input.roleCardId, 'agent instance role card'),
    roleCardVersion,
    legacyAgentId: input.legacyAgentId == null ? null : String(input.legacyAgentId),
    projectId: input.projectId == null ? null : String(input.projectId),
    currentStatus: String(input.currentStatus || 'available').trim().toLowerCase(),
    runtimeState: plain(input.runtimeState) ? clone(input.runtimeState) : {},
    legacyCompatibility: plain(input.legacyCompatibility) ? clone(input.legacyCompatibility) : {},
    provenance: plain(input.provenance) ? clone(input.provenance) : {},
  }
}

export function normalizeWorkflowAssignment(input) {
  if (!plain(input)) throw new Error('workflow assignment must be an object')
  if (input.schemaVersion != null && Number(input.schemaVersion) !== WORKFLOW_ASSIGNMENT_SCHEMA_VERSION) throw new Error('workflow assignment uses an unsupported schema version')
  const roleCardVersion = Number(input.roleCardVersion)
  if (!Number.isSafeInteger(roleCardVersion) || roleCardVersion < 1) throw new Error('workflow assignment roleCardVersion must be a positive integer')
  const workflowId = String(input.workflowId || '').trim()
  const nodeId = String(input.nodeId || '').trim()
  if (!workflowId || !nodeId) throw new Error('workflow assignment requires workflowId and nodeId')
  if (input.overrides != null && !plain(input.overrides)) throw new Error('workflow assignment overrides must be an object')
  return {
    ...clone(input),
    schemaVersion: WORKFLOW_ASSIGNMENT_SCHEMA_VERSION,
    id: requiredId(input.id, 'workflow assignment'),
    workflowId,
    nodeId,
    agentInstanceId: requiredId(input.agentInstanceId, 'workflow assignment agent instance'),
    roleCardId: requiredId(input.roleCardId, 'workflow assignment role card'),
    roleCardVersion,
    assignmentInstructions: input.assignmentInstructions == null ? null : String(input.assignmentInstructions),
    assignmentScope: clone(input.assignmentScope ?? null),
    overrides: clone(input.overrides ?? {}),
    status: String(input.status || 'active').trim().toLowerCase(),
    provenance: plain(input.provenance) ? clone(input.provenance) : {},
  }
}
