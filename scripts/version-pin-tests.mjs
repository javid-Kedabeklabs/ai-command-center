import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeWorkflowDocuments, migrateWorkflowDocument } from '../server/workflows/schema.js'
import { listWorkflowVersions, resolvePinnedWorkflowVersion, saveWorkflowVersion } from '../server/workflows/versions.js'
import { advanceSubworkflowPin, currentWorkflowVersion, extractedSubworkflowData } from '../web/src/workflowVersionHelpers.ts'

let passed = 0
const test = (name, fn) => {
  try { fn(); passed += 1; console.log(`ok ${passed} - ${name}`) }
  catch (error) { console.error(`not ok - ${name}`); throw error }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-version-pins-'))
const workflow = (id, label) => migrateWorkflowDocument({ id, name: id, nodes: [{ id: 'out', type: 'output', position: { x: 0, y: 0 }, data: { label, extension: { retained: true } } }], edges: [] })

try {
  const first = saveWorkflowVersion(root, workflow('child', 'first'), { now: Date.UTC(2026, 0, 1) })
  const second = saveWorkflowVersion(root, workflow('child', 'second'), { now: Date.UTC(2026, 0, 2) })

  test('extraction records the real child snapshot without dropping node data', () => {
    const data = extractedSubworkflowData('Reusable child', 'child', first)
    assert.deepEqual(data, { label: 'Reusable child', workflowId: 'child', workflowVersion: first.id })
  })

  test('a pin resolves the original definition after the child gains a newer version', () => {
    assert.equal(listWorkflowVersions(root, 'child')[0].id, second.id)
    assert.equal(resolvePinnedWorkflowVersion(root, 'child', first.id).workflow.nodes[0].data.label, 'first')
    assert.equal(resolvePinnedWorkflowVersion(root, 'child', second.id).workflow.nodes[0].data.label, 'second')
  })

  test('missing pins fail with an actionable explicit-update error', () => {
    assert.throws(() => resolvePinnedWorkflowVersion(root, 'child', '2026-missing-deadbeef'), error => error.code === 'MISSING_WORKFLOW_VERSION' && /explicitly update its pin/.test(error.message))
  })

  test('mismatched or tampered snapshot records are rejected', () => {
    const file = path.join(root, 'child', `${first.id}.json`)
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...record, workflow: { ...record.workflow, id: 'different-child' } }, null, 2))
    assert.throws(() => resolvePinnedWorkflowVersion(root, 'child', first.id), error => error.code === 'MISMATCHED_WORKFLOW_VERSION' && /does not match/.test(error.message))
    fs.writeFileSync(file, JSON.stringify(record, null, 2))
  })

  test('explicit pin advancement preserves extension fields and changes only the pin', () => {
    const before = { label: 'Child', workflowId: 'child', workflowVersion: first.id, extension: { owner: 'user' } }
    const after = advanceSubworkflowPin(before, second)
    assert.equal(after.workflowVersion, second.id)
    assert.deepEqual(after.extension, { owner: 'user' })
    assert.equal(before.workflowVersion, first.id)
  })

  test('explicit updates select the child current snapshot even after an older restore', () => {
    const selected = currentWorkflowVersion([{ ...second, current: false }, { ...first, current: true }])
    assert.equal(selected.id, first.id)
  })

  test('canonical save merging preserves pins and unknown subworkflow fields', () => {
    const existing = { id: 'parent', name: 'Parent', nodes: [{ id: 'sub', type: 'subworkflow', data: { label: 'Old', workflowId: 'child', workflowVersion: first.id, extension: { retained: true } } }], edges: [] }
    const incoming = { id: 'parent', name: 'Parent', nodes: [{ id: 'sub', type: 'subworkflow', data: { label: 'New', workflowVersion: second.id } }], edges: [] }
    const merged = migrateWorkflowDocument(mergeWorkflowDocuments(existing, incoming))
    assert.equal(merged.nodes[0].data.workflowId, 'child')
    assert.equal(merged.nodes[0].data.workflowVersion, second.id)
    assert.deepEqual(merged.nodes[0].data.extension, { retained: true })
  })

  test('retention never prunes a version still pinned by a parent', () => {
    const retainedRoot = path.join(root, 'retention')
    const old = saveWorkflowVersion(retainedRoot, workflow('retained-child', 'old'), { retention: 1, now: Date.UTC(2026, 1, 1) })
    saveWorkflowVersion(retainedRoot, workflow('retained-child', 'new'), { retention: 1, preserveIds: [old.id], now: Date.UTC(2026, 1, 2) })
    assert.equal(resolvePinnedWorkflowVersion(retainedRoot, 'retained-child', old.id).workflow.nodes[0].data.label, 'old')
  })
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(`${passed}/8 version-pin checks passed`)
