import assert from 'node:assert/strict'
import { DEFAULT_AGENT_PRIMITIVES, normalizeAgentPrimitive } from '../server/agents/primitive-schema.js'
import { normalizeRoleCard } from '../server/agents/role-card-schema.js'
import { resolveRoleCard } from '../server/agents/resolver.js'
import { previewLegacyAgentMigration } from '../server/agents/migration-preview.js'

let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`ok ${passed} - ${name}`) }

test('the foundation exposes exactly fourteen distinct validated primitives', () => {
  assert.equal(DEFAULT_AGENT_PRIMITIVES.length, 14)
  assert.equal(new Set(DEFAULT_AGENT_PRIMITIVES.map(value => value.id)).size, 14)
  for (const primitive of DEFAULT_AGENT_PRIMITIVES) assert.equal(normalizeAgentPrimitive(primitive).schemaVersion, 1)
  assert.deepEqual(DEFAULT_AGENT_PRIMITIVES.map(value => value.id), ['orchestrator', 'planner', 'researcher', 'analyst', 'coder', 'reasoner', 'writer', 'reviewer', 'verifier', 'router', 'security', 'qa_regression', 'release_manager', 'quick_worker'])
  assert(Object.isFrozen(DEFAULT_AGENT_PRIMITIVES[0].capabilityContract.capabilities))
})

test('primitive validation rejects future schemas and malformed runtime contracts', () => {
  assert.throws(() => normalizeAgentPrimitive({ ...DEFAULT_AGENT_PRIMITIVES[0], schemaVersion: 2 }), /unsupported schema/)
  assert.throws(() => normalizeAgentPrimitive({ ...DEFAULT_AGENT_PRIMITIVES[0], capabilityContract: [] }), /capabilityContract/)
})

const visualCritic = normalizeRoleCard({
  id: 'visual-critic', version: 3, displayName: 'Visual Critic', primitiveId: 'reviewer', departmentId: 'creative-studio', organizationalClass: 'domain_specialist', mode: 'review_one',
  instructionProfile: 'visual-critic-v3', modelPolicy: { id: 'balanced-local' }, skills: ['visual-hierarchy'], tools: ['browser-screenshot'], knowledgeScopes: ['approved-concept'], memoryScopes: ['visual-critic-memory'], permissionProfileId: 'creative-review-readonly', rubric: { id: 'visual-quality', version: 3 }, uiIdentity: { avatar: 'creative-reviewer' }, companyWorldProfile: { workspaceType: 'review-studio' }, provenance: { source: 'test' }, status: 'active',
})

test('role cards are versioned, explicit, and preserve organizational identity', () => {
  assert.equal(visualCritic.primitiveId, 'reviewer')
  assert.equal(visualCritic.version, 3)
  assert.equal(visualCritic.organizationalClass, 'domain_specialist')
  assert.equal(visualCritic.uiIdentity.avatar, 'creative-reviewer')
  assert.equal(Object.hasOwn(visualCritic, 'role'), false)
})

test('role-card validation rejects unknown primitives, invalid classes, and invalid reviewer modes', () => {
  assert.throws(() => normalizeRoleCard({ ...visualCritic, primitiveId: 'visual_critic' }), /unknown primitive/)
  assert.throws(() => normalizeRoleCard({ ...visualCritic, organizationalClass: 'executive' }), /organizationalClass/)
  assert.throws(() => normalizeRoleCard({ ...visualCritic, mode: 'critic_loop' }), /invalid mode/)
  assert.throws(() => normalizeRoleCard({ ...visualCritic, primitiveId: 'writer', mode: 'review_one' }), /only be used/)
})

test('resolver keeps primitive, role card, instance, and assignment identities separate', () => {
  const runtime = resolveRoleCard(visualCritic, { agentInstance: { id: 'employee-7', roleCardId: 'visual-critic', roleCardVersion: 3, runtimeState: { status: 'ready' } }, workflowAssignment: { nodeId: 'review-node', agentInstanceId: 'employee-7', roleCardId: 'visual-critic', assignmentInstructions: 'Review this artifact.' } })
  assert.equal(runtime.primitiveId, 'reviewer')
  assert.equal(runtime.roleCardId, 'visual-critic')
  assert.equal(runtime.agentInstanceId, 'employee-7')
  assert.equal(runtime.assignment.nodeId, 'review-node')
})

test('two roles sharing Reviewer do not leak instructions, memory, tools, models, rubrics, or avatars', () => {
  const codeReviewer = normalizeRoleCard({ ...visualCritic, id: 'code-reviewer', version: 2, displayName: 'Code Reviewer', departmentId: 'engineering', instructionProfile: 'code-review-v2', modelPolicy: { id: 'code-local' }, skills: ['code-correctness'], tools: ['source-reader'], knowledgeScopes: ['repository'], memoryScopes: ['code-reviewer-memory'], permissionProfileId: 'source-readonly', rubric: { id: 'code-review', version: 2 }, uiIdentity: { avatar: 'code-reviewer' } })
  const visual = resolveRoleCard(visualCritic)
  const code = resolveRoleCard(codeReviewer)
  visual.skills.push('mutated')
  visual.memoryScopes.push('foreign-memory')
  visual.modelPolicy.id = 'mutated-model'
  visual.rubric.id = 'mutated-rubric'
  visual.uiIdentity.avatar = 'mutated-avatar'
  assert.deepEqual(code.skills, ['code-correctness'])
  assert.deepEqual(code.memoryScopes, ['code-reviewer-memory'])
  assert.equal(code.modelPolicy.id, 'code-local')
  assert.equal(code.rubric.id, 'code-review')
  assert.equal(code.uiIdentity.avatar, 'code-reviewer')
  assert.deepEqual(visualCritic.skills, ['visual-hierarchy'])
})

test('resolver permits explicit scoped overrides without changing the Role Card', () => {
  const runtime = resolveRoleCard(visualCritic, { overrides: { modelPolicy: { id: 'premium-local' }, skills: ['visual-hierarchy', 'motion-critique'] } })
  assert.equal(runtime.modelPolicy.id, 'premium-local')
  assert.equal(runtime.skills.length, 2)
  assert.equal(visualCritic.modelPolicy.id, 'balanced-local')
  assert.throws(() => resolveRoleCard(visualCritic, { overrides: { primitiveId: 'coder' } }), /unsupported role-card overrides/)
})

test('workflow assignments carry explicit isolated overrides', () => {
  const runtime = resolveRoleCard(visualCritic, { workflowAssignment: { nodeId: 'review-node', roleCardId: 'visual-critic', overrides: { skills: ['assignment-only'], permissionProfileId: 'assignment-readonly' } } })
  runtime.assignment.overrides.skills.push('mutated')
  assert.deepEqual(runtime.skills, ['assignment-only'])
  assert.deepEqual(visualCritic.skills, ['visual-hierarchy'])
  assert.throws(() => resolveRoleCard(visualCritic, { workflowAssignment: { overrides: { primitiveId: 'coder' } } }), /unsupported role-card overrides/)
})

test('migration preview preserves legacy IDs and configuration without mutating input', () => {
  const legacy = [{ id: 'coder', name: 'Coder', avatar: 'tool', model: 'local/coder', prompt: 'Engineer', permissions: 'full', skills: ['python'], folder: '/workspace/coder' }]
  const before = structuredClone(legacy)
  const preview = previewLegacyAgentMigration(legacy)
  assert.deepEqual(legacy, before)
  assert.equal(preview.mutationPerformed, false)
  assert.equal(preview.proposals[0].proposedAgentInstance.id, 'coder')
  assert.equal(preview.proposals[0].primitiveId, 'coder')
  assert.deepEqual(preview.proposals[0].preservedLegacyConfiguration, before[0])
  assert.equal(preview.proposals[0].proposedRoleCard.permissionProfileId, 'full')
  assert.equal(preview.proposals[0].proposedInstructionProfile.instructions, 'Engineer')
})

test('migration preview maps known consolidated roles and reviewer behavior', () => {
  const preview = previewLegacyAgentMigration([{ id: 'visual-review', name: 'Visual Critic' }, { id: 'judge-one', role: 'Judge' }, { id: 'fact', name: 'Fact Checker' }])
  assert.deepEqual(preview.proposals.map(value => value.primitiveId), ['reviewer', 'reviewer', 'verifier'])
  assert.equal(preview.proposals[0].proposedRoleCard.mode, 'review_one')
  assert.equal(preview.proposals[1].proposedRoleCard.mode, 'compare_n')
})

test('ambiguous and unknown legacy roles require review instead of silent guessing', () => {
  const preview = previewLegacyAgentMigration([{ id: 'designer', name: 'UI Designer' }, { id: 'mystery', name: 'Unmapped Wizard' }])
  assert.equal(preview.summary.reviewRequired, 2)
  assert.deepEqual(preview.proposals[0].primitiveCandidates, ['reasoner', 'writer'])
  assert.equal(preview.proposals[0].proposedRoleCard, null)
  assert.match(preview.proposals[1].ambiguityReasons[0], /no safe/)
})

test('migration preview rejects duplicate or missing legacy identities', () => {
  assert.throws(() => previewLegacyAgentMigration([{ id: 'same' }, { id: 'same' }]), /unique/)
  assert.throws(() => previewLegacyAgentMigration([{ name: 'No ID' }]), /present/)
})

console.log(`${passed}/12 agent primitive and Role Card checks passed`)
