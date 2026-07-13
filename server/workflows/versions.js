import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'

const SAFE_WORKFLOW_ID = /^[a-z0-9_-]+$/i
const SAFE_VERSION_ID = /^[a-z0-9_.-]+$/i

const serializedWorkflow = workflow => JSON.stringify(workflow, null, 2)
export const workflowContentHash = workflow => crypto.createHash('sha256').update(serializedWorkflow(workflow)).digest('hex').slice(0, 12)

function versionError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function listWorkflowVersions(versionRoot, workflowId, { includeWorkflow = false } = {}) {
  if (!SAFE_WORKFLOW_ID.test(String(workflowId || ''))) return []
  const dir = path.join(versionRoot, workflowId)
  try {
    return fs.readdirSync(dir).filter(file => file.endsWith('.json')).map(file => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
        if (!record?.id || !record?.hash || !record?.workflow) return null
        return includeWorkflow ? record : { id: record.id, savedAt: record.savedAt, hash: record.hash, name: record.workflow?.name || record.workflow?.metadata?.name || workflowId, nodes: record.workflow?.nodes?.length || 0 }
      } catch { return null }
    }).filter(Boolean).sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0) || String(right.id).localeCompare(String(left.id)))
  } catch { return [] }
}

export function saveWorkflowVersion(versionRoot, workflow, { retention = 50, preserveIds = [], now = Date.now() } = {}) {
  if (!SAFE_WORKFLOW_ID.test(String(workflow?.id || ''))) throw versionError('INVALID_WORKFLOW_ID', 'invalid workflow id')
  const hash = workflowContentHash(workflow)
  const existing = listWorkflowVersions(versionRoot, workflow.id, { includeWorkflow: true }).find(record => record.hash === hash && record.workflow?.id === workflow.id && workflowContentHash(record.workflow) === record.hash)
  if (existing) return existing

  const dir = path.join(versionRoot, workflow.id)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const id = `${stamp}-${hash}`
  const record = { id, savedAt: now, hash, workflow }
  atomicWriteJsonSync(path.join(dir, `${id}.json`), record)

  const preserved = new Set(preserveIds.map(String))
  const versions = listWorkflowVersions(versionRoot, workflow.id, { includeWorkflow: true })
  const removable = versions.slice(Math.max(0, retention)).filter(item => !preserved.has(item.id))
  for (const old of removable) {
    try { fs.unlinkSync(path.join(dir, `${old.id}.json`)) } catch {}
  }
  return record
}

export function resolvePinnedWorkflowVersion(versionRoot, workflowId, workflowVersion) {
  const id = String(workflowId || '')
  const pin = String(workflowVersion || '')
  if (!SAFE_WORKFLOW_ID.test(id) || !SAFE_VERSION_ID.test(pin)) {
    throw versionError('INVALID_WORKFLOW_VERSION', `Pinned subworkflow version for ${id || 'the selected child'} is invalid. Review the node and explicitly update its pin.`)
  }
  const file = path.join(versionRoot, id, `${pin}.json`)
  let record
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { throw versionError('MISSING_WORKFLOW_VERSION', `Pinned subworkflow version ${pin} for ${id} is unavailable. Review the node and explicitly update its pin.`) }
  if (record?.id !== pin || record?.workflow?.id !== id || record?.hash !== workflowContentHash(record.workflow) || !pin.endsWith(`-${record.hash}`)) {
    throw versionError('MISMATCHED_WORKFLOW_VERSION', `Pinned subworkflow version ${pin} does not match workflow ${id}. Review the node; do not run it until the reference is explicitly updated.`)
  }
  return record
}
