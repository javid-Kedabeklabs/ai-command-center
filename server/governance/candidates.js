import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'

const SAFE_ID = /^[a-z0-9_.-]+$/i
const CANDIDATE_SCHEMA_VERSION = 1

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

function selectedNodeDependencies(nodes = []) {
  return nodes.map(node => ({
    id: node.id,
    type: node.type,
    definitionVersion: node.definitionVersion || 1,
    workflowId: node.data?.workflowId || null,
    workflowVersion: node.data?.workflowVersion || null,
    customNodeId: node.data?.customNodeId || node.data?.definitionId || null,
    customNodeVersion: node.data?.customNodeVersion || node.data?.definitionVersion || null,
    pluginId: node.data?.pluginId || null,
    pluginVersion: node.data?.pluginVersion || null,
    dependencies: node.data?.dependencies || null,
  }))
}

export function operationalWorkflowProjection(workflow) {
  return {
    schemaVersion: workflow.schemaVersion,
    nodes: workflow.nodes || [],
    edges: workflow.edges || [],
    groups: workflow.groups || [],
    variables: workflow.variables || {},
    settings: workflow.settings || {},
    permissions: workflow.permissions || {},
    secretReferences: workflow.secretReferences || [],
    triggers: workflow.triggers || [],
    evaluations: workflow.evaluations || [],
  }
}

export function workflowOperationalEvidence(workflow) {
  const projection = operationalWorkflowProjection(workflow)
  return {
    operationalHash: digest(projection),
    permissionHash: digest(projection.permissions),
    secretManifestHash: digest(projection.secretReferences),
    dependencyHash: digest(selectedNodeDependencies(projection.nodes)),
  }
}

export function createCandidateRecord({ id, workflow, workflowVersion, sourceHash, environment = 'development', by = 'owner', now = Date.now() } = {}) {
  const candidateId = String(id || '')
  if (!SAFE_ID.test(candidateId)) throw Object.assign(new Error('candidate requires a safe id'), { code: 'INVALID_CANDIDATE_ID', status: 400 })
  if (!workflow?.id || !SAFE_ID.test(String(workflow.id)) || !SAFE_ID.test(String(workflowVersion || ''))) throw Object.assign(new Error('candidate requires an exact workflow version'), { code: 'INVALID_CANDIDATE_VERSION', status: 400 })
  if (!/^[a-f0-9]{12}$/.test(String(sourceHash || ''))) throw Object.assign(new Error('candidate requires an exact workflow source hash'), { code: 'INVALID_CANDIDATE_SOURCE_HASH', status: 400 })
  if (!['development', 'testing'].includes(environment)) throw Object.assign(new Error('candidate environment must be Development or Testing'), { code: 'INVALID_CANDIDATE_ENVIRONMENT', status: 400 })
  const evidence = workflowOperationalEvidence(workflow)
  const record = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    id: candidateId,
    workflowId: String(workflow.id),
    workflowVersion: String(workflowVersion),
    sourceHash: String(sourceHash || ''),
    ...evidence,
    environment,
    status: 'prepared',
    createdBy: String(by || 'owner').slice(0, 80),
    createdAt: now,
  }
  return Object.freeze({ ...record, recordHash: digest(record) })
}

export function createCandidateStore({ file } = {}) {
  const target = path.resolve(file)
  const list = () => {
    try {
      const value = JSON.parse(fs.readFileSync(target, 'utf8'))
      return Array.isArray(value) ? value.filter(item => {
        const { recordHash, ...record } = item || {}
        return typeof recordHash === 'string' && recordHash === digest(record)
      }) : []
    } catch { return [] }
  }
  const find = id => list().find(item => item.id === id) || null
  const add = record => {
    const records = list()
    if (records.some(item => item.id === record.id)) throw Object.assign(new Error('candidate id already exists'), { code: 'CANDIDATE_EXISTS', status: 409 })
    records.unshift(structuredClone(record))
    atomicWriteJsonSync(target, records.slice(0, 500))
    return structuredClone(record)
  }
  return { list, find, add, file: target }
}
