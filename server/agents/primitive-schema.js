export const AGENT_PRIMITIVE_SCHEMA_VERSION = 1

export const AGENT_PRIMITIVE_STATUSES = new Set(['active', 'deprecated', 'disabled'])

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)
const safeId = /^[a-z][a-z0-9_]{1,63}$/
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

const primitive = (id, name, supportedModes, capabilities, defaultRuntimePolicy = {}) => ({
  schemaVersion: AGENT_PRIMITIVE_SCHEMA_VERSION,
  id,
  name,
  version: 1,
  supportedModes,
  capabilityContract: { capabilities },
  defaultRuntimePolicy: {
    maxDelegationDepth: 0,
    requiresDeterministicPermissionEnforcement: true,
    ...defaultRuntimePolicy,
  },
  status: 'active',
})

export const DEFAULT_AGENT_PRIMITIVES = deepFreeze([
  primitive('orchestrator', 'Orchestrator', ['delegate', 'coordinate', 'escalate'], ['decompose-goals', 'delegate-work', 'track-dependencies', 'escalate'], { maxDelegationDepth: 3 }),
  primitive('planner', 'Planner', ['plan'], ['task-decomposition', 'dependency-analysis', 'approval-planning', 'completion-criteria']),
  primitive('researcher', 'Researcher', ['research'], ['retrieve-information', 'analyze-sources', 'collect-evidence', 'structured-research']),
  primitive('analyst', 'Analyst', ['analyze'], ['structured-analysis', 'pattern-detection', 'comparison', 'metrics']),
  primitive('coder', 'Coder', ['implement', 'repair'], ['write-code', 'modify-code', 'run-development-tools', 'repair-defects']),
  primitive('reasoner', 'Reasoner', ['reason', 'review-architecture'], ['complex-analysis', 'strategy-comparison', 'ambiguity-resolution', 'risk-analysis']),
  primitive('writer', 'Writer', ['write'], ['reports', 'documentation', 'copy', 'recommendations']),
  primitive('reviewer', 'Reviewer', ['review_one', 'compare_n', 'merge_best', 'score_only', 'approve_or_reject'], ['evaluate', 'score', 'compare', 'approve-or-request-revision']),
  primitive('verifier', 'Verifier', ['verify'], ['claim-verification', 'citation-validation', 'contradiction-detection', 'consistency-checking']),
  primitive('router', 'Router', ['route'], ['select-path', 'recommend-role', 'recommend-model-policy', 'recommend-tools']),
  primitive('security', 'Security', ['review'], ['code-security', 'dependency-risk', 'permission-review', 'secret-handling-review']),
  primitive('qa_regression', 'QA and Regression', ['test', 'benchmark', 'regression'], ['create-tests', 'run-tests', 'compare-baselines', 'interpret-results']),
  primitive('release_manager', 'Release Manager', ['coordinate-release'], ['confirm-gates', 'prepare-candidate', 'monitor-deployment', 'coordinate-rollback']),
  primitive('quick_worker', 'Quick Worker', ['routine'], ['formatting', 'extraction', 'classification', 'simple-transformation', 'lightweight-summary']),
])

export const AGENT_PRIMITIVE_IDS = new Set(DEFAULT_AGENT_PRIMITIVES.map(value => value.id))

export function normalizeAgentPrimitive(input) {
  if (!plain(input)) throw new Error('agent primitive must be an object')
  if (input.schemaVersion != null && Number(input.schemaVersion) !== AGENT_PRIMITIVE_SCHEMA_VERSION) throw new Error('agent primitive uses an unsupported schema version')
  const id = String(input.id || '').trim().toLowerCase()
  const name = String(input.name || '').trim()
  const version = Number(input.version)
  const supportedModes = Array.isArray(input.supportedModes) ? [...new Set(input.supportedModes.map(value => String(value).trim().toLowerCase()).filter(Boolean))] : []
  const status = String(input.status || 'active').trim().toLowerCase()
  if (!safeId.test(id)) throw new Error('agent primitive has an invalid id')
  if (!name || name.length > 100) throw new Error('agent primitive name is required and must not exceed 100 characters')
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('agent primitive version must be a positive integer')
  if (!supportedModes.length) throw new Error('agent primitive requires at least one supported mode')
  if (!plain(input.capabilityContract)) throw new Error('agent primitive capabilityContract must be an object')
  if (!plain(input.defaultRuntimePolicy)) throw new Error('agent primitive defaultRuntimePolicy must be an object')
  if (!AGENT_PRIMITIVE_STATUSES.has(status)) throw new Error('agent primitive has an invalid status')
  return {
    ...clone(input),
    schemaVersion: AGENT_PRIMITIVE_SCHEMA_VERSION,
    id,
    name,
    version,
    supportedModes,
    capabilityContract: clone(input.capabilityContract),
    defaultRuntimePolicy: clone(input.defaultRuntimePolicy),
    status,
  }
}

export function validateAgentPrimitive(input) {
  return normalizeAgentPrimitive(input)
}

export function primitiveById(id, primitives = DEFAULT_AGENT_PRIMITIVES) {
  const match = primitives.find(value => value?.id === id)
  if (!match) throw new Error(`unknown agent primitive: ${id}`)
  return normalizeAgentPrimitive(match)
}
