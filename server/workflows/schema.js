export const CURRENT_WORKFLOW_SCHEMA_VERSION = 2

import { normalizeWorkflowGroups } from './groups.js'
import { normalizeWorkflowComments } from './comments.js'
import { normalizeWorkflowTriggers } from '../triggers/schema.js'
import { normalizeSecretReferenceId } from '../secrets/keychain.js'

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const SECRET_PURPOSES = new Set(['provider', 'http', 'mcp', 'plugin', 'generic'])
const SECRET_REFERENCE_FIELDS = new Set(['id', 'referenceId', 'purpose', 'revision', 'label'])

export function normalizeWorkflowSecretReferences(value) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('workflow secretReferences must be an array')
  const seen = new Set()
  return value.map((item, index) => {
    const source = typeof item === 'string' ? { id: item } : item
    if (!plain(source)) throw new Error(`secretReferences[${index}] must be an opaque id or metadata object`)
    const unsupported = Object.keys(source).filter(field => !SECRET_REFERENCE_FIELDS.has(field))
    if (unsupported.length) throw new Error(`secretReferences[${index}] contains unsupported or inline credential fields: ${unsupported.join(', ')}`)
    const id = normalizeSecretReferenceId(source.id || source.referenceId)
    if (seen.has(id)) throw new Error(`duplicate secret reference: ${id}`)
    seen.add(id)
    const purpose = String(source.purpose || 'generic').toLowerCase()
    if (!SECRET_PURPOSES.has(purpose)) throw new Error(`secret reference ${id} has an unsupported purpose`)
    const revision = source.revision == null ? undefined : Math.max(1, Math.floor(Number(source.revision) || 0))
    if (source.revision != null && !revision) throw new Error(`secret reference ${id} has an invalid revision`)
    return { id, purpose, ...(revision ? { revision } : {}), ...(source.label ? { label: String(source.label).slice(0, 120) } : {}) }
  })
}

function mergeObject(existing, incoming) {
  if (!plain(existing) || !plain(incoming)) return incoming
  const out = { ...existing }
  for (const [key, value] of Object.entries(incoming)) out[key] = plain(value) && plain(existing[key]) ? mergeObject(existing[key], value) : value
  return out
}

function mergeById(existing = [], incoming = []) {
  const previous = new Map((Array.isArray(existing) ? existing : []).filter(x => x?.id).map(x => [x.id, x]))
  return (Array.isArray(incoming) ? incoming : []).map(item => item?.id && previous.has(item.id) ? mergeObject(previous.get(item.id), item) : item)
}

export function mergeWorkflowDocuments(existing, incoming) {
  if (!plain(existing)) return incoming
  const merged = mergeObject(existing, incoming)
  if (Array.isArray(incoming.nodes)) merged.nodes = mergeById(existing.nodes, incoming.nodes)
  if (Array.isArray(incoming.edges)) merged.edges = mergeById(existing.edges, incoming.edges)
  if (Array.isArray(incoming.groups)) merged.groups = mergeById(existing.groups, incoming.groups)
  if (Array.isArray(incoming.comments)) merged.comments = mergeById(existing.comments, incoming.comments)
  // Trigger configuration has a narrow server-owned mutation path. An ordinary
  // canvas save may be based on an older document and must never erase or
  // overwrite a newer schedule/webhook definition.
  if (Array.isArray(existing.triggers)) merged.triggers = existing.triggers
  return merged
}

function normalizeNode(node, index) {
  const data = plain(node?.data) ? node.data : plain(node?.config) ? node.config : {}
  return {
    ...node,
    id: String(node?.id || `node-${index + 1}`),
    type: String(node?.type || 'agent'),
    position: plain(node?.position) ? { x: Number(node.position.x) || 0, y: Number(node.position.y) || 0 } : { x: 0, y: 0 },
    data,
    definitionVersion: Number(node?.definitionVersion) || 1,
  }
}

function normalizeEdge(edge, index) {
  return {
    ...edge,
    id: String(edge?.id || `edge-${index + 1}`),
    source: String(edge?.source || ''),
    target: String(edge?.target || ''),
    sourceHandle: edge?.sourceHandle || edge?.sourcePort || undefined,
    targetHandle: edge?.targetHandle || edge?.targetPort || undefined,
    data: plain(edge?.data) ? edge.data : {},
  }
}

export function migrateWorkflowDocument(input) {
  if (!plain(input)) throw new Error('workflow body required')
  const sourceVersion = Number(input.schemaVersion || 1)
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) throw new Error('invalid workflow schema version')
  if (sourceVersion > CURRENT_WORKFLOW_SCHEMA_VERSION) {
    const error = new Error(`workflow schema ${sourceVersion} is newer than supported schema ${CURRENT_WORKFLOW_SCHEMA_VERSION}`)
    error.code = 'FUTURE_WORKFLOW_SCHEMA'
    throw error
  }

  // Schema v2 is additive: legacy root fields remain readable aliases so the
  // existing UI/runtime can migrate incrementally without losing information.
  const metadata = {
    ...(plain(input.metadata) ? input.metadata : {}),
    name: String(input.name || input.metadata?.name || 'Untitled Workflow'),
    project: String(input.project || input.metadata?.project || 'Command Center'),
  }
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).map(normalizeNode)
  const groups = normalizeWorkflowGroups(input.groups, nodes)
  const groupForNode = new Map()
  for (const group of groups) for (const nodeId of group.nodeIds) if (!groupForNode.has(nodeId)) groupForNode.set(nodeId, group.id)
  const normalizedNodes = nodes.map(node => node.groupId || !groupForNode.has(node.id) ? node : { ...node, groupId: groupForNode.get(node.id) })
  return {
    ...input,
    schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
    name: metadata.name,
    project: metadata.project,
    metadata,
    environment: String(input.environment || 'development'),
    nodes: normalizedNodes,
    edges: (Array.isArray(input.edges) ? input.edges : []).map(normalizeEdge),
    groups,
    comments: normalizeWorkflowComments(input.comments),
    variables: plain(input.variables) ? input.variables : {},
    secretReferences: normalizeWorkflowSecretReferences(input.secretReferences),
    triggers: normalizeWorkflowTriggers(input.triggers, input.id),
    evaluations: Array.isArray(input.evaluations) ? input.evaluations : [],
    settings: plain(input.settings) ? input.settings : {},
    governance: plain(input.governance) ? input.governance : { status: 'draft', locked: false },
  }
}

export function workflowSchemaSummary(workflow) {
  return {
    schemaVersion: workflow.schemaVersion,
    nodes: workflow.nodes?.length || 0,
    edges: workflow.edges?.length || 0,
    groups: workflow.groups?.length || 0,
    comments: workflow.comments?.length || 0,
    environment: workflow.environment,
  }
}
