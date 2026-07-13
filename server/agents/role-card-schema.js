import { AGENT_PRIMITIVE_IDS } from './primitive-schema.js'

export const ROLE_CARD_SCHEMA_VERSION = 1
export const ORGANIZATIONAL_CLASSES = new Set(['core', 'shared_service', 'domain_specialist', 'mission'])
export const REVIEWER_MODES = new Set(['review_one', 'compare_n', 'merge_best', 'score_only', 'approve_or_reject'])
export const ROLE_CARD_STATUSES = new Set(['draft', 'active', 'deprecated', 'disabled'])

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)
const safeId = /^[a-z0-9][a-z0-9_-]{1,79}$/

function stringList(value, field) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`role card ${field} must be an array`)
  const list = value.map(item => String(item).trim()).filter(Boolean)
  if (list.some(item => item.length > 240)) throw new Error(`role card ${field} contains an overlong reference`)
  return [...new Set(list)]
}

function optionalObject(value, field, fallback = {}) {
  if (value == null) return clone(fallback)
  if (!plain(value)) throw new Error(`role card ${field} must be an object`)
  return clone(value)
}

export function normalizeRoleCard(input, { primitiveIds = AGENT_PRIMITIVE_IDS } = {}) {
  if (!plain(input)) throw new Error('role card must be an object')
  if (input.schemaVersion != null && Number(input.schemaVersion) !== ROLE_CARD_SCHEMA_VERSION) throw new Error('role card uses an unsupported schema version')
  const id = String(input.id || '').trim().toLowerCase()
  const displayName = String(input.displayName || '').trim()
  const primitiveId = String(input.primitiveId || '').trim().toLowerCase()
  const version = Number(input.version)
  const organizationalClass = String(input.organizationalClass || 'shared_service').trim().toLowerCase()
  const mode = input.mode == null ? null : String(input.mode).trim().toLowerCase()
  const status = String(input.status || 'draft').trim().toLowerCase()
  if (!safeId.test(id)) throw new Error('role card has an invalid id')
  if (!displayName || displayName.length > 120) throw new Error('role card displayName is required and must not exceed 120 characters')
  if (!primitiveIds.has(primitiveId)) throw new Error(`role card references an unknown primitive: ${primitiveId}`)
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('role card version must be a positive integer')
  if (!ORGANIZATIONAL_CLASSES.has(organizationalClass)) throw new Error('role card has an invalid organizationalClass')
  if (primitiveId === 'reviewer' && mode != null && !REVIEWER_MODES.has(mode)) throw new Error('reviewer role card has an invalid mode')
  if (primitiveId !== 'reviewer' && mode != null && REVIEWER_MODES.has(mode)) throw new Error('reviewer modes may only be used by the reviewer primitive')
  if (!ROLE_CARD_STATUSES.has(status)) throw new Error('role card has an invalid status')
  const departmentId = input.departmentId == null ? null : String(input.departmentId).trim().toLowerCase()
  if (departmentId && !safeId.test(departmentId)) throw new Error('role card has an invalid departmentId')
  const permissionProfileId = input.permissionProfileId == null ? null : String(input.permissionProfileId).trim()
  const rubric = input.rubric == null ? null : optionalObject(input.rubric, 'rubric')
  if (rubric && (!safeId.test(String(rubric.id || '')) || !Number.isSafeInteger(Number(rubric.version)) || Number(rubric.version) < 1)) throw new Error('role card rubric requires a valid id and positive version')
  return {
    ...clone(input),
    schemaVersion: ROLE_CARD_SCHEMA_VERSION,
    id,
    version,
    displayName,
    primitiveId,
    departmentId,
    organizationalClass,
    description: String(input.description || '').trim().slice(0, 1000),
    mode,
    instructionProfile: input.instructionProfile == null ? null : String(input.instructionProfile).trim(),
    modelPolicy: clone(input.modelPolicy ?? null),
    assignmentScope: clone(input.assignmentScope ?? null),
    skills: stringList(input.skills, 'skills'),
    tools: stringList(input.tools, 'tools'),
    knowledgeScopes: stringList(input.knowledgeScopes, 'knowledgeScopes'),
    memoryScopes: stringList(input.memoryScopes, 'memoryScopes'),
    permissionProfileId,
    rubric,
    uiIdentity: optionalObject(input.uiIdentity, 'uiIdentity'),
    companyWorldProfile: optionalObject(input.companyWorldProfile, 'companyWorldProfile'),
    provenance: optionalObject(input.provenance, 'provenance'),
    status,
  }
}

export function validateRoleCard(input, options) {
  return normalizeRoleCard(input, options)
}
