import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportComponentManifest, installComponentManifest, validateComponentManifest } from '../server/workflows/component-manifests.js'
import { markReusableComponent } from '../server/workflows/components.js'
import { migrateWorkflowDocument } from '../server/workflows/schema.js'
import { saveWorkflowVersion, workflowContentHash } from '../server/workflows/versions.js'

let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`ok ${passed} - ${name}`) }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-component-manifests-'))
const sourceWorkflows = path.join(root, 'source-workflows'), sourceVersions = path.join(root, 'source-versions')
const targetWorkflows = path.join(root, 'target-workflows'), targetVersions = path.join(root, 'target-versions')
for (const dir of [sourceWorkflows, sourceVersions, targetWorkflows, targetVersions]) fs.mkdirSync(dir)
const write = (dir, workflow) => fs.writeFileSync(path.join(dir, `${workflow.id}.json`), JSON.stringify(workflow, null, 2))
const component = (id, name, nodes, extra = {}) => markReusableComponent(migrateWorkflowDocument({ id, name, metadata: { safeExtension: { retained: true } }, nodes, edges: [], comments: [{ id: `note-${id}`, text: 'Portable review note', position: { x: 4, y: 8 }, resolved: false, futureField: 'kept' }], ...extra }), { description: `${name} description` })

try {
  const leaf = component('leaf', 'Leaf', [{ id: 'out', type: 'output', position: { x: 0, y: 0 }, data: { label: 'Leaf result', futureNodeField: { retained: true } } }], { futureRootField: { retained: true } })
  write(sourceWorkflows, leaf); const leafVersion = saveWorkflowVersion(sourceVersions, leaf, { now: Date.UTC(2026, 0, 1) })
  const parent = component('parent', 'Parent', [{ id: 'child', type: 'subworkflow', position: { x: 0, y: 0 }, data: { label: 'Leaf', workflowId: 'leaf', workflowVersion: leafVersion.id } }, { id: 'out', type: 'output', position: { x: 200, y: 0 }, data: { label: 'Done' } }])
  write(sourceWorkflows, parent); const parentVersion = saveWorkflowVersion(sourceVersions, parent, { now: Date.UTC(2026, 0, 2) })
  const manifest = exportComponentManifest(sourceWorkflows, sourceVersions, 'parent')

  test('export is deterministic and contains the exact sorted dependency closure', () => {
    assert.equal(JSON.stringify(exportComponentManifest(sourceWorkflows, sourceVersions, 'parent')), JSON.stringify(manifest))
    assert.deepEqual(manifest.components.map(item => item.id), ['leaf', 'parent'])
    assert.equal(manifest.components.find(item => item.id === 'parent').snapshot.id, parentVersion.id)
    assert.equal(manifest.components.find(item => item.id === 'parent').dependencies[0].workflowVersion, leafVersion.id)
  })

  test('manifest is redacted from runs, credentials, audit data, and unrelated workflows', () => {
    const text = JSON.stringify(manifest)
    assert.equal(text.includes('runs'), false); assert.equal(text.includes('audit'), false); assert.equal(text.includes('credentials'), false)
    assert.equal(manifest.components.length, 2)
  })

  test('validation reports executable closure and stages without filesystem mutation', () => {
    const before = fs.readdirSync(targetWorkflows)
    const result = validateComponentManifest(manifest, { workflowRoot: targetWorkflows })
    assert.deepEqual(result.review, { rootComponentId: 'parent', componentCount: 2, dependencyCount: 1, executableNodes: 1, conflicts: [], approvable: true })
    assert.deepEqual(fs.readdirSync(targetWorkflows), before)
  })

  test('approved install preserves exact pins, comments, and safe unknown extensions', () => {
    installComponentManifest(targetWorkflows, targetVersions, manifest, { proposalId: 'review-1', now: Date.UTC(2026, 0, 3) })
    const importedParent = JSON.parse(fs.readFileSync(path.join(targetWorkflows, 'parent.json'), 'utf8'))
    const importedLeaf = JSON.parse(fs.readFileSync(path.join(targetWorkflows, 'leaf.json'), 'utf8'))
    assert.equal(importedParent.nodes[0].data.workflowVersion, leafVersion.id)
    assert.equal(importedLeaf.comments[0].futureField, 'kept')
    assert.deepEqual(importedLeaf.futureRootField, { retained: true })
    assert.deepEqual(importedLeaf.nodes[0].data.futureNodeField, { retained: true })
    assert.equal(importedParent.environment, 'development'); assert.equal(importedParent.governance.status, 'imported-review'); assert.equal(importedParent.metadata.component.archived, false)
  })

  test('an installed closure exports again with valid exact dependency pins', () => {
    const roundTrip = exportComponentManifest(targetWorkflows, targetVersions, 'parent')
    assert.equal(roundTrip.components.find(item => item.id === 'parent').dependencies[0].workflowVersion, leafVersion.id)
    assert.equal(roundTrip.components.find(item => item.id === 'leaf').workflow.comments[0].futureField, 'kept')
  })

  test('tampered workflow content and hashes are rejected', () => {
    const tampered = structuredClone(manifest); tampered.components[0].workflow.name = 'Tampered'
    assert.throws(() => validateComponentManifest(tampered), error => error.code === 'TAMPERED_COMPONENT_HASH')
  })

  test('missing dependencies and mismatched exact pins are rejected', () => {
    const missing = structuredClone(manifest); missing.components = missing.components.filter(item => item.id !== 'leaf')
    assert.throws(() => validateComponentManifest(missing), error => error.code === 'MISSING_COMPONENT_DEPENDENCY')
    const mismatched = structuredClone(manifest); mismatched.components.find(item => item.id === 'parent').dependencies[0].hash = '000000000000'
    assert.throws(() => validateComponentManifest(mismatched), error => error.code === 'DEPENDENCY_PIN_MISMATCH')
  })

  test('cycles are rejected before dependency installation', () => {
    const cyclicWorkflow = component('cycle', 'Cycle', [{ id: 'self', type: 'subworkflow', position: { x: 0, y: 0 }, data: { workflowId: 'cycle', workflowVersion: 'placeholder-000000000000' } }])
    const hash = workflowContentHash(cyclicWorkflow), id = `cycle-${hash}`
    const cyclic = { manifestVersion: 1, kind: 'command-center/reusable-component', rootComponentId: 'cycle', compatibility: { workflowSchema: 2 }, components: [{ id: 'cycle', name: 'Cycle', description: '', snapshot: { id, hash }, dependencies: [{ nodeId: 'self', componentId: 'cycle', workflowVersion: 'placeholder-000000000000', hash }], compatibility: { workflowSchema: 2 }, provenance: { type: 'command-center-component', sourceComponentId: 'cycle' }, workflow: cyclicWorkflow }] }
    assert.throws(() => validateComponentManifest(cyclic), error => error.code === 'COMPONENT_DEPENDENCY_CYCLE')
  })

  test('path traversal identities and secret-bearing payloads are rejected', () => {
    const traversal = structuredClone(manifest); traversal.components[0].id = '../escape'
    assert.throws(() => validateComponentManifest(traversal), error => error.code === 'INVALID_COMPONENT_ID')
    const secret = structuredClone(manifest), leafItem = secret.components.find(item => item.id === 'leaf')
    leafItem.workflow.nodes[0].data.apiKey = 'must-not-travel'; leafItem.snapshot.hash = workflowContentHash(leafItem.workflow); leafItem.snapshot.id = `secret-${leafItem.snapshot.hash}`
    assert.throws(() => validateComponentManifest(secret), error => error.code === 'SECRET_BEARING_MANIFEST')
  })

  test('existing and locked-production IDs are reported and never overwritten', () => {
    const existingLeaf = JSON.parse(fs.readFileSync(path.join(targetWorkflows, 'leaf.json'), 'utf8')); existingLeaf.governance = { status: 'production', locked: true }; write(targetWorkflows, existingLeaf)
    const review = validateComponentManifest(manifest, { workflowRoot: targetWorkflows }).review
    assert.equal(review.approvable, false); assert.equal(review.conflicts.find(item => item.componentId === 'leaf').type, 'locked-production')
    assert.throws(() => installComponentManifest(targetWorkflows, targetVersions, manifest), error => error.code === 'COMPONENT_IMPORT_CONFLICT')
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetWorkflows, 'leaf.json'), 'utf8')).governance.locked, true)
  })
} finally { fs.rmSync(root, { recursive: true, force: true }) }

console.log(`${passed}/10 component-manifest checks passed`)
