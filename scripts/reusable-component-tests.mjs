import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { archiveReusableComponent, componentDependencies, markReusableComponent, renameReusableComponent, reusableComponentCatalog } from '../server/workflows/components.js'
import { migrateWorkflowDocument } from '../server/workflows/schema.js'
import { saveWorkflowVersion } from '../server/workflows/versions.js'
import { reusableComponentNodeData } from '../web/src/workflowComponentHelpers.ts'

let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`ok ${passed} - ${name}`) }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-components-'))
const workflows = path.join(root, 'workflows'), versions = path.join(root, 'versions')
fs.mkdirSync(workflows); fs.mkdirSync(versions)
const write = workflow => fs.writeFileSync(path.join(workflows, `${workflow.id}.json`), JSON.stringify(workflow, null, 2))
const component = (label, extension = {}) => markReusableComponent(migrateWorkflowDocument({ id: 'child', name: label, metadata: { extension }, nodes: [{ id: 'out', type: 'output', data: { label: 'Result' } }], edges: [], secretReferences: [{ name: 'never-return-this' }], inputs: { private: true } }), { description: 'Reusable summary', sourceWorkflowId: 'parent' })

try {
  const first = component('First', { retained: true })
  write(first); const firstVersion = saveWorkflowVersion(versions, first, { now: Date.UTC(2026, 0, 1) })
  write(migrateWorkflowDocument({ id: 'ordinary', name: 'Ordinary', nodes: [], edges: [] }))

  test('catalog filters ordinary workflows and returns only redacted component fields', () => {
    const catalog = reusableComponentCatalog(workflows, versions)
    assert.equal(catalog.length, 1)
    assert.deepEqual(Object.keys(catalog[0]).sort(), ['archived', 'available', 'currentVersionHash', 'currentVersionId', 'description', 'id', 'name', 'nodeCount', 'unavailableReason'].sort())
    assert.equal(JSON.stringify(catalog).includes('never-return-this'), false)
    assert.equal(catalog[0].available, true)
  })

  test('insertion uses the exact catalog current-version pin', () => {
    assert.deepEqual(reusableComponentNodeData(reusableComponentCatalog(workflows, versions)[0]), { label: 'First', description: 'Reusable summary', workflowId: 'child', workflowVersion: firstVersion.id })
  })

  test('component metadata and unknown extensions survive canonical migration', () => {
    const roundTrip = migrateWorkflowDocument(JSON.parse(fs.readFileSync(path.join(workflows, 'child.json'), 'utf8')))
    assert.equal(roundTrip.metadata.component.reusable, true)
    assert.deepEqual(roundTrip.metadata.extension, { retained: true })
  })

  test('restored current definition is selected instead of the newest timestamp', () => {
    const second = component('Second')
    write(second); saveWorkflowVersion(versions, second, { now: Date.UTC(2026, 0, 2) })
    write(first)
    assert.equal(reusableComponentCatalog(workflows, versions)[0].currentVersionId, firstVersion.id)
  })

  test('rename preserves identity, extensions, and parent pins', () => {
    write(migrateWorkflowDocument({ id: 'parent', name: 'Parent', nodes: [{ id: 'sub', type: 'subworkflow', data: { workflowId: 'child', workflowVersion: firstVersion.id } }], edges: [] }))
    const result = renameReusableComponent(workflows, versions, 'child', { name: 'Renamed', description: 'Updated summary' })
    assert.equal(result.workflow.id, 'child')
    assert.equal(result.workflow.metadata.extension.retained, true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(workflows, 'parent.json'), 'utf8')).nodes[0].data.workflowVersion, firstVersion.id)
  })

  test('archive rejects dependencies and reports impacted parents without mutation', () => {
    assert.deepEqual(componentDependencies(workflows, 'child').map(item => item.workflowId), ['parent'])
    assert.throws(() => archiveReusableComponent(workflows, versions, 'child'), error => error.code === 'COMPONENT_IN_USE' && error.dependencies[0].workflowId === 'parent')
    assert.equal(JSON.parse(fs.readFileSync(path.join(workflows, 'child.json'), 'utf8')).metadata.component.archived, false)
  })

  test('archive is non-destructive and makes an unreferenced component unavailable', () => {
    fs.unlinkSync(path.join(workflows, 'parent.json'))
    archiveReusableComponent(workflows, versions, 'child')
    const entry = reusableComponentCatalog(workflows, versions)[0]
    assert.equal(entry.archived, true)
    assert.equal(entry.available, false)
    assert.throws(() => reusableComponentNodeData(entry), /Archived/)
    assert.equal(fs.existsSync(path.join(workflows, 'child.json')), true)
  })

  test('a reusable workflow without its current snapshot is truthfully unavailable', () => {
    const missing = markReusableComponent(migrateWorkflowDocument({ id: 'missing', name: 'Missing snapshot', nodes: [], edges: [] }))
    write(missing)
    const entry = reusableComponentCatalog(workflows, versions).find(item => item.id === 'missing')
    assert.equal(entry.available, false)
    assert.match(entry.unavailableReason, /snapshot is unavailable/)
  })
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(`${passed}/8 reusable-component checks passed`)
