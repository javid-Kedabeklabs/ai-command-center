import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'
import { migrateWorkflowDocument } from './schema.js'
import { listWorkflowVersions, resolvePinnedWorkflowVersion, saveWorkflowVersion, workflowContentHash } from './versions.js'
import { assertWorkflowMutable } from '../governance/mutations.js'

const SAFE_WORKFLOW_ID = /^[a-z0-9_-]+$/i

const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

const workflowFile = (workflowRoot, workflowId) => path.join(workflowRoot, `${workflowId}.json`)

export function isReusableComponent(workflow) {
  return workflow?.metadata?.component?.reusable === true
}

export function markReusableComponent(workflow, { description = '', sourceWorkflowId = null } = {}) {
  return {
    ...workflow,
    metadata: {
      ...(workflow.metadata || {}),
      component: {
        ...(workflow.metadata?.component || {}),
        reusable: true,
        archived: false,
        description: String(description || workflow.metadata?.component?.description || '').slice(0, 500),
        ...(sourceWorkflowId ? { sourceWorkflowId: String(sourceWorkflowId).slice(0, 100) } : {}),
      },
    },
  }
}

export function componentDependencies(workflowRoot, componentId) {
  if (!SAFE_WORKFLOW_ID.test(String(componentId || ''))) return []
  let files = []
  try { files = fs.readdirSync(workflowRoot).filter(file => file.endsWith('.json')) } catch { return [] }
  return files.flatMap(file => {
    const workflow = readJson(path.join(workflowRoot, file))
    if (!workflow || workflow.id === componentId) return []
    const nodeIds = (workflow.nodes || []).filter(node => node?.type === 'subworkflow' && node.data?.workflowId === componentId).map(node => String(node.id))
    return nodeIds.length ? [{ workflowId: String(workflow.id), name: String(workflow.name || workflow.metadata?.name || workflow.id), nodeIds }] : []
  }).sort((left, right) => left.name.localeCompare(right.name) || left.workflowId.localeCompare(right.workflowId))
}

function currentComponentVersion(versionRoot, workflow) {
  const hash = workflowContentHash(workflow)
  const candidate = listWorkflowVersions(versionRoot, workflow.id).find(version => version.hash === hash)
  if (!candidate) return null
  try {
    resolvePinnedWorkflowVersion(versionRoot, workflow.id, candidate.id)
    return candidate
  } catch { return null }
}

export function reusableComponentCatalog(workflowRoot, versionRoot) {
  let files = []
  try { files = fs.readdirSync(workflowRoot).filter(file => file.endsWith('.json')) } catch { return [] }
  return files.map(file => {
    const raw = readJson(path.join(workflowRoot, file))
    if (!isReusableComponent(raw)) return null
    let workflow
    try { workflow = migrateWorkflowDocument(raw) } catch { return null }
    const version = currentComponentVersion(versionRoot, raw)
    const archived = workflow.metadata.component.archived === true
    return {
      id: workflow.id,
      name: workflow.name,
      description: String(workflow.metadata.component.description || '').slice(0, 500),
      nodeCount: workflow.nodes.length,
      currentVersionId: version?.id || null,
      currentVersionHash: version?.hash || null,
      available: !archived && Boolean(version),
      archived,
      unavailableReason: archived ? 'Archived' : version ? null : 'Current saved snapshot is unavailable',
    }
  }).filter(Boolean).sort((left, right) => Number(left.archived) - Number(right.archived) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

function loadReusableComponent(workflowRoot, componentId) {
  if (!SAFE_WORKFLOW_ID.test(String(componentId || ''))) throw Object.assign(new Error('invalid component id'), { code: 'INVALID_COMPONENT_ID' })
  const raw = readJson(workflowFile(workflowRoot, componentId))
  if (!raw) throw Object.assign(new Error('reusable component not found'), { code: 'COMPONENT_NOT_FOUND' })
  if (!isReusableComponent(raw)) throw Object.assign(new Error('workflow is not a reusable component'), { code: 'NOT_REUSABLE_COMPONENT' })
  try { assertWorkflowMutable({ existing: raw, operation: 'changing component metadata' }) }
  catch (error) { throw Object.assign(error, { code: error.code === 'GOVERNANCE_LOCKED' ? 'COMPONENT_LOCKED' : error.code }) }
  return raw
}

function persistComponent(workflowRoot, versionRoot, workflow) {
  const pins = componentDependencies(workflowRoot, workflow.id).flatMap(dependency => {
    const parent = readJson(workflowFile(workflowRoot, dependency.workflowId))
    return (parent?.nodes || []).filter(node => node?.type === 'subworkflow' && node.data?.workflowId === workflow.id && node.data?.workflowVersion).map(node => String(node.data.workflowVersion))
  })
  const version = saveWorkflowVersion(versionRoot, workflow, { preserveIds: pins })
  atomicWriteJsonSync(workflowFile(workflowRoot, workflow.id), workflow)
  return { workflow, version }
}

export function renameReusableComponent(workflowRoot, versionRoot, componentId, { name, description } = {}) {
  const raw = loadReusableComponent(workflowRoot, componentId)
  const nextName = String(name || '').trim()
  if (!nextName) throw Object.assign(new Error('component name required'), { code: 'COMPONENT_NAME_REQUIRED' })
  const workflow = {
    ...raw,
    name: nextName.slice(0, 100),
    metadata: {
      ...(raw.metadata || {}),
      name: nextName.slice(0, 100),
      component: {
        ...raw.metadata.component,
        ...(description === undefined ? {} : { description: String(description).slice(0, 500) }),
        updatedAt: Date.now(),
      },
    },
  }
  return persistComponent(workflowRoot, versionRoot, workflow)
}

export function archiveReusableComponent(workflowRoot, versionRoot, componentId) {
  const raw = loadReusableComponent(workflowRoot, componentId)
  const dependencies = componentDependencies(workflowRoot, componentId)
  if (dependencies.length) {
    const error = new Error(`component is referenced by ${dependencies.map(item => item.name).join(', ')}; review those parent workflows before archiving`)
    error.code = 'COMPONENT_IN_USE'
    error.dependencies = dependencies
    throw error
  }
  const workflow = {
    ...raw,
    metadata: {
      ...(raw.metadata || {}),
      component: { ...raw.metadata.component, archived: true, archivedAt: Date.now() },
    },
  }
  return persistComponent(workflowRoot, versionRoot, workflow)
}
