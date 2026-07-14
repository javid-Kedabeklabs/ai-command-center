import { patternsOverlap } from './conflict-detector.js'

export const COLLABORATION_TASK_SCHEMA_VERSION = 2
export const SUPPORTED_COLLABORATION_TASK_SCHEMA_VERSIONS = Object.freeze([1, 2])

export const TASK_STATUSES = Object.freeze([
  'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED',
])
export const TASK_TYPES = Object.freeze([
  'READ_ONLY_AUDIT', 'ARCHITECTURE_REVIEW', 'IMPLEMENTATION', 'UX_IMPLEMENTATION',
  'TEST_CREATION', 'BUG_REPAIR', 'SECURITY_REVIEW', 'PERFORMANCE_REVIEW',
  'VISUAL_REVIEW', 'DOCUMENTATION', 'REGRESSION_ANALYSIS',
])
export const PERMISSION_PROFILES = Object.freeze(['READ_ONLY_ADVISOR', 'WORKTREE_IMPLEMENTATION'])
export const MODELS = Object.freeze(['fable', 'sonnet'])
export const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

const READ_ONLY_TYPES = new Set([
  'READ_ONLY_AUDIT', 'ARCHITECTURE_REVIEW', 'SECURITY_REVIEW', 'PERFORMANCE_REVIEW',
  'VISUAL_REVIEW', 'REGRESSION_ANALYSIS',
])
const ROOT_KEYS = new Set([
  'schemaVersion', 'taskId', 'title', 'status', 'phase', 'priority', 'createdBy',
  'assignedWorker', 'taskType', 'objective', 'background', 'acceptanceCriteria',
  'filesAllowed', 'filesForbidden', 'readOnlyContextFiles', 'dependencies',
  'requiredTests', 'permissionProfile', 'modelPolicy', 'maxTurns', 'timeoutSeconds',
  'allowSubagents', 'allowNetwork', 'requiresCommit', 'expectedOutput', 'contractPack',
])
const MODEL_KEYS = new Set(['primary', 'fallback', 'effort'])
const OUTPUT_KEYS = new Set(['summary', 'filesChanged', 'tests', 'commitSha', 'risks'])
const CONTRACT_KEYS = new Set(['reviewedBaseSha', 'contractFiles', 'acceptanceTestCommitSha', 'scenarioIds', 'maxChangedFiles', 'estimatedCodexSeconds', 'stopConditions'])
const CONTRACT_FILE_KEYS = new Set(['path', 'sha256'])
const FORBIDDEN_PATH_SEGMENTS = new Set(['.git', '.env', '.ssh', '.gnupg', 'node_modules'])
const SECRET_PATH = /(^|\/)(?:secrets?|credentials?|tokens?)(?:\/|$)|(?:^|\/)(?:\.env)(?:\.|$)/i
const GLOB_META = /[*?\[\]{}]/

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`)
  }
}

function requireText(value, label, { min = 1, max = 2_000, pattern } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new Error(`${label} must be a string between ${min} and ${max} characters`)
  }
  const normalized = value.trim()
  if (pattern && !pattern.test(normalized)) throw new Error(`${label} has an invalid format`)
  return normalized
}

function uniqueTextArray(value, label, { min = 0, max = 100, itemMax = 500 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain between ${min} and ${max} items`)
  }
  const normalized = value.map((item, index) => requireText(item, `${label}[${index}]`, { max: itemMax }))
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`)
  return normalized
}

export function validateRepositoryPattern(value, label = 'path pattern') {
  const path = requireText(value, label, { max: 300 })
  if (path.includes('\0') || path.includes('\\')) throw new Error(`${label} must use safe POSIX separators`)
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.startsWith('~')) throw new Error(`${label} must be repository-relative`)
  if (path.endsWith('/') || path.includes('//')) throw new Error(`${label} must be normalized`)
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment.includes('..'))) throw new Error(`${label} contains traversal or non-normalized segments`)
  if (segments.some(segment => FORBIDDEN_PATH_SEGMENTS.has(segment)) || SECRET_PATH.test(path)) {
    throw new Error(`${label} targets a protected or secret location`)
  }
  if (/[\[\]{}]/.test(path)) throw new Error(`${label} uses an unsupported ambiguous glob construct`)
  if (/[^a-zA-Z0-9_@+.,=:/[\]{}*?!() -]/.test(path)) throw new Error(`${label} contains unsupported characters`)
  return path
}

function literalPrefix(pattern) {
  const index = pattern.search(GLOB_META)
  return (index < 0 ? pattern : pattern.slice(0, index)).replace(/\/+$/, '')
}

function scopeContradiction(allowed, forbidden) {
  for (const left of allowed) {
    for (const right of forbidden) {
      const a = literalPrefix(left)
      const b = literalPrefix(right)
      if (left === right || (a && b && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)))) return [left, right]
    }
  }
  return null
}

export function validateTaskPacket(input) {
  if (!plainObject(input)) throw new Error('collaboration task must be an object')
  rejectUnknownKeys(input, ROOT_KEYS, 'collaboration task')
  if (!SUPPORTED_COLLABORATION_TASK_SCHEMA_VERSIONS.includes(input.schemaVersion)) throw new Error(`schemaVersion must be one of ${SUPPORTED_COLLABORATION_TASK_SCHEMA_VERSIONS.join(', ')}`)

  const taskId = requireText(input.taskId, 'taskId', { max: 100, pattern: /^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/ })
  const title = requireText(input.title, 'title', { max: 120 })
  if (!TASK_STATUSES.includes(input.status)) throw new Error('status is not supported')
  const phase = requireText(input.phase, 'phase', { max: 120, pattern: /^[a-zA-Z0-9][a-zA-Z0-9 ._/-]*$/ })
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100) throw new Error('priority must be an integer from 0 to 100')
  if (input.createdBy !== 'codex') throw new Error('createdBy must be codex')
  if (!['claude-fable', 'claude-sonnet', 'codex'].includes(input.assignedWorker)) throw new Error('assignedWorker is not supported')
  if (!TASK_TYPES.includes(input.taskType)) throw new Error('taskType is not supported')
  const objective = requireText(input.objective, 'objective', { min: 10, max: 4_000 })
  const background = requireText(input.background, 'background', { max: 8_000 })
  const acceptanceCriteria = uniqueTextArray(input.acceptanceCriteria, 'acceptanceCriteria', { min: 1, max: 30, itemMax: 1_000 })
  const filesAllowed = uniqueTextArray(input.filesAllowed, 'filesAllowed', { max: 100, itemMax: 300 }).map((item, index) => validateRepositoryPattern(item, `filesAllowed[${index}]`))
  const filesForbidden = uniqueTextArray(input.filesForbidden, 'filesForbidden', { max: 100, itemMax: 300 }).map((item, index) => validateRepositoryPattern(item, `filesForbidden[${index}]`))
  const readOnlyContextFiles = uniqueTextArray(input.readOnlyContextFiles, 'readOnlyContextFiles', { max: 100, itemMax: 300 }).map((item, index) => validateRepositoryPattern(item, `readOnlyContextFiles[${index}]`))
  const dependencies = uniqueTextArray(input.dependencies, 'dependencies', { max: 50, itemMax: 100 })
  for (const dependency of dependencies) {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/.test(dependency)) throw new Error('dependencies contains an invalid task id')
    if (dependency === taskId) throw new Error('task cannot depend on itself')
  }
  const requiredTests = uniqueTextArray(input.requiredTests, 'requiredTests', { min: 1, max: 30, itemMax: 500 })
  if (!PERMISSION_PROFILES.includes(input.permissionProfile)) throw new Error('permissionProfile is not supported')

  if (!plainObject(input.modelPolicy)) throw new Error('modelPolicy must be an object')
  rejectUnknownKeys(input.modelPolicy, MODEL_KEYS, 'modelPolicy')
  if (!MODELS.includes(input.modelPolicy.primary)) throw new Error('modelPolicy.primary is not supported')
  if (input.modelPolicy.fallback != null && !MODELS.includes(input.modelPolicy.fallback)) throw new Error('modelPolicy.fallback is not supported')
  if (input.modelPolicy.fallback === input.modelPolicy.primary) throw new Error('model fallback must differ from primary')
  if (!EFFORT_LEVELS.includes(input.modelPolicy.effort)) throw new Error('modelPolicy.effort is not supported')
  if (!Number.isInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 100) throw new Error('maxTurns must be an integer from 1 to 100')
  if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 30 || input.timeoutSeconds > 7_200) throw new Error('timeoutSeconds must be an integer from 30 to 7200')
  for (const key of ['allowSubagents', 'allowNetwork', 'requiresCommit']) {
    if (typeof input[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
  }
  if (!plainObject(input.expectedOutput)) throw new Error('expectedOutput must be an object')
  rejectUnknownKeys(input.expectedOutput, OUTPUT_KEYS, 'expectedOutput')
  for (const key of OUTPUT_KEYS) {
    if (typeof input.expectedOutput[key] !== 'boolean') throw new Error(`expectedOutput.${key} must be a boolean`)
  }

  const readOnly = READ_ONLY_TYPES.has(input.taskType)
  if (readOnly && input.permissionProfile !== 'READ_ONLY_ADVISOR') throw new Error('read-only task type requires READ_ONLY_ADVISOR')
  if (readOnly && (input.requiresCommit || filesAllowed.length > 0)) throw new Error('read-only task cannot allow edits or require a commit')
  if (!readOnly && input.permissionProfile !== 'WORKTREE_IMPLEMENTATION') throw new Error('modifying task requires WORKTREE_IMPLEMENTATION')
  if (!readOnly && (!input.requiresCommit || filesAllowed.length === 0)) throw new Error('modifying task requires an isolated commit and non-empty filesAllowed')
  if (filesAllowed.some(pattern => !literalPrefix(pattern))) throw new Error('filesAllowed cannot use a repository-wide wildcard')
  if (!readOnly && !input.expectedOutput.commitSha) throw new Error('modifying task must require commitSha output')
  if (input.allowNetwork) throw new Error('network access is disabled by collaboration policy')
  const contradiction = scopeContradiction(filesAllowed, filesForbidden)
  if (contradiction) throw new Error(`allowed and forbidden file scopes conflict: ${contradiction.join(' <> ')}`)

  let contractPack = null
  if (input.schemaVersion === 2) {
    if (!plainObject(input.contractPack)) throw new Error('schemaVersion 2 requires contractPack')
    rejectUnknownKeys(input.contractPack, CONTRACT_KEYS, 'contractPack')
    const sha = (value, label, length = 40) => requireText(value, label, { min: length, max: 64, pattern: /^[a-f0-9]{40,64}$/ })
    const reviewedBaseSha = sha(input.contractPack.reviewedBaseSha, 'contractPack.reviewedBaseSha')
    const acceptanceTestCommitSha = sha(input.contractPack.acceptanceTestCommitSha, 'contractPack.acceptanceTestCommitSha')
    if (!Array.isArray(input.contractPack.contractFiles) || input.contractPack.contractFiles.length < 1 || input.contractPack.contractFiles.length > 30) throw new Error('contractPack.contractFiles must contain between 1 and 30 files')
    const seenContractFiles = new Set()
    const contractFiles = input.contractPack.contractFiles.map((item, index) => {
      if (!plainObject(item)) throw new Error(`contractPack.contractFiles[${index}] must be an object`)
      rejectUnknownKeys(item, CONTRACT_FILE_KEYS, `contractPack.contractFiles[${index}]`)
      const contractPath = validateRepositoryPattern(item.path, `contractPack.contractFiles[${index}].path`)
      if (GLOB_META.test(contractPath) || contractPath.includes(':')) throw new Error('contractPack contract file paths must be exact safe Git paths')
      if (seenContractFiles.has(contractPath)) throw new Error('contractPack contract file paths must be unique')
      seenContractFiles.add(contractPath)
      if (!readOnlyContextFiles.includes(contractPath)) throw new Error('every contractPack contract file must be listed in readOnlyContextFiles')
      if (filesAllowed.some(pattern => patternsOverlap(pattern, contractPath))) throw new Error('contractPack contract files cannot overlap writable filesAllowed')
      return Object.freeze({ path: contractPath, sha256: requireText(item.sha256, `contractPack.contractFiles[${index}].sha256`, { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }) })
    })
    const scenarioIds = uniqueTextArray(input.contractPack.scenarioIds, 'contractPack.scenarioIds', { min: 1, max: 50, itemMax: 100 })
    for (const scenarioId of scenarioIds) if (!/^[A-Z0-9][A-Z0-9._-]{1,99}$/.test(scenarioId)) throw new Error('contractPack.scenarioIds contains an invalid stable scenario id')
    const maxChangedFiles = input.contractPack.maxChangedFiles
    if (!Number.isInteger(maxChangedFiles) || maxChangedFiles < (readOnly ? 0 : 1) || maxChangedFiles > 25 || readOnly && maxChangedFiles !== 0) throw new Error('contractPack.maxChangedFiles is invalid for the task authority')
    if (!Number.isInteger(input.contractPack.estimatedCodexSeconds) || input.contractPack.estimatedCodexSeconds < 60 || input.contractPack.estimatedCodexSeconds > 604_800) throw new Error('contractPack.estimatedCodexSeconds must be between 60 and 604800')
    const stopConditions = uniqueTextArray(input.contractPack.stopConditions, 'contractPack.stopConditions', { min: 3, max: 30, itemMax: 500 })
    contractPack = Object.freeze({ reviewedBaseSha, acceptanceTestCommitSha, contractFiles: Object.freeze(contractFiles), scenarioIds: Object.freeze(scenarioIds), maxChangedFiles, estimatedCodexSeconds: input.contractPack.estimatedCodexSeconds, stopConditions: Object.freeze(stopConditions) })
  } else if (input.contractPack != null) throw new Error('legacy schemaVersion 1 cannot contain contractPack')

  return Object.freeze({
    schemaVersion: input.schemaVersion, taskId, title, status: input.status, phase, priority: input.priority,
    createdBy: input.createdBy, assignedWorker: input.assignedWorker, taskType: input.taskType,
    objective, background, acceptanceCriteria, filesAllowed, filesForbidden, readOnlyContextFiles,
    dependencies, requiredTests, permissionProfile: input.permissionProfile,
    modelPolicy: Object.freeze({ ...input.modelPolicy }), maxTurns: input.maxTurns,
    timeoutSeconds: input.timeoutSeconds, allowSubagents: input.allowSubagents,
    allowNetwork: false, requiresCommit: input.requiresCommit,
    expectedOutput: Object.freeze({ ...input.expectedOutput }), ...(contractPack ? { contractPack } : {}),
  })
}

export const normalizeTaskPacket = validateTaskPacket
export const isReadOnlyTaskType = taskType => READ_ONLY_TYPES.has(taskType)
