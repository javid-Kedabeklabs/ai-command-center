import assert from 'node:assert/strict'
import { CURRENT_WORKFLOW_SCHEMA_VERSION, mergeWorkflowDocuments, migrateWorkflowDocument, normalizeWorkflowSecretReferences } from '../server/workflows/schema.js'
import { descendantGroupIds, disabledWorkflowNodeIds, groupValidationErrors, nodeIdsInGroupTree } from '../server/workflows/groups.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== workflow schema ==')

test('secret references normalize opaque ids and reject inline credential material', () => {
  assert.deepEqual(normalizeWorkflowSecretReferences(['MCP.Example']), [{ id: 'mcp.example', purpose: 'generic' }])
  assert.throws(() => normalizeWorkflowSecretReferences([{ id: 'mcp.example', token: 'plaintext' }]), /inline credential/)
  assert.throws(() => normalizeWorkflowSecretReferences([{ id: 'mcp.example' }, { id: 'mcp.example' }]), /duplicate/)
  assert.throws(() => normalizeWorkflowSecretReferences([{ id: '../escape' }]), /secret reference/)
})

test('legacy v1 workflow migrates additively', () => {
  const migrated = migrateWorkflowDocument({ id: 'legacy', name: 'Legacy', project: 'Old', nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }], edges: [], mystery: { retained: true } })
  assert.equal(migrated.schemaVersion, CURRENT_WORKFLOW_SCHEMA_VERSION)
  assert.equal(migrated.metadata.name, 'Legacy')
  assert.deepEqual(migrated.mystery, { retained: true })
  assert.equal(migrated.nodes[0].definitionVersion, 1)
})

test('migration is idempotent', () => {
  const once = migrateWorkflowDocument({ id: 'same', name: 'Same', nodes: [], edges: [] })
  assert.deepEqual(migrateWorkflowDocument(once), once)
})

test('save merge preserves unknown root, node, edge, and group fields', () => {
  const existing = { id: 'preserve', name: 'Before', unknownRoot: 7, nodes: [{ id: 'n', type: 'subworkflow', unknownNode: 'yes', data: { label: 'Old', workflowId: 'child', workflowVersion: 'snapshot-one', extension: { value: 1 } } }], edges: [{ id: 'e', source: 'n', target: 'n2', unknownEdge: true }], groups: [{ id: 'g', unknownGroup: true }] }
  const incoming = { id: 'preserve', name: 'After', nodes: [{ id: 'n', type: 'subworkflow', data: { label: 'New' } }], edges: [{ id: 'e', source: 'n', target: 'n2' }], groups: [{ id: 'g', title: 'Group' }] }
  const merged = mergeWorkflowDocuments(existing, incoming)
  assert.equal(merged.unknownRoot, 7)
  assert.equal(merged.nodes[0].unknownNode, 'yes')
  assert.equal(merged.nodes[0].data.extension.value, 1)
  assert.equal(merged.nodes[0].data.label, 'New')
  assert.equal(merged.nodes[0].data.workflowVersion, 'snapshot-one')
  assert.equal(merged.edges[0].unknownEdge, true)
  assert.equal(merged.groups[0].unknownGroup, true)
})

test('future schema is rejected without mutation', () => {
  const future = { schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION + 1, name: 'Future', nodes: [], edges: [], futureField: 'safe' }
  assert.throws(() => migrateWorkflowDocument(future), /newer than supported/)
  assert.equal(future.futureField, 'safe')
})

test('sourcePort and targetPort aliases migrate to React Flow handles', () => {
  const migrated = migrateWorkflowDocument({ name: 'Ports', nodes: [], edges: [{ id: 'e', source: 'a', sourcePort: 'result', target: 'b', targetPort: 'input' }] })
  assert.equal(migrated.edges[0].sourceHandle, 'result')
  assert.equal(migrated.edges[0].targetHandle, 'input')
})

test('flat groups migrate to explicit stable nested-group semantics without losing fields', () => {
  const migrated = migrateWorkflowDocument({ name: 'Groups', nodes: [{ id: 'a', type: 'agent' }], edges: [], groups: [{ id: 'g', title: 'Group', extension: true, nodeIds: ['a'] }] })
  assert.deepEqual(migrated.groups[0], { id: 'g', title: 'Group', extension: true, nodeIds: ['a'], parentGroupId: null, order: 0, collapsed: false, disabled: false })
  assert.equal(migrated.nodes[0].groupId, 'g')
})

test('nested group validation rejects missing references, duplicate membership, and parent cycles', () => {
  const nodes = [{ id: 'a' }, { id: 'b', groupId: 'missing' }]
  const errors = groupValidationErrors([
    { id: 'one', parentGroupId: 'two', nodeIds: ['a'] },
    { id: 'two', parentGroupId: 'one', nodeIds: ['a', 'gone'] },
  ], nodes)
  assert(errors.some(error => error.includes('cyclic group parentage')))
  assert(errors.some(error => error.includes('multiple groups')))
  assert(errors.some(error => error.includes('missing node gone')))
  assert(errors.some(error => error.includes('missing group missing')))
})

test('recursive group queries preserve nesting and disabled safety inheritance', () => {
  const nodes = [{ id: 'a', groupId: 'root' }, { id: 'b', groupId: 'child' }, { id: 'c', groupId: 'leaf' }, { id: 'free' }]
  const groups = [
    { id: 'root', disabled: true, nodeIds: ['a'] },
    { id: 'child', parentGroupId: 'root', nodeIds: ['b'] },
    { id: 'leaf', parentGroupId: 'child', nodeIds: ['c'] },
  ]
  assert.deepEqual([...descendantGroupIds(groups, 'root')], ['child', 'leaf'])
  assert.deepEqual([...nodeIdsInGroupTree(groups, nodes, 'child')], ['b', 'c'])
  assert.deepEqual([...disabledWorkflowNodeIds(groups, nodes)], ['a', 'b', 'c'])
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
