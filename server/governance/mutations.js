import { normalizeWorkflowEnvironment } from './environments.js'

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
const RESERVED_ROOT_FIELDS = new Set(['_unlock'])
const LIFECYCLE_FIELDS = Object.freeze([
  'status',
  'locked',
  'promotedAt',
  'promotedBy',
  'approval',
  'unlockedAt',
  'unlockReason',
  'lifecycle',
  'integrity',
  'candidate',
  'deployment',
])

export class GovernanceMutationError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'GovernanceMutationError'
    this.code = code
    this.status = status
  }
}

function fail(code, message, status) {
  throw new GovernanceMutationError(code, message, status)
}

function assertNoReservedRootFields(input) {
  for (const field of RESERVED_ROOT_FIELDS) {
    if (own(input, field)) fail('GOVERNANCE_RESERVED_FIELD', `reserved server-owned field is not accepted: ${field}`, 400)
  }
}

function assertLifecycleFieldsUnchanged(input, existing) {
  const incoming = input?.governance
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return
  const previous = existing?.governance || { status: 'draft', locked: false }
  for (const field of LIFECYCLE_FIELDS) {
    if (!own(incoming, field)) continue
    const expected = previous[field] ?? (field === 'status' ? 'draft' : field === 'locked' ? false : undefined)
    if (JSON.stringify(incoming[field]) !== JSON.stringify(expected)) {
      fail('GOVERNANCE_LIFECYCLE_FIELD', `ordinary save cannot change governance.${field}`, 409)
    }
  }
}

export function assertOrdinaryWorkflowSave({ input, existing = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('GOVERNANCE_INVALID_DOCUMENT', 'workflow body required', 400)
  assertNoReservedRootFields(input)

  const previousEnvironment = normalizeWorkflowEnvironment(existing?.environment)
  const requestedEnvironment = own(input, 'environment')
    ? normalizeWorkflowEnvironment(input.environment)
    : previousEnvironment

  if (!existing && requestedEnvironment !== 'development') {
    fail('GOVERNANCE_ENVIRONMENT_CREATION', 'new workflows must be created in Development', 409)
  }
  if (existing?.governance?.locked || previousEnvironment === 'production') {
    fail('GOVERNANCE_LOCKED', 'production workflow is locked; use an explicit lifecycle action', 423)
  }
  if (existing && requestedEnvironment !== previousEnvironment) {
    fail('GOVERNANCE_ENVIRONMENT_TRANSITION', 'ordinary save cannot change workflow environment', 409)
  }
  assertLifecycleFieldsUnchanged(input, existing)
  return { environment: requestedEnvironment }
}

export function assertWorkflowDelete({ existing } = {}) {
  assertWorkflowMutable({ existing, operation: 'deletion' })
}

export function assertWorkflowMutable({ existing, operation = 'mutation', allowMissing = false } = {}) {
  if (!existing) {
    if (allowMissing) return
    fail('GOVERNANCE_WORKFLOW_NOT_FOUND', 'workflow not found', 404)
  }
  if (existing.governance?.locked || normalizeWorkflowEnvironment(existing.environment) === 'production') {
    fail('GOVERNANCE_LOCKED', `production workflow is locked; unlock it through the lifecycle before ${operation}`, 423)
  }
}

export function assertWorkflowRestore({ existing = null, candidate } = {}) {
  assertWorkflowMutable({ existing, operation: 'restore' })
  const currentEnvironment = normalizeWorkflowEnvironment(existing?.environment)
  const restoredEnvironment = normalizeWorkflowEnvironment(candidate?.environment)
  if (restoredEnvironment !== currentEnvironment) {
    fail('GOVERNANCE_ENVIRONMENT_TRANSITION', 'version restore cannot change workflow environment', 409)
  }
  if (candidate?.governance?.locked) {
    fail('GOVERNANCE_LOCKED_CANDIDATE', 'a locked version cannot be restored through the ordinary restore action', 423)
  }
}

export function assertWorkflowImport({ input, existing = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('GOVERNANCE_INVALID_DOCUMENT', 'workflow body required', 400)
  assertNoReservedRootFields(input)
  if (!/^[a-z0-9_-]+$/i.test(String(input.id || ''))) fail('GOVERNANCE_INVALID_WORKFLOW_ID', 'imported workflow requires a safe id', 400)
  if (existing) assertWorkflowMutable({ existing, operation: 'import overwrite' })
}

export function createDevelopmentWorkflowCandidate(source, { id, name, settings = {}, status = 'candidate', provenance = {}, now = Date.now() } = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('GOVERNANCE_INVALID_DOCUMENT', 'source workflow required', 400)
  if (!/^[a-z0-9_-]+$/i.test(String(id || ''))) fail('GOVERNANCE_INVALID_WORKFLOW_ID', 'candidate workflow requires a safe id', 400)
  const { _unlock: _reservedUnlock, ...safeSource } = source
  const governance = { ...(source.governance || {}) }
  for (const field of LIFECYCLE_FIELDS) delete governance[field]
  governance.status = String(status).slice(0, 80)
  governance.locked = false
  governance.candidateCreatedAt = now
  governance.provenance = { ...provenance }
  return {
    ...safeSource,
    id: String(id || '').slice(0, 100),
    name: String(name || `${source.name || source.id} candidate`).slice(0, 160),
    environment: 'development',
    settings: { ...(source.settings || {}), ...settings },
    governance,
    nodes: (source.nodes || []).map(node => node?.data?.locked ? {
      ...node,
      data: { ...node.data, locked: false, codeMode: node.data.codeMode === 'locked' ? 'assisted' : node.data.codeMode },
    } : node),
  }
}

export function preserveWorkflowLifecycle(existing, workflow) {
  const previous = existing?.governance || { status: 'draft', locked: false }
  const governance = { ...(workflow.governance || {}) }
  for (const field of LIFECYCLE_FIELDS) {
    if (own(previous, field)) governance[field] = previous[field]
    else delete governance[field]
  }
  governance.status = previous.status || 'draft'
  governance.locked = previous.locked === true
  return { ...workflow, environment: normalizeWorkflowEnvironment(existing?.environment), governance }
}
