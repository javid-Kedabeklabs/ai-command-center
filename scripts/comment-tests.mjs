import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeWorkflowDocuments, migrateWorkflowDocument } from '../server/workflows/schema.js'
import { commentValidationErrors } from '../server/workflows/comments.js'
import { resolvePinnedWorkflowVersion, saveWorkflowVersion } from '../server/workflows/versions.js'
import { commentAnchorStatus, isExecutableCanvasItem, moveWorkflowComment, visibleWorkflowComments } from '../web/src/workflowCommentHelpers.ts'
import { recursiveMemberNodeIds } from '../web/src/workflowGroupHelpers.ts'

let passed = 0
const test = (name, fn) => {
  try { fn(); passed += 1; console.log(`ok ${passed} - ${name}`) }
  catch (error) { console.error(`not ok - ${name}`); throw error }
}

const base = { id: 'notes', name: 'Notes', nodes: [{ id: 'a', type: 'agent', position: { x: 1, y: 2 }, data: {} }], edges: [], groups: [{ id: 'g', nodeIds: ['a'] }] }

test('legacy workflows migrate with an empty additive comment collection', () => {
  const migrated = migrateWorkflowDocument(base)
  assert.deepEqual(migrated.comments, [])
  assert.deepEqual(migrateWorkflowDocument(migrated), migrated)
})

test('comments normalize safely and retain unknown fields', () => {
  const migrated = migrateWorkflowDocument({ ...base, comments: [{ id: 'review-1', text: 'Check this', position: { x: 10, y: 20, zoom: 2 }, anchor: { type: 'node', id: 'a', color: 'amber' }, resolved: false, extension: { owner: 'Ada' } }] })
  assert.deepEqual(migrated.comments[0].extension, { owner: 'Ada' })
  assert.equal(migrated.comments[0].position.zoom, 2)
  assert.equal(migrated.comments[0].anchor.color, 'amber')
  assert.deepEqual(commentValidationErrors(migrated.comments), [])
})

test('save merging preserves comment extensions while accepting edits', () => {
  const existing = migrateWorkflowDocument({ ...base, comments: [{ id: 'c1', text: 'Before', position: { x: 1, y: 2 }, resolved: false, extension: true }] })
  const merged = migrateWorkflowDocument(mergeWorkflowDocuments(existing, { ...base, comments: [{ id: 'c1', text: 'After', position: { x: 5, y: 6 }, resolved: true }] }))
  assert.equal(merged.comments[0].extension, true)
  assert.equal(merged.comments[0].text, 'After')
  assert.equal(merged.comments[0].resolved, true)
})

test('anchors distinguish valid, absent, and missing targets without rewriting references', () => {
  const targets = [{ id: 'a', type: 'node', label: 'Agent' }]
  assert.equal(commentAnchorStatus({ id: 'c', text: 'x', position: { x: 0, y: 0 }, resolved: false, anchor: { type: 'node', id: 'a' } }, targets).state, 'anchored')
  const missing = { id: 'c', text: 'x', position: { x: 0, y: 0 }, resolved: false, anchor: { type: 'group', id: 'gone' } }
  assert.equal(commentAnchorStatus(missing, targets).state, 'missing')
  assert.equal(missing.anchor.id, 'gone')
  assert.equal(commentAnchorStatus({ ...missing, anchor: null }, targets).state, 'none')
})

test('moving a comment preserves its semantic anchor and extensions', () => {
  const comment = { id: 'c', text: 'x', position: { x: 0, y: 0 }, resolved: false, anchor: { type: 'group', id: 'g' }, extension: 7 }
  const moved = moveWorkflowComment(comment, { x: 90, y: 80 })
  assert.deepEqual(moved.position, { x: 90, y: 80 })
  assert.deepEqual(moved.anchor, comment.anchor)
  assert.equal(moved.extension, 7)
})

test('resolved comment visibility is explicit and reversible', () => {
  const comments = [{ id: 'open', text: 'x', position: { x: 0, y: 0 }, resolved: false }, { id: 'done', text: 'y', position: { x: 1, y: 1 }, resolved: true }]
  assert.deepEqual(visibleWorkflowComments(comments, false).map(item => item.id), ['open'])
  assert.deepEqual(visibleWorkflowComments(comments, true).map(item => item.id), ['open', 'done'])
})

test('comments are excluded from executable canvas and recursive group membership', () => {
  const items = [{ id: 'g', position: { x: 0, y: 0 }, data: { ntype: '__group' } }, { id: 'a', parentId: 'g', position: { x: 0, y: 0 }, data: { ntype: 'agent' } }, { id: 'c', parentId: 'g', position: { x: 0, y: 0 }, data: { ntype: '__comment' } }]
  assert.equal(isExecutableCanvasItem(items[2]), false)
  assert.deepEqual(recursiveMemberNodeIds(items, 'g'), ['a'])
})

test('invalid and duplicate comment identities fail deterministic validation', () => {
  const errors = commentValidationErrors([{ id: 'bad/id', text: '', position: { x: 0, y: 0 } }, { id: 'same', text: 'a', position: { x: 0, y: 0 } }, { id: 'same', text: 'b', position: { x: 0, y: 0 } }], [{ id: 'same' }])
  assert(errors.some(error => error.includes('safe id')))
  assert(errors.some(error => error.includes('needs text')))
  assert(errors.some(error => error.includes('duplicate comment id')))
  assert(errors.some(error => error.includes('conflicts with a canvas item')))
})

test('portable JSON duplication and import retain comments without graph promotion', () => {
  const source = migrateWorkflowDocument({ ...base, comments: [{ id: 'portable', text: 'Carry me', position: { x: 7, y: 8 }, anchor: { type: 'group', id: 'g' }, resolved: false, extension: 'kept' }] })
  const duplicate = migrateWorkflowDocument({ ...JSON.parse(JSON.stringify(source)), id: 'notes-copy', name: 'Notes copy' })
  assert.deepEqual(duplicate.comments, source.comments)
  assert.deepEqual(duplicate.nodes.map(node => node.id), ['a'])
})

test('content-addressed version restore retains exact comment state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-comment-versions-'))
  try {
    const workflow = migrateWorkflowDocument({ ...base, comments: [{ id: 'versioned', text: 'Original', position: { x: 3, y: 4 }, resolved: false }] })
    const version = saveWorkflowVersion(root, workflow, { now: 1 })
    workflow.comments[0].text = 'Draft changed later'
    const restored = resolvePinnedWorkflowVersion(root, workflow.id, version.id).workflow
    assert.equal(restored.comments[0].text, 'Original')
    assert.equal(restored.comments[0].resolved, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

console.log(`${passed}/10 comment checks passed`)
