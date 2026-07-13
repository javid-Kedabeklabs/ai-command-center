import { DEFAULT_AGENT_PRIMITIVES, primitiveById } from './primitive-schema.js'
import { normalizeRoleCard } from './role-card-schema.js'

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)

function choose(base, overrides, key) {
  return Object.prototype.hasOwnProperty.call(overrides, key) ? clone(overrides[key]) : clone(base[key])
}

export function resolveRoleCard(roleCardInput, { primitives = DEFAULT_AGENT_PRIMITIVES, agentInstance = {}, workflowAssignment = {}, overrides = {} } = {}) {
  if (!plain(agentInstance) || !plain(workflowAssignment) || !plain(overrides)) throw new Error('role resolution context must use objects')
  const primitiveIds = new Set(primitives.map(value => value.id))
  const roleCard = normalizeRoleCard(roleCardInput, { primitiveIds })
  const primitive = primitiveById(roleCard.primitiveId, primitives)
  if (agentInstance.roleCardId && agentInstance.roleCardId !== roleCard.id) throw new Error('agent instance references a different roleCardId')
  if (agentInstance.roleCardVersion && Number(agentInstance.roleCardVersion) !== roleCard.version) throw new Error('agent instance references a different role card version')
  if (workflowAssignment.roleCardId && workflowAssignment.roleCardId !== roleCard.id) throw new Error('workflow assignment references a different roleCardId')
  if (workflowAssignment.agentInstanceId && agentInstance.id && workflowAssignment.agentInstanceId !== agentInstance.id) throw new Error('workflow assignment references a different agent instance')
  const assignmentOverrides = workflowAssignment.overrides ?? {}
  if (!plain(assignmentOverrides)) throw new Error('workflow assignment overrides must be an object')
  const effectiveOverrides = { ...clone(assignmentOverrides), ...clone(overrides) }
  const allowedOverrides = new Set(['instructionProfile', 'modelPolicy', 'assignmentScope', 'skills', 'tools', 'knowledgeScopes', 'memoryScopes', 'permissionProfileId', 'rubric'])
  const unknownOverrides = Object.keys(effectiveOverrides).filter(key => !allowedOverrides.has(key))
  if (unknownOverrides.length) throw new Error(`unsupported role-card overrides: ${unknownOverrides.join(', ')}`)
  const runtime = {
    primitiveId: primitive.id,
    primitiveVersion: primitive.version,
    roleCardId: roleCard.id,
    roleCardVersion: roleCard.version,
    agentInstanceId: agentInstance.id == null ? null : String(agentInstance.id),
    displayName: roleCard.displayName,
    departmentId: roleCard.departmentId,
    organizationalClass: roleCard.organizationalClass,
    mode: roleCard.mode,
    instructionProfile: choose(roleCard, effectiveOverrides, 'instructionProfile'),
    modelPolicy: choose(roleCard, effectiveOverrides, 'modelPolicy'),
    assignmentScope: choose(roleCard, effectiveOverrides, 'assignmentScope'),
    skills: choose(roleCard, effectiveOverrides, 'skills'),
    tools: choose(roleCard, effectiveOverrides, 'tools'),
    knowledgeScopes: choose(roleCard, effectiveOverrides, 'knowledgeScopes'),
    memoryScopes: choose(roleCard, effectiveOverrides, 'memoryScopes'),
    permissionProfileId: choose(roleCard, effectiveOverrides, 'permissionProfileId'),
    rubric: choose(roleCard, effectiveOverrides, 'rubric'),
    uiIdentity: clone(roleCard.uiIdentity),
    companyWorldProfile: clone(roleCard.companyWorldProfile),
    capabilityContract: clone(primitive.capabilityContract),
    runtimePolicy: clone(primitive.defaultRuntimePolicy),
    assignment: {
      nodeId: workflowAssignment.nodeId == null ? null : String(workflowAssignment.nodeId),
      instructions: clone(workflowAssignment.assignmentInstructions ?? null),
      scope: clone(workflowAssignment.assignmentScope ?? null),
      overrides: clone(effectiveOverrides),
    },
    instanceState: clone(agentInstance.runtimeState ?? {}),
  }
  return clone(runtime)
}
