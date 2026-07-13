import { DEFAULT_RESOURCE_POLICY, normalizeResourcePolicy } from './resources.js'

export const MAX_SUBWORKFLOW_DEPTH = 8

export const WORKFLOW_CAPABILITIES = Object.freeze([
  'execute-code',
  'execute-shell',
  'read-files',
  'write-files',
  'network',
  'tools',
])

const plain = value => value && typeof value === 'object' && !Array.isArray(value)

function permissionKeys(...policies) {
  return [...new Set([
    ...WORKFLOW_CAPABILITIES,
    ...policies.flatMap(policy => plain(policy) ? Object.keys(policy) : []),
  ])]
}

export function intersectPermissionCeilings(...policies) {
  const result = {}
  for (const capability of permissionKeys(...policies)) {
    if (policies.some(policy => plain(policy) && policy[capability] === false)) result[capability] = false
  }
  return result
}

export function intersectResourceCeilings(...policies) {
  const normalized = policies.filter(plain).map(normalizeResourcePolicy)
  if (!normalized.length) return { ...DEFAULT_RESOURCE_POLICY }
  return Object.fromEntries(Object.keys(DEFAULT_RESOURCE_POLICY).map(field => [
    field,
    Math.min(...normalized.map(policy => policy[field])),
  ]))
}

export function parseInheritedExecutionContext(raw, legacyStack = []) {
  const source = plain(raw) ? raw : {}
  const stackSource = Array.isArray(source.stack) ? source.stack : legacyStack
  return {
    resources: plain(source.resources) ? normalizeResourcePolicy(source.resources) : null,
    permissions: plain(source.permissions) ? intersectPermissionCeilings(source.permissions) : {},
    localOnly: source.localOnly === true,
    stack: stackSource.map(String).filter(Boolean).slice(0, MAX_SUBWORKFLOW_DEPTH + 1),
    parentRunId: typeof source.parentRunId === 'string' ? source.parentRunId.slice(0, 160) : null,
    parentNodeId: typeof source.parentNodeId === 'string' ? source.parentNodeId.slice(0, 160) : null,
  }
}

export function effectiveExecutionContext({ inherited, workflow, runId = null } = {}) {
  const parent = parseInheritedExecutionContext(inherited)
  return {
    resources: intersectResourceCeilings(parent.resources, workflow?.settings?.resources),
    permissions: intersectPermissionCeilings(parent.permissions, workflow?.permissions),
    localOnly: parent.localOnly || workflow?.settings?.localOnly === true,
    stack: [...parent.stack],
    depth: parent.stack.length,
    parentRunId: parent.parentRunId,
    parentNodeId: parent.parentNodeId,
    runId,
  }
}

export function childExecutionContext({ parent, workflowId, parentRunId, parentNode } = {}) {
  const stack = [...(parent?.stack || []), String(workflowId || '')].filter(Boolean)
  if (stack.length > MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`subworkflow depth limit ${MAX_SUBWORKFLOW_DEPTH} exceeded at ${parentNode?.id || 'unknown node'}`)
  }
  return {
    resources: intersectResourceCeilings(parent?.resources, parentNode?.runtime?.resources, parentNode?.data?.runtime?.resources),
    permissions: intersectPermissionCeilings(parent?.permissions, parentNode?.permissions, parentNode?.data?.permissions),
    localOnly: parent?.localOnly === true,
    stack,
    parentRunId: String(parentRunId || '').slice(0, 160) || null,
    parentNodeId: String(parentNode?.id || '').slice(0, 160) || null,
  }
}

export function executionPolicyEvidence(context) {
  const permissions = plain(context?.permissions) ? context.permissions : {}
  return {
    resources: intersectResourceCeilings(context?.resources),
    deniedPermissions: Object.keys(permissions).filter(key => permissions[key] === false).sort(),
    localOnly: context?.localOnly === true,
    depth: Number(context?.depth ?? context?.stack?.length) || 0,
    stack: Array.isArray(context?.stack) ? context.stack.map(String).slice(0, MAX_SUBWORKFLOW_DEPTH) : [],
    parentRunId: context?.parentRunId || null,
    parentNodeId: context?.parentNodeId || null,
  }
}

export function executionContextFromEvidence(evidence) {
  const source = plain(evidence) ? evidence : {}
  const deniedPermissions = Array.isArray(source.deniedPermissions)
    ? Object.fromEntries(source.deniedPermissions.map(capability => [String(capability), false]))
    : {}
  return parseInheritedExecutionContext({
    resources: source.resources,
    permissions: deniedPermissions,
    localOnly: source.localOnly,
    stack: source.stack,
    parentRunId: source.parentRunId,
    parentNodeId: source.parentNodeId,
  })
}
