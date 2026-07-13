export const LOCAL_FACTORY_TASK_SCHEMA_VERSION = 1

export const LOCAL_FACTORY_TASK_TYPES = Object.freeze([
  'REPOSITORY_AUDIT',
  'IMPLEMENTATION_PROPOSAL',
  'TEST_DESIGN',
  'CODE_REVIEW',
  'FAILURE_ANALYSIS',
  'DOCUMENTATION_DRAFT',
])

export const LOCAL_FACTORY_WORKER_ROLES = Object.freeze([
  'EXPLORER', 'IMPLEMENTATION_ADVISOR', 'TEST_ENGINEER', 'REVIEWER',
])

export const LOCAL_FACTORY_TASK_STATUSES = Object.freeze(['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED'])
const TASK_STATUSES = new Set(LOCAL_FACTORY_TASK_STATUSES)
const SECRET_PATH = /(^|\/)(?:\.env(?:\.|$)|secrets?|credentials?|tokens?)(?:\/|$)/i
const PROTECTED_SEGMENTS = new Set(['.git', '.ssh', '.gnupg', 'node_modules', 'logs', 'state', 'data'])
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new Error(`${label} must contain between ${min} and ${max} characters`)
  }
  return value.trim()
}

export function validateLocalFactoryPath(value, label = 'context path') {
  const normalized = text(value, label, 1, 300)
  if (normalized.includes('\0') || normalized.includes('\\') || normalized.startsWith('/') || normalized.startsWith('~')) {
    throw new Error(`${label} must be a repository-relative POSIX path`)
  }
  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('..'))) {
    throw new Error(`${label} contains traversal or non-normalized segments`)
  }
  if (segments.some(segment => PROTECTED_SEGMENTS.has(segment)) || SECRET_PATH.test(normalized)) {
    throw new Error(`${label} targets protected runtime or secret data`)
  }
  if (/[*?\[\]{}]/.test(normalized)) throw new Error(`${label} must identify one exact file`)
  return normalized
}

export function validateLocalFactoryTask(input) {
  if (!plainObject(input)) throw new Error('local factory task must be an object')
  const allowed = new Set([
    'schemaVersion', 'taskId', 'status', 'taskType', 'workerRole', 'title', 'objective',
    'background', 'contextFiles', 'acceptanceCriteria', 'priority', 'timeoutSeconds',
    'maxInputBytes', 'maxOutputTokens', 'temperature', 'model',
  ])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`unsupported local factory task field: ${key}`)
  if (input.schemaVersion !== LOCAL_FACTORY_TASK_SCHEMA_VERSION) throw new Error('unsupported local factory task schemaVersion')
  const taskId = text(input.taskId, 'taskId', 3, 100)
  if (!/^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/.test(taskId)) throw new Error('taskId has an invalid format')
  if (!TASK_STATUSES.has(input.status)) throw new Error('local factory task status is invalid')
  if (!LOCAL_FACTORY_TASK_TYPES.includes(input.taskType)) throw new Error('local factory taskType is invalid')
  if (!LOCAL_FACTORY_WORKER_ROLES.includes(input.workerRole)) throw new Error('local factory workerRole is invalid')
  const title = text(input.title, 'title', 3, 140)
  const objective = text(input.objective, 'objective', 10, 4_000)
  const background = text(input.background || 'No additional background.', 'background', 1, 8_000)
  if (!Array.isArray(input.contextFiles) || input.contextFiles.length > 40) throw new Error('contextFiles must contain at most 40 files')
  const contextFiles = input.contextFiles.map((item, index) => validateLocalFactoryPath(item, `contextFiles[${index}]`))
  if (new Set(contextFiles).size !== contextFiles.length) throw new Error('contextFiles must not contain duplicates')
  if (!Array.isArray(input.acceptanceCriteria) || !input.acceptanceCriteria.length || input.acceptanceCriteria.length > 30) throw new Error('acceptanceCriteria must contain between 1 and 30 items')
  const acceptanceCriteria = input.acceptanceCriteria.map((item, index) => text(item, `acceptanceCriteria[${index}]`, 2, 1_000))
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100) throw new Error('priority must be an integer from 0 to 100')
  if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 10 || input.timeoutSeconds > 1_800) throw new Error('timeoutSeconds must be an integer from 10 to 1800')
  if (!Number.isInteger(input.maxInputBytes) || input.maxInputBytes < 1_024 || input.maxInputBytes > 2_000_000) throw new Error('maxInputBytes must be between 1024 and 2000000')
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 128 || input.maxOutputTokens > 16_384) throw new Error('maxOutputTokens must be between 128 and 16384')
  if (typeof input.temperature !== 'number' || input.temperature < 0 || input.temperature > 1) throw new Error('temperature must be between 0 and 1')
  const model = text(input.model, 'model', 3, 160)
  if (model !== 'qwen-coder-factory') throw new Error('local factory tasks must use the approved qwen-coder-factory model')

  return Object.freeze({
    schemaVersion: 1, taskId, status: input.status, taskType: input.taskType,
    workerRole: input.workerRole, title, objective, background,
    contextFiles: Object.freeze(contextFiles), acceptanceCriteria: Object.freeze(acceptanceCriteria),
    priority: input.priority, timeoutSeconds: input.timeoutSeconds,
    maxInputBytes: input.maxInputBytes, maxOutputTokens: input.maxOutputTokens,
    temperature: input.temperature, model,
  })
}
