import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAgentArchitectureStore } from '../server/agents/architecture-store.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-agent-architecture-'))
const file = path.join(root, 'agent-architecture.json')
const store = createAgentArchitectureStore(file)
const legacy = [
  { id: 'coder', name: 'Coder', role: 'Software Engineer', model: 'local/coder', prompt: 'Build and test.', folder: '/workspace/coder', permissions: 'standard', avatar: '🛠', skills: ['testing'] },
  { id: 'editor', name: 'Editor', role: 'Editor', model: 'local/writer', prompt: 'Edit carefully.', permissions: 'readonly' },
]
let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`  PASS  ${name}`) }

console.log('== durable agent architecture store ==')

test('preview is nondestructive and binds every proposal to an exact legacy snapshot', () => {
  const before = structuredClone(legacy), preview = store.preview(legacy)
  assert.equal(preview.mutationPerformed, false)
  assert.equal(preview.architectureRevision, 0)
  assert.match(preview.proposals[0].legacySnapshotHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(legacy, before)
  assert.equal(fs.existsSync(file), false)
})

const coderPreview = store.preview(legacy).proposals[0]
let coderMigration
test('exact ready migration creates separate role-card and instance records while preserving source evidence', () => {
  coderMigration = store.migrate({ legacyAgents: legacy, legacyAgentId: 'coder', expectedLegacyHash: coderPreview.legacySnapshotHash, expectedRevision: 0, commandId: 'migrate-coder-1' })
  assert.equal(coderMigration.state.revision, 1)
  assert.equal(coderMigration.receipt.primitiveId, 'coder')
  assert.deepEqual(coderMigration.receipt.preservedLegacyConfiguration, legacy[0])
  assert.deepEqual(legacy[0], coderPreview.preservedLegacyConfiguration)
  assert.equal(coderMigration.state.agentInstances.coder.legacyAgentId, 'coder')
  assert.equal(coderMigration.state.roleCards['legacy-coder@1'].status, 'active')
})

test('migration command replay is idempotent and conflicting reuse fails closed', () => {
  const replay = store.migrate({ legacyAgents: legacy, legacyAgentId: 'coder', expectedLegacyHash: coderPreview.legacySnapshotHash, expectedRevision: 0, commandId: 'migrate-coder-1' })
  assert.equal(replay.replayed, true)
  assert.equal(replay.receipt.receiptHash, coderMigration.receipt.receiptHash)
  assert.throws(() => store.migrate({ legacyAgents: legacy, legacyAgentId: 'coder', primitiveId: 'reasoner', expectedLegacyHash: coderPreview.legacySnapshotHash, expectedRevision: 0, commandId: 'migrate-coder-1' }), /different request/)
})

test('stale source and stale store revisions are rejected before mutation', () => {
  assert.throws(() => store.migrate({ legacyAgents: [{ ...legacy[1], prompt: 'changed' }], legacyAgentId: 'editor', primitiveId: 'writer', expectedLegacyHash: store.preview(legacy).proposals[1].legacySnapshotHash, expectedRevision: 1, commandId: 'stale-source' }), /changed after migration preview/)
  const editorPreview = store.preview(legacy).proposals[1]
  assert.throws(() => store.migrate({ legacyAgents: legacy, legacyAgentId: 'editor', primitiveId: 'writer', expectedLegacyHash: editorPreview.legacySnapshotHash, expectedRevision: 0, commandId: 'stale-revision' }), /revision conflict/)
  assert.equal(store.read().revision, 1)
})

let editorMigration
test('ambiguous migration requires an explicit human primitive decision', () => {
  const editorPreview = store.preview(legacy).proposals[1]
  assert.equal(editorPreview.status, 'REVIEW_REQUIRED')
  assert.throws(() => store.migrate({ legacyAgents: legacy, legacyAgentId: 'editor', expectedLegacyHash: editorPreview.legacySnapshotHash, expectedRevision: 1, commandId: 'missing-decision' }), /explicit primitive decision/)
  editorMigration = store.migrate({ legacyAgents: legacy, legacyAgentId: 'editor', primitiveId: 'writer', expectedLegacyHash: editorPreview.legacySnapshotHash, expectedRevision: 1, commandId: 'migrate-editor-writer' })
  assert.equal(editorMigration.receipt.primitiveId, 'writer')
  assert.equal(editorMigration.state.revision, 2)
})

test('workflow assignments are versioned, instance-bound, and resolve without shared mutation', () => {
  const next = store.putAssignment({ id: 'assignment-coder-build', workflowId: 'workflow-a', nodeId: 'build', agentInstanceId: 'coder', roleCardId: 'legacy-coder', roleCardVersion: 1, assignmentInstructions: 'Build this exact component.', overrides: { skills: ['assignment-testing'], permissionProfileId: 'readonly' } }, 2)
  assert.equal(next.revision, 3)
  const resolved = store.resolveAgent('coder', 'assignment-coder-build')
  assert.equal(resolved.primitiveId, 'coder')
  assert.equal(resolved.assignment.nodeId, 'build')
  assert.deepEqual(resolved.skills, ['assignment-testing'])
  resolved.skills.push('mutated')
  assert.deepEqual(store.resolveAgent('coder', 'assignment-coder-build').skills, ['assignment-testing'])
})

test('assignment role mismatches and unknown instances fail closed', () => {
  assert.throws(() => store.putAssignment({ id: 'assignment-invalid', workflowId: 'workflow-a', nodeId: 'review', agentInstanceId: 'coder', roleCardId: 'legacy-editor', roleCardVersion: 1 }, 3), /does not match/)
  assert.throws(() => store.putAssignment({ id: 'assignment-missing', workflowId: 'workflow-a', nodeId: 'review', agentInstanceId: 'missing', roleCardId: 'legacy-editor', roleCardVersion: 1 }, 3), /unavailable/)
  assert.equal(store.read().revision, 3)
})

let rollback
test('rollback is durable, preserves audit records, disables assignments, and restores legacy fallback', () => {
  const preview = store.preview(legacy).proposals[0]
  rollback = store.rollback({ legacyAgents: legacy, legacyAgentId: 'coder', expectedLegacyHash: preview.legacySnapshotHash, expectedRevision: 3, commandId: 'rollback-coder-1' })
  assert.equal(rollback.state.revision, 4)
  assert.equal(rollback.receipt.action, 'rollback')
  assert.equal(rollback.receipt.migratedReceiptHash, coderMigration.receipt.receiptHash)
  assert.deepEqual(rollback.receipt.preservedLegacyConfiguration, legacy[0])
  assert.equal(rollback.state.roleCards['legacy-coder@1'].status, 'disabled')
  assert.equal(rollback.state.agentInstances.coder.currentStatus, 'legacy-fallback')
  assert.equal(rollback.state.workflowAssignments['assignment-coder-build'].status, 'disabled')
  assert.equal(store.resolveAgent('coder'), null)
})

test('rollback replay is idempotent and an exact remigration reactivates retained records', () => {
  const preview = store.preview(legacy).proposals[0]
  const replay = store.rollback({ legacyAgents: legacy, legacyAgentId: 'coder', expectedLegacyHash: preview.legacySnapshotHash, expectedRevision: 3, commandId: 'rollback-coder-1' })
  assert.equal(replay.replayed, true)
  assert.equal(replay.receipt.receiptHash, rollback.receipt.receiptHash)
  assert.throws(() => store.migrate({ legacyAgents: legacy, legacyAgentId: 'coder', primitiveId: 'reasoner', expectedLegacyHash: preview.legacySnapshotHash, expectedRevision: 4, commandId: 'invalid-remigrate-coder' }), /exact immutable migration/)
  assert.equal(store.read().revision, 4)
  const remigration = store.migrate({ legacyAgents: legacy, legacyAgentId: 'coder', expectedLegacyHash: preview.legacySnapshotHash, expectedRevision: 4, commandId: 'remigrate-coder-1' })
  assert.equal(remigration.state.revision, 5)
  assert.equal(remigration.state.roleCards['legacy-coder@1'].status, 'active')
  assert.equal(remigration.state.agentInstances.coder.currentStatus, 'available')
  assert.equal(store.resolveAgent('coder').primitiveId, 'coder')
})

test('corrupt durable state fails closed without replacement', () => {
  const original = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, '{broken')
  assert.throws(() => store.read(), /corrupt/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  fs.writeFileSync(file, original)
  assert.equal(store.read().revision, 5)
})

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
