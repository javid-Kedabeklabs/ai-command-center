import fs from 'node:fs'
import path from 'node:path'

const ID = /^[a-z0-9_.-]+$/i
const OPERATION_KEY = /^op-[a-f0-9]{32}$/
const WORKFLOW_HASH = /^[a-f0-9]{12}$/

export function normalizeParentOperation(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid parent operation context')
  const operation = {
    operationKey: String(raw.operationKey || ''),
    parentRunId: String(raw.parentRunId || ''),
    parentLogicalRunId: String(raw.parentLogicalRunId || ''),
    parentWorkflowId: String(raw.parentWorkflowId || ''),
    parentNodeId: String(raw.parentNodeId || ''),
    parentWorkflowVersionHash: String(raw.parentWorkflowVersionHash || ''),
  }
  if (!OPERATION_KEY.test(operation.operationKey) || !ID.test(operation.parentRunId) || !ID.test(operation.parentLogicalRunId) || !ID.test(operation.parentWorkflowId) || !ID.test(operation.parentNodeId) || !WORKFLOW_HASH.test(operation.parentWorkflowVersionHash)) throw new Error('invalid parent operation context')
  return operation
}

export function findSubworkflowRun({ activeRuns = [], runsDir, operation, workflowId, workflowVersion }) {
  const persisted = []
  if (runsDir) {
    try {
      for (const file of fs.readdirSync(runsDir).filter(name => name.endsWith('.json'))) {
        try { persisted.push(JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'))) } catch {}
      }
    } catch {}
  }
  const existing = [...activeRuns, ...persisted].find(item => item?.parentOperation?.operationKey === operation.operationKey)
  if (!existing) return null
  const recorded = existing.parentOperation || {}
  if (existing.workflowId !== workflowId || (existing.workflowVersion || null) !== (workflowVersion || null) || recorded.parentLogicalRunId !== operation.parentLogicalRunId || recorded.parentWorkflowId !== operation.parentWorkflowId || recorded.parentNodeId !== operation.parentNodeId || recorded.parentWorkflowVersionHash !== operation.parentWorkflowVersionHash) {
    const error = new Error('parent operation identity conflicts with an existing subworkflow run')
    error.code = 'SUBWORKFLOW_OPERATION_CONFLICT'
    throw error
  }
  return existing
}
