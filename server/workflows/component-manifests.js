import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'
import { migrateWorkflowDocument } from './schema.js'
import { isReusableComponent } from './components.js'
import { resolvePinnedWorkflowVersion, workflowContentHash } from './versions.js'

export const COMPONENT_MANIFEST_VERSION = 1
export const COMPONENT_MANIFEST_KIND = 'command-center/reusable-component'
export const COMPONENT_MANIFEST_MAX_DEPTH = 8
const SAFE_ID = /^[a-z0-9_-]+$/i
const SAFE_VERSION = /^[a-z0-9_.-]+$/i
const EXECUTABLE_TYPES = new Set(['agent', 'orchestrator', 'critic', 'parallel', 'map', 'python', 'shell', 'http', 'mcp', 'custom', 'subworkflow'])

const clone = value => JSON.parse(JSON.stringify(value))
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const fail = (code, message, detail = {}) => Object.assign(new Error(message), { code, ...detail })
const secretKey = key => {
  if (key === 'secretReferences') return false
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase()
  return normalized === 'token' || normalized.endsWith('token') || normalized.includes('credential') || normalized.includes('password') || normalized.includes('privatekey') || normalized.includes('apikey') || normalized.includes('clientsecret') || normalized === 'authorization' || normalized === 'cookie' || normalized.startsWith('secret') || normalized.startsWith('authreference')
}

function assertSafePayload(value, trail = 'manifest') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafePayload(item, `${trail}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (secretKey(key) || key === 'secretReferences' && Array.isArray(child) && child.length) throw fail('SECRET_BEARING_MANIFEST', `${trail}.${key} is not portable; remove credentials and secret references before export`)
    assertSafePayload(child, `${trail}.${key}`)
  }
}

function portableWorkflow(raw) {
  const workflow = migrateWorkflowDocument(clone(raw))
  assertSafePayload(workflow, `workflow ${workflow.id}`)
  if ((workflow.secretReferences || []).length) throw fail('SECRET_BEARING_MANIFEST', `workflow ${workflow.id} contains secret references and cannot be exported as a component`)
  return workflow
}

function dependencyPins(workflow) {
  return (workflow.nodes || []).filter(node => node?.type === 'subworkflow').map(node => ({
    nodeId: String(node.id || ''), componentId: String(node.data?.workflowId || ''), workflowVersion: String(node.data?.workflowVersion || ''),
  })).sort((left, right) => left.componentId.localeCompare(right.componentId) || left.nodeId.localeCompare(right.nodeId))
}

function currentSnapshot(workflowRoot, versionRoot, componentId) {
  if (!SAFE_ID.test(componentId)) throw fail('INVALID_COMPONENT_ID', 'invalid component id')
  let raw
  try { raw = readJson(path.join(workflowRoot, `${componentId}.json`)) } catch { throw fail('COMPONENT_NOT_FOUND', `reusable component ${componentId} was not found`) }
  if (!isReusableComponent(raw)) throw fail('NOT_REUSABLE_COMPONENT', `workflow ${componentId} is not a reusable component`)
  const hash = workflowContentHash(raw)
  let files = []
  try { files = fs.readdirSync(path.join(versionRoot, componentId)).filter(file => file.endsWith('.json')).sort() } catch {}
  for (const file of files) {
    try {
      const record = readJson(path.join(versionRoot, componentId, file))
      if (record?.hash === hash && record?.workflow?.id === componentId) return resolvePinnedWorkflowVersion(versionRoot, componentId, record.id)
    } catch {}
  }
  throw fail('CURRENT_SNAPSHOT_MISSING', `current saved snapshot for component ${componentId} is unavailable`)
}

function componentRecord(record) {
  const workflow = portableWorkflow(record.workflow)
  const dependencies = dependencyPins(workflow).map(pin => ({ ...pin, hash: null }))
  return {
    id: workflow.id,
    name: String(workflow.name || workflow.metadata?.name || workflow.id),
    description: String(workflow.metadata?.component?.description || '').slice(0, 500),
    snapshot: { id: record.id, hash: record.hash },
    dependencies,
    compatibility: { workflowSchema: workflow.schemaVersion },
    provenance: { type: 'command-center-component', sourceComponentId: workflow.id },
    workflow,
  }
}

export function exportComponentManifest(workflowRoot, versionRoot, rootComponentId) {
  const records = new Map(), visiting = []
  const visit = (componentId, pinnedVersion = null, depth = 0) => {
    if (depth > COMPONENT_MANIFEST_MAX_DEPTH) throw fail('COMPONENT_DEPTH_EXCEEDED', `component dependency depth exceeds ${COMPONENT_MANIFEST_MAX_DEPTH}`)
    if (visiting.includes(componentId)) throw fail('COMPONENT_DEPENDENCY_CYCLE', `component dependency cycle: ${[...visiting, componentId].join(' → ')}`)
    if (records.has(componentId)) {
      if (pinnedVersion && records.get(componentId).snapshot.id !== pinnedVersion) throw fail('COMPONENT_PIN_CONFLICT', `component ${componentId} is referenced with conflicting exact versions`)
      return records.get(componentId)
    }
    const snapshot = pinnedVersion ? resolvePinnedWorkflowVersion(versionRoot, componentId, pinnedVersion) : currentSnapshot(workflowRoot, versionRoot, componentId)
    if (!isReusableComponent(snapshot.workflow)) throw fail('NOT_REUSABLE_COMPONENT', `pinned workflow ${componentId} is not a reusable component`)
    visiting.push(componentId)
    const item = componentRecord(snapshot)
    for (const dependency of item.dependencies) {
      if (!SAFE_ID.test(dependency.componentId) || !SAFE_VERSION.test(dependency.workflowVersion)) throw fail('MISSING_COMPONENT_PIN', `subworkflow ${dependency.nodeId} in ${componentId} needs an exact reusable-component pin`)
      const child = visit(dependency.componentId, dependency.workflowVersion, depth + 1)
      dependency.hash = child.snapshot.hash
    }
    visiting.pop()
    records.set(componentId, item)
    return item
  }
  const root = visit(String(rootComponentId || ''))
  return {
    manifestVersion: COMPONENT_MANIFEST_VERSION,
    kind: COMPONENT_MANIFEST_KIND,
    rootComponentId: root.id,
    compatibility: { workflowSchema: 2 },
    components: [...records.values()].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

export function validateComponentManifest(input, { workflowRoot = null } = {}) {
  const manifest = clone(input || {})
  if (manifest.manifestVersion !== COMPONENT_MANIFEST_VERSION || manifest.kind !== COMPONENT_MANIFEST_KIND) throw fail('UNSUPPORTED_COMPONENT_MANIFEST', 'unsupported reusable-component manifest')
  if (!SAFE_ID.test(String(manifest.rootComponentId || '')) || !Array.isArray(manifest.components) || !manifest.components.length) throw fail('INVALID_COMPONENT_MANIFEST', 'component manifest root and components are required')
  if (manifest.compatibility?.workflowSchema !== 2) throw fail('INCOMPATIBLE_COMPONENT_MANIFEST', 'component manifest requires an unsupported workflow schema')
  assertSafePayload(manifest)
  const records = new Map()
  for (const item of manifest.components) {
    if (!SAFE_ID.test(String(item?.id || '')) || records.has(item.id)) throw fail('INVALID_COMPONENT_ID', `invalid or duplicate component id: ${item?.id || '(missing)'}`)
    if (!SAFE_VERSION.test(String(item.snapshot?.id || '')) || !/^[a-f0-9]{12}$/.test(String(item.snapshot?.hash || ''))) throw fail('INVALID_COMPONENT_SNAPSHOT', `component ${item.id} has an invalid snapshot identity`)
    const workflow = portableWorkflow(item.workflow)
    if (workflow.id !== item.id || !isReusableComponent(workflow)) throw fail('COMPONENT_ID_MISMATCH', `component ${item.id} workflow identity or reusable metadata does not match`)
    const hash = workflowContentHash(item.workflow)
    if (hash !== item.snapshot.hash || !item.snapshot.id.endsWith(`-${hash}`)) throw fail('TAMPERED_COMPONENT_HASH', `component ${item.id} snapshot hash does not match its workflow`)
    if (item.compatibility?.workflowSchema !== 2 || workflow.schemaVersion !== 2) throw fail('INCOMPATIBLE_COMPONENT_MANIFEST', `component ${item.id} uses an unsupported schema`)
    records.set(item.id, { ...item, workflow, dependencies: dependencyPins(workflow) })
  }
  if (!records.has(manifest.rootComponentId)) throw fail('MISSING_ROOT_COMPONENT', 'root component is missing from the manifest')
  const visited = new Set(), stack = []
  const walk = (id, depth) => {
    if (depth > COMPONENT_MANIFEST_MAX_DEPTH) throw fail('COMPONENT_DEPTH_EXCEEDED', `component dependency depth exceeds ${COMPONENT_MANIFEST_MAX_DEPTH}`)
    if (stack.includes(id)) throw fail('COMPONENT_DEPENDENCY_CYCLE', `component dependency cycle: ${[...stack, id].join(' → ')}`)
    if (visited.has(id)) return
    stack.push(id); for (const child of records.get(id).dependencies) { if (records.has(child.componentId)) walk(child.componentId, depth + 1) }; stack.pop(); visited.add(id)
  }
  walk(manifest.rootComponentId, 0)
  for (const item of records.values()) {
    const declared = Array.isArray(manifest.components.find(candidate => candidate.id === item.id)?.dependencies) ? manifest.components.find(candidate => candidate.id === item.id).dependencies : []
    if (declared.length !== item.dependencies.length) throw fail('DEPENDENCY_MISMATCH', `component ${item.id} dependency summary does not match its workflow`)
    for (const pin of item.dependencies) {
      const child = records.get(pin.componentId)
      const declaration = declared.find(value => value.nodeId === pin.nodeId && value.componentId === pin.componentId && value.workflowVersion === pin.workflowVersion)
      if (!child) throw fail('MISSING_COMPONENT_DEPENDENCY', `component ${item.id} requires missing dependency ${pin.componentId}`)
      if (!declaration || declaration.hash !== child.snapshot.hash || pin.workflowVersion !== child.snapshot.id) throw fail('DEPENDENCY_PIN_MISMATCH', `component ${item.id} has a mismatched exact pin for ${pin.componentId}`)
    }
  }
  if (visited.size !== records.size) throw fail('UNRELATED_COMPONENT', 'manifest contains components outside the root dependency closure')
  const conflicts = []
  if (workflowRoot) for (const item of records.values()) {
    const file = path.join(workflowRoot, `${item.id}.json`)
    if (fs.existsSync(file)) {
      let locked = false
      try { locked = readJson(file)?.governance?.locked === true } catch {}
      conflicts.push({ componentId: item.id, type: locked ? 'locked-production' : 'existing-component', message: locked ? 'A locked production workflow already uses this ID; replacement is forbidden.' : 'A workflow already uses this ID; replacement is never implicit.' })
    }
  }
  const executableNodes = [...records.values()].reduce((count, item) => count + item.workflow.nodes.filter(node => EXECUTABLE_TYPES.has(node.type)).length, 0)
  return { manifest, records, review: { rootComponentId: manifest.rootComponentId, componentCount: records.size, dependencyCount: [...records.values()].reduce((count, item) => count + item.dependencies.length, 0), executableNodes, conflicts, approvable: conflicts.length === 0 } }
}

export function installComponentManifest(workflowRoot, versionRoot, input, { proposalId = null, now = Date.now() } = {}) {
  const validated = validateComponentManifest(input, { workflowRoot })
  if (!validated.review.approvable) throw fail('COMPONENT_IMPORT_CONFLICT', 'component import conflicts must be resolved without overwrite', { conflicts: validated.review.conflicts })
  const createdFiles = [], createdDirs = []
  try {
    for (const item of [...validated.records.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      const workflow = {
        ...item.workflow,
        environment: 'development',
        governance: { ...(item.workflow.governance || {}), status: 'imported-review', locked: false, importedAt: now, provenance: { type: 'component-manifest', proposalId } },
        metadata: { ...(item.workflow.metadata || {}), component: { ...item.workflow.metadata.component, reusable: true, archived: false, importedAt: now } },
      }
      const versionWorkflow = clone(item.workflow)
      const dir = path.join(versionRoot, item.id), versionFile = path.join(dir, `${item.snapshot.id}.json`), workflowFile = path.join(workflowRoot, `${item.id}.json`)
      fs.mkdirSync(dir, { recursive: false }); createdDirs.push(dir)
      atomicWriteJsonSync(versionFile, { id: item.snapshot.id, savedAt: now, hash: item.snapshot.hash, workflow: versionWorkflow }); createdFiles.push(versionFile)
      atomicWriteJsonSync(workflowFile, workflow); createdFiles.push(workflowFile)
      // The imported review wrapper has its own exact current snapshot; dependency pins remain the original exact IDs.
      const importedHash = workflowContentHash(workflow), importedId = `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${importedHash}`
      atomicWriteJsonSync(path.join(dir, `${importedId}.json`), { id: importedId, savedAt: now, hash: importedHash, workflow }); createdFiles.push(path.join(dir, `${importedId}.json`))
    }
    return validated.review
  } catch (error) {
    for (const file of createdFiles.reverse()) { try { fs.unlinkSync(file) } catch {} }
    for (const dir of createdDirs.reverse()) { try { fs.rmdirSync(dir) } catch {} }
    throw error
  }
}
