import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  TASK_TYPES, validateRepositoryPattern, validateTaskPacket,
} from '../server/collaboration/task-schema.js'
import {
  assertOwnershipAvailable, detectOwnershipConflicts, lockedResourcesForPatterns, patternsOverlap,
} from '../server/collaboration/conflict-detector.js'
import {
  assertClaudeModelPolicy, classifyClaudeFailure, extractClaudeModelProvenance,
  extractNormalizedResult, normalizeClaudeResult, parseClaudeStreamJson, redactSensitive,
} from '../server/collaboration/result-parser.js'
import {
  boundedBackoffMs, classifyCapacityError, createCapacityState,
  resolveModelPolicy, updateCapacityState,
} from '../server/collaboration/capacity-manager.js'
import { collaborationContractPack } from './fixtures/collaboration-contract-pack.mjs'

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  PASS  ${name}`)
}

const baseTask = (overrides = {}) => ({
  schemaVersion: 3,
  taskId: 'claude-ui-pilot',
  title: 'Implement UI pilot',
  status: 'QUEUED',
  phase: 'PHASE D',
  priority: 50,
  createdBy: 'codex',
  assignedWorker: 'claude-fable',
  taskType: 'IMPLEMENTATION',
  objective: 'Implement one isolated UI component with deterministic tests.',
  background: 'Use established component conventions and remain inside the assigned scope.',
  acceptanceCriteria: ['Component renders its supplied task title.', 'Focused tests pass.'],
  filesAllowed: ['web/src/components/Pilot/**'],
  filesForbidden: ['server/**'],
  readOnlyContextFiles: ['docs/MASTER_PLAN.md'],
  dependencies: [],
  requiredTests: ['node scripts/pilot-tests.mjs'],
  permissionProfile: 'WORKTREE_IMPLEMENTATION',
  modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' },
  maxTurns: 40,
  timeoutSeconds: 3600,
  allowSubagents: true,
  allowNetwork: false,
  requiresCommit: true,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
  contractPack: collaborationContractPack({ baseSha: 'a'.repeat(40), path: 'docs/MASTER_PLAN.md', sha256: 'b'.repeat(64), scenarioIds: ['COLLAB-01'], maxChangedFiles: 25 }),
  ...overrides,
})

console.log('== collaboration task schema ==')

await test('accepts and freezes a bounded modifying task', () => {
  const result = validateTaskPacket(baseTask())
  assert.equal(result.taskId, 'claude-ui-pilot')
  assert(Object.isFrozen(result))
})

await test('defines every required task type', () => {
  for (const type of ['READ_ONLY_AUDIT', 'ARCHITECTURE_REVIEW', 'IMPLEMENTATION', 'UX_IMPLEMENTATION', 'TEST_CREATION', 'BUG_REPAIR', 'SECURITY_REVIEW', 'PERFORMANCE_REVIEW', 'VISUAL_REVIEW', 'DOCUMENTATION', 'REGRESSION_ANALYSIS']) assert(TASK_TYPES.includes(type))
})

await test('accepts a correctly restricted read-only task', () => {
  const result = validateTaskPacket(baseTask({
    taskType: 'SECURITY_REVIEW', permissionProfile: 'READ_ONLY_ADVISOR',
    filesAllowed: [], requiresCommit: false,
    contractPack: { ...baseTask().contractPack, maxChangedFiles: 0 },
    expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: false, risks: true },
  }))
  assert.equal(result.permissionProfile, 'READ_ONLY_ADVISOR')
})

await test('rejects future versions, unknown fields, and numeric bounds', () => {
  assert.throws(() => validateTaskPacket(baseTask({ schemaVersion: 4 })), /schemaVersion/)
  assert.throws(() => validateTaskPacket({ ...baseTask(), surprise: true }), /unsupported field/)
  assert.throws(() => validateTaskPacket(baseTask({ maxTurns: 101 })), /maxTurns/)
  assert.throws(() => validateTaskPacket(baseTask({ timeoutSeconds: 10 })), /timeoutSeconds/)
  assert.throws(() => validateTaskPacket(baseTask({ priority: 1.5 })), /priority/)
})

await test('reads legacy packets but requires complete authority contracts for v3', () => {
  const { contractPack, ...legacy } = baseTask({ schemaVersion: 1 })
  assert.equal(validateTaskPacket(legacy).schemaVersion, 1)
  assert.throws(() => validateTaskPacket({ ...legacy, contractPack }), /legacy schemaVersion 1/)
  assert.throws(() => validateTaskPacket({ ...baseTask(), contractPack: undefined }), /requires contractPack/)
})

await test('rejects traversal, absolute, secret, git, and backslash paths', () => {
  for (const path of ['../outside.js', 'safe/../outside.js', '/tmp/file', '.git/config', '.env.production', 'secrets/key.txt', 'server\\index.js', 'web//file.js', '{server,web}/**']) {
    assert.throws(() => validateRepositoryPattern(path), /repository-relative|protected|traversal|POSIX|normalized|ambiguous/)
  }
})

await test('rejects semantic contradictions and unsafe authority', () => {
  assert.throws(() => validateTaskPacket(baseTask({ dependencies: ['claude-ui-pilot'] })), /depend on itself/)
  assert.throws(() => validateTaskPacket(baseTask({ filesForbidden: ['web/src/components/**'] })), /scopes conflict/)
  assert.throws(() => validateTaskPacket(baseTask({ allowNetwork: true })), /network access/)
  assert.throws(() => validateTaskPacket(baseTask({ filesAllowed: ['**'] })), /repository-wide wildcard/)
  assert.throws(() => validateTaskPacket(baseTask({ requiresCommit: false })), /requires an isolated commit/)
  assert.throws(() => validateTaskPacket(baseTask({ permissionProfile: 'READ_ONLY_ADVISOR' })), /WORKTREE_IMPLEMENTATION/)
  assert.throws(() => validateTaskPacket(baseTask({ taskType: 'READ_ONLY_AUDIT' })), /READ_ONLY_ADVISOR/)
})

await test('rejects duplicate arrays and invalid fallback policy', () => {
  assert.throws(() => validateTaskPacket(baseTask({ requiredTests: ['node test.mjs', 'node test.mjs'] })), /duplicates/)
  assert.throws(() => validateTaskPacket(baseTask({ modelPolicy: { primary: 'fable', fallback: 'fable', effort: 'high' } })), /fallback/)
  assert.throws(() => validateTaskPacket(baseTask({ modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'ultracode' } })), /effort/)
})

console.log('\n== file ownership ==')

await test('detects exact, nested, and conservative wildcard overlap', () => {
  assert(patternsOverlap('web/src/components/**', 'web/src/components/Pilot/index.jsx'))
  assert(patternsOverlap('server/**', 'server/collaboration/**'))
  assert(patternsOverlap('**/*.js', 'web/a.js'))
  assert.equal(patternsOverlap('server/**', 'web/**'), false)
})

await test('reports overlapping modifying reservations', () => {
  const conflicts = detectOwnershipConflicts(
    { taskId: 'next', patterns: ['web/src/components/Pilot/**'] },
    [{ taskId: 'active', patterns: ['web/src/components/**'] }],
  )
  assert(conflicts.some(item => item.type === 'FILE_SCOPE_OVERLAP' && item.taskId === 'active'))
  assert.throws(() => assertOwnershipAvailable({ taskId: 'next', patterns: ['server/**'] }, [{ taskId: 'active', patterns: ['server/collaboration/**'] }]), error => error.code === 'FILE_OWNERSHIP_CONFLICT')
})

await test('permits independent or read-only work and ignores released locks', () => {
  assert.deepEqual(detectOwnershipConflicts({ taskId: 'web', patterns: ['web/**'] }, [{ taskId: 'server', patterns: ['server/**'] }]), [])
  assert.deepEqual(detectOwnershipConflicts({ taskId: 'review', patterns: ['server/**'], readOnly: true }, [{ taskId: 'server', patterns: ['server/**'] }]), [])
  assert.deepEqual(detectOwnershipConflicts({ taskId: 'next', patterns: ['server/**'] }, [{ taskId: 'done', patterns: ['server/**'], released: true }]), [])
})

await test('identifies global singleton resources', () => {
  assert(lockedResourcesForPatterns(['package-lock.json']).includes('package-lock.json'))
  assert(lockedResourcesForPatterns(['server/migrations/**']).includes('server/migrations/**'))
  assert(lockedResourcesForPatterns(['web/src/WorkflowStudio.tsx']).includes('web/src/WorkflowStudio.tsx'))
})

console.log('\n== Claude result parsing ==')

await test('parses a success fixture and validates commit evidence', async () => {
  const raw = await readFile(new URL('./fixtures/collaboration/claude-success.jsonl', import.meta.url), 'utf8')
  const parsed = extractNormalizedResult(raw, { requiresCommit: true })
  assert.equal(parsed.valid, true)
  assert.equal(parsed.result.status, 'COMPLETED')
  assert.match(parsed.result.commitSha, /^[a-f0-9]{40}$/)
  assert.equal(parsed.result.tests[0].status, 'PASSED')
})

await test('preserves malformed-line evidence without trusting it', async () => {
  const raw = await readFile(new URL('./fixtures/collaboration/claude-malformed.jsonl', import.meta.url), 'utf8')
  const parsed = parseClaudeStreamJson(raw)
  assert.equal(parsed.valid, false)
  assert.equal(parsed.malformed[0].line, 2)
  assert.equal(parsed.failureClass, 'PERMISSION_ERROR')
  assert.throws(() => extractNormalizedResult(raw), error => error.code === 'MALFORMED_WORKER_OUTPUT')
})

await test('classifies auth, rate, usage, model, permission, and service failures', () => {
  assert.equal(classifyClaudeFailure('Please run claude auth login'), 'AUTH_REQUIRED')
  assert.equal(classifyClaudeFailure('429 rate limit exceeded'), 'RATE_LIMITED')
  assert.equal(classifyClaudeFailure('usage limit reached'), 'USAGE_LIMIT_REACHED')
  assert.equal(classifyClaudeFailure('unknown model fable'), 'MODEL_UNAVAILABLE')
  assert.equal(classifyClaudeFailure('tool Bash denied: permission denied'), 'PERMISSION_ERROR')
  assert.equal(classifyClaudeFailure('503 service unavailable'), 'SERVICE_UNAVAILABLE')
})

await test('redacts secret keys and secret-bearing prose recursively', () => {
  const redacted = redactSensitive({ token: 'top-secret', nested: { message: 'Bearer abc.def.ghi', passwordHint: 'never' } })
  assert.equal(redacted.token, '[REDACTED]')
  assert.equal(redacted.nested.passwordHint, '[REDACTED]')
  assert(!JSON.stringify(redacted).includes('abc.def.ghi'))
  assert.equal(redactSensitive('claude-readonly-pilot-001'), 'claude-readonly-pilot-001')
  assert.equal(redactSensitive('sk-ant-abcdefghijklmnopqrstuvwxyz'), 'sk=[REDACTED]')
})

await test('rejects missing commit, contradictory status, and malformed tests', () => {
  const valid = { status: 'COMPLETED', summary: 'done', filesChanged: [], tests: [], risks: [], recommendedAction: 'INTEGRATE' }
  assert.throws(() => normalizeClaudeResult(valid, { requiresCommit: true }), /missing commitSha/)
  assert.throws(() => normalizeClaudeResult({ ...valid, commitSha: 'abcdef1', recommendedAction: 'DISCARD' }), /recommend integration/)
  assert.throws(() => normalizeClaudeResult({ ...valid, commitSha: 'abcdef1', tests: [{ command: 'test', status: 'FAILED' }] }), /failed tests/)
  assert.throws(() => normalizeClaudeResult({ ...valid, commitSha: 'nope' }), /invalid commitSha/)
})

await test('extracts actual Claude model provenance from structured events', () => {
  const provenance = extractClaudeModelProvenance([{ type: 'system', model: 'claude-fable-5' }, { usage: { model_name: 'claude-fable-5' } }])
  assert.deepEqual(provenance.reportedModels, ['claude-fable-5'])
  assert.equal(provenance.actualModel, 'claude-fable-5')
  assert.equal(assertClaudeModelPolicy({ requestedModel: 'fable', events: [{ model: 'claude-fable-5' }] }).fallbackUsed, false)
})

await test('fails closed when provenance is absent or an unapproved fallback appears', () => {
  assert.throws(() => assertClaudeModelPolicy({ requestedModel: 'fable', events: [] }), error => error.code === 'MODEL_PROVENANCE_MISSING')
  assert.throws(() => assertClaudeModelPolicy({ requestedModel: 'fable', events: [{ model: 'claude-opus-4-6' }] }), error => error.code === 'MODEL_FALLBACK_REJECTED')
  const allowed = assertClaudeModelPolicy({ requestedModel: 'fable', fallbackModel: 'sonnet', requirePrimary: false, events: [{ model: 'claude-sonnet-4-5' }] })
  assert.equal(allowed.fallbackUsed, true)
})

console.log('\n== independent capacity ==')

await test('classifies capacity errors without conflating permission failures', () => {
  assert.equal(classifyCapacityError(new Error('429 too many requests')), 'RATE_LIMITED')
  assert.equal(classifyCapacityError(new Error('usage limit reached')), 'USAGE_LIMIT_REACHED')
  assert.equal(classifyCapacityError(new Error('authentication required')), 'AUTH_REQUIRED')
  assert.equal(classifyCapacityError(new Error('unknown model fable')), 'MODEL_UNAVAILABLE')
  assert.equal(classifyCapacityError(new Error('503 temporarily unavailable')), 'SERVICE_UNAVAILABLE')
  assert.equal(classifyCapacityError(new Error('permission denied')), null)
})

await test('uses deterministic bounded exponential backoff', () => {
  assert.equal(boundedBackoffMs(1, { baseMs: 1_000, maxMs: 8_000 }), 1_000)
  assert.equal(boundedBackoffMs(4, { baseMs: 1_000, maxMs: 8_000 }), 8_000)
  assert.equal(boundedBackoffMs(20, { baseMs: 1_000, maxMs: 8_000 }), 8_000)
})

await test('updates Claude independently from Codex and resets success state', () => {
  const initial = createCapacityState(1_000)
  const limited = updateCapacityState(initial, 'claude', new Error('429 rate limit'), { now: 2_000, backoff: { baseMs: 1_000 } })
  assert.equal(limited.claude.status, 'RATE_LIMITED')
  assert.equal(limited.claude.retryAt, 3_000)
  assert.equal(limited.codex.status, 'AVAILABLE')
  const restored = updateCapacityState(limited, 'claude', null, { now: 4_000 })
  assert.equal(restored.claude.status, 'AVAILABLE')
  assert.equal(restored.claude.attempts, 0)
})

await test('makes fallback visible and refuses unsafe auth fallback', () => {
  const fallback = resolveModelPolicy({ requestedModel: 'fable', fallbackModel: 'sonnet', capacityStatus: 'MODEL_UNAVAILABLE', fallbackPolicy: 'FALL_BACK', attempts: 1 })
  assert.deepEqual({ actualModel: fallback.actualModel, fallbackUsed: fallback.fallbackUsed, fallbackReason: fallback.fallbackReason }, { actualModel: 'sonnet', fallbackUsed: true, fallbackReason: 'MODEL_UNAVAILABLE' })
  const auth = resolveModelPolicy({ requestedModel: 'fable', fallbackModel: 'sonnet', capacityStatus: 'AUTH_REQUIRED', fallbackPolicy: 'FALL_BACK' })
  assert.equal(auth.actualModel, null)
  assert.equal(auth.action, 'MARK_BLOCKED')
  const wait = resolveModelPolicy({ requestedModel: 'fable', capacityStatus: 'RATE_LIMITED', fallbackPolicy: 'WAIT_FOR_PRIMARY', retryAt: 123 })
  assert.equal(wait.action, 'WAIT_FOR_PRIMARY')
  assert.equal(wait.retryAt, 123)
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
