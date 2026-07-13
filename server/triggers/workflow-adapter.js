import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { migrateWorkflowDocument } from '../workflows/schema.js'
import { saveWorkflowVersion } from '../workflows/versions.js'
import { assertWorkflowMutable } from '../governance/mutations.js'

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }

export function createWorkflowTriggerAdapter({ workflowDir, versionDir }) {
  function list(workflowId = null) {
    const files = workflowId ? [`${workflowId}.json`] : fs.readdirSync(workflowDir).filter(file => file.endsWith('.json'))
    return files.flatMap(file => {
      const workflow = read(path.join(workflowDir, file))
      if (!workflow) return []
      try { return migrateWorkflowDocument(workflow).triggers || [] } catch { return [] }
    })
  }

  function persist(workflow) {
    const normalized = migrateWorkflowDocument(workflow)
    saveWorkflowVersion(versionDir, normalized)
    const file = path.join(workflowDir, `${normalized.id}.json`), temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(normalized, null, 2))
    fs.renameSync(temporary, file)
    return normalized
  }

  async function mutate(action, trigger) {
    const file = path.join(workflowDir, `${trigger.workflowId}.json`), raw = read(file)
    if (!raw) throw Object.assign(new Error('workflow not found'), { code: 'WORKFLOW_NOT_FOUND' })
    const workflow = migrateWorkflowDocument(raw)
    try { assertWorkflowMutable({ existing: workflow, operation: 'changing triggers' }) }
    catch (error) { throw Object.assign(error, { code: error.code === 'GOVERNANCE_LOCKED' ? 'WORKFLOW_LOCKED' : error.code }) }
    const index = workflow.triggers.findIndex(item => item.id === trigger.id)
    if (action === 'create') {
      if (index >= 0) throw new Error('trigger already exists')
      workflow.triggers.push(trigger)
    } else if (action === 'update') {
      if (index < 0) throw new Error('trigger not found')
      workflow.triggers[index] = trigger
    } else if (action === 'delete') {
      if (index < 0) throw new Error('trigger not found')
      workflow.triggers.splice(index, 1)
    } else throw new Error('unsupported trigger mutation')
    const saved = persist(workflow)
    return action === 'delete' ? trigger : saved.triggers.find(item => item.id === trigger.id)
  }

  async function migrateLegacy(triggers) {
    const byWorkflow = new Map()
    for (const trigger of triggers) {
      if (!byWorkflow.has(trigger.workflowId)) byWorkflow.set(trigger.workflowId, [])
      byWorkflow.get(trigger.workflowId).push(trigger)
    }
    for (const [workflowId, incoming] of byWorkflow) {
      const file = path.join(workflowDir, `${workflowId}.json`), raw = read(file)
      if (!raw) throw new Error(`legacy trigger references missing workflow ${workflowId}`)
      const workflow = migrateWorkflowDocument(raw)
      assertWorkflowMutable({ existing: workflow, operation: 'migrating legacy triggers' })
      let changed = false
      for (const trigger of incoming) if (!workflow.triggers.some(item => item.id === trigger.id)) {
        const { tokenHash: _tokenHash, webhookToken: _webhookToken, ...canonical } = trigger
        workflow.triggers.push(canonical); changed = true
      }
      if (changed) persist(workflow)
    }
  }

  async function currentVersion(workflowId) {
    const workflow = read(path.join(workflowDir, `${workflowId}.json`))
    if (!workflow) throw Object.assign(new Error('workflow not found'), { code: 'WORKFLOW_NOT_FOUND' })
    return saveWorkflowVersion(versionDir, migrateWorkflowDocument(workflow)).id
  }

  function authorizeFolder(trigger) {
    const workflow = read(path.join(workflowDir, `${trigger.workflowId}.json`))
    if (!workflow) throw Object.assign(new Error('workflow not found'), { code: 'WORKFLOW_NOT_FOUND' })
    const normalized = migrateWorkflowDocument(workflow)
    if (normalized.permissions?.['read-files'] === false) throw Object.assign(new Error('workflow permission read-files denies folder triggers'), { code: 'FOLDER_PERMISSION_DENIED' })
    return true
  }

  function authorizeWebhook(trigger, { operation = 'delivery' } = {}) {
    const workflow = read(path.join(workflowDir, `${trigger.workflowId}.json`))
    if (!workflow) throw Object.assign(new Error('workflow not found'), { code: 'WORKFLOW_NOT_FOUND' })
    const normalized = migrateWorkflowDocument(workflow)
    if (operation !== 'revoke' && normalized.permissions?.['receive-webhooks'] === false) throw Object.assign(new Error('workflow permission receive-webhooks denies webhook access'), { code: 'WEBHOOK_PERMISSION_DENIED' })
    return true
  }

  return { list, mutate, migrateLegacy, currentVersion, authorizeFolder, authorizeWebhook, persist }
}
