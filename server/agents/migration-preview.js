import { normalizeRoleCard } from './role-card-schema.js'

export const AGENT_MIGRATION_PREVIEW_VERSION = 1

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const safe = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70)

const EXACT = new Map(Object.entries({
  coder: 'coder', 'python-engineer': 'coder', 'frontend-engineer': 'coder', 'creative-frontend-engineer': 'coder',
  reasoner: 'reasoner', 'software-architect': 'reasoner',
  quick: 'quick_worker', 'quick-worker': 'quick_worker',
  orchestrator: 'orchestrator', 'manager-agent': 'orchestrator', 'chief-operations-officer': 'orchestrator', 'external-intelligence-director': 'orchestrator', 'internal-quality-director': 'orchestrator',
  planner: 'planner', 'research-planner': 'planner',
  researcher: 'researcher', 'web-researcher': 'researcher', 'document-researcher': 'researcher', 'chapter-researcher': 'researcher', 'github-repository-analyst': 'researcher', 'content-and-transcript-analyst': 'researcher',
  analyst: 'analyst', 'runtime-telemetry-analyst': 'analyst', 'agent-performance-analyst': 'analyst', 'workflow-efficiency-analyst': 'analyst', 'model-routing-analyst': 'analyst', 'performance-analyst': 'analyst', 'trend-detector': 'analyst', 'failure-pattern-detector': 'analyst', 'manager-feedback-analyst': 'analyst',
  writer: 'writer', copywriter: 'writer', 'recommendation-writer': 'writer', 'documentation-writer': 'writer',
  reviewer: 'reviewer', critic: 'reviewer', judge: 'reviewer', 'code-reviewer': 'reviewer', 'visual-critic': 'reviewer', 'requirement-coverage-evaluator': 'reviewer', 'relevance-scoring-agent': 'reviewer',
  verifier: 'verifier', 'citation-verifier': 'verifier', 'fact-checker': 'verifier', 'cross-chapter-contradiction-checker': 'verifier',
  router: 'router',
  security: 'security', 'security-inspector': 'security', 'security-engineer': 'security', 'security-and-permission-auditor': 'security',
  'qa-regression': 'qa_regression', 'browser-qa-agent': 'qa_regression', 'benchmark-engineer': 'qa_regression', 'regression-engineer': 'qa_regression',
  'release-manager': 'release_manager', 'release-and-rollback-manager': 'release_manager',
}))

const AMBIGUOUS = new Map(Object.entries({
  editor: ['writer', 'reviewer'],
  refiner: ['reviewer', 'writer'],
  'multi-model': ['router', 'reviewer'],
  'creative-director': ['orchestrator', 'reasoner'],
  'ui-designer': ['reasoner', 'writer'],
  '3d-artist': ['coder', 'reasoner'],
  'motion-director': ['reasoner', 'coder'],
  producer: ['orchestrator', 'writer'],
  specialist: ['reasoner', 'quick_worker'],
  'general-assistant': ['quick_worker', 'reasoner'],
  'chief-technology-officer': ['orchestrator', 'reasoner'],
}))

function identities(agent) {
  return [...new Set([agent.id, agent.name, agent.role].map(safe).filter(Boolean))]
}

function selectPrimitive(agent) {
  const ids = identities(agent)
  for (const id of ids) if (EXACT.has(id)) return { primitiveId: EXACT.get(id), candidates: [EXACT.get(id)], ambiguous: false, matchedBy: id }
  for (const id of ids) if (AMBIGUOUS.has(id)) return { primitiveId: null, candidates: AMBIGUOUS.get(id), ambiguous: true, matchedBy: id }
  return { primitiveId: null, candidates: [], ambiguous: true, matchedBy: null }
}

function reviewerMode(agent) {
  const ids = identities(agent)
  if (ids.includes('judge')) return 'compare_n'
  return ids.some(id => ['critic', 'code-reviewer', 'visual-critic', 'requirement-coverage-evaluator', 'relevance-scoring-agent'].includes(id)) ? 'review_one' : null
}

function proposedRoleCard(agent, primitiveId) {
  const id = `legacy-${safe(agent.id || agent.name) || 'agent'}`
  return normalizeRoleCard({
    id,
    version: 1,
    displayName: String(agent.name || agent.role || agent.id || 'Migrated Agent'),
    primitiveId,
    departmentId: safe(agent.department) || null,
    organizationalClass: 'shared_service',
    description: 'Nondestructive Role Card preview generated from a legacy agent definition.',
    mode: primitiveId === 'reviewer' ? reviewerMode(agent) : null,
    instructionProfile: agent.prompt == null ? null : `migrated-${safe(agent.id || agent.name)}-instructions`,
    modelPolicy: agent.model == null ? null : { legacyModel: clone(agent.model) },
    assignmentScope: null,
    skills: Array.isArray(agent.skills) ? clone(agent.skills) : [],
    tools: Array.isArray(agent.tools) ? clone(agent.tools) : [],
    knowledgeScopes: Array.isArray(agent.knowledgeScopes) ? clone(agent.knowledgeScopes) : [],
    memoryScopes: Array.isArray(agent.memoryScopes) ? clone(agent.memoryScopes) : [],
    permissionProfileId: agent.permissions == null ? null : String(agent.permissions),
    uiIdentity: { avatar: clone(agent.avatar ?? null) },
    companyWorldProfile: {},
    provenance: { type: 'legacy-agent-migration-preview', legacyAgentId: String(agent.id || '') },
    status: 'draft',
  })
}

export function previewLegacyAgentMigration(legacyAgents) {
  if (!Array.isArray(legacyAgents)) throw new Error('legacy agents must be an array')
  const original = clone(legacyAgents)
  const seen = new Set()
  const proposals = original.map(agent => {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error('legacy agent must be an object')
    const legacyAgentId = String(agent.id || '')
    if (!legacyAgentId || seen.has(legacyAgentId)) throw new Error('legacy agent IDs must be present and unique')
    seen.add(legacyAgentId)
    const selection = selectPrimitive(agent)
    const ambiguityReasons = selection.ambiguous ? [selection.candidates.length ? `role matches multiple primitives: ${selection.candidates.join(', ')}` : 'no safe role-to-primitive mapping is known'] : []
    return {
      legacyAgentId,
      status: selection.ambiguous ? 'REVIEW_REQUIRED' : 'READY',
      confidence: selection.ambiguous ? 'low' : 'high',
      matchedBy: selection.matchedBy,
      primitiveId: selection.primitiveId,
      primitiveCandidates: clone(selection.candidates),
      ambiguityReasons,
      proposedRoleCard: selection.primitiveId ? proposedRoleCard(agent, selection.primitiveId) : null,
      proposedInstructionProfile: selection.primitiveId && agent.prompt != null ? {
        id: `migrated-${safe(agent.id || agent.name)}-instructions`,
        version: 1,
        instructions: clone(agent.prompt),
        provenance: { type: 'legacy-agent-migration-preview', legacyAgentId },
      } : null,
      proposedAgentInstance: selection.primitiveId ? {
        id: legacyAgentId,
        roleCardId: `legacy-${safe(agent.id || agent.name) || 'agent'}`,
        roleCardVersion: 1,
        projectId: null,
        currentAssignment: null,
        currentModel: clone(agent.model ?? null),
        currentStatus: 'migration-preview',
        runtimeState: {},
        legacyCompatibility: { folder: clone(agent.folder ?? null), legacyAgentId },
      } : null,
      preservedLegacyConfiguration: clone(agent),
    }
  })
  return {
    schemaVersion: AGENT_MIGRATION_PREVIEW_VERSION,
    mode: 'preview-only',
    mutationPerformed: false,
    summary: {
      total: proposals.length,
      ready: proposals.filter(value => value.status === 'READY').length,
      reviewRequired: proposals.filter(value => value.status === 'REVIEW_REQUIRED').length,
    },
    proposals,
  }
}
