import assert from 'node:assert/strict'
import {
  absoluteCanvasPosition,
  applyRecursiveVisibility,
  hierarchyDepth,
  orderHierarchyNodes,
  recursiveMemberNodeIds,
  reparentPreservingAbsolute,
  validateReparent,
} from '../web/src/workflowGroupHelpers.ts'

let passed = 0
const test = (name, fn) => {
  try { fn(); passed += 1; console.log(`ok ${passed} - ${name}`) }
  catch (error) { console.error(`not ok - ${name}`); throw error }
}

const fixture = () => [
  { id: 'leaf', parentId: 'child', position: { x: 7, y: 8 }, data: { ntype: 'agent' } },
  { id: 'root', position: { x: 100, y: 200 }, data: { ntype: '__group', order: 2 } },
  { id: 'outside', position: { x: 600, y: 30 }, data: { ntype: 'output' } },
  { id: 'child', parentId: 'root', position: { x: 20, y: 30 }, data: { ntype: '__group', order: 1 } },
  { id: 'direct', parentId: 'root', position: { x: 40, y: 50 }, data: { ntype: 'agent' } },
]

test('parents load before nested groups and workflow nodes', () => {
  assert.deepEqual(orderHierarchyNodes(fixture()).map(node => node.id), ['root', 'outside', 'child', 'direct', 'leaf'])
})

test('self and descendant parenting are rejected before mutation', () => {
  const nodes = fixture()
  assert.match(validateReparent(nodes, ['root'], 'root') || '', /itself/)
  assert.match(validateReparent(nodes, ['root'], 'child') || '', /descendants/)
  assert.equal(validateReparent(nodes, ['child'], undefined), null)
})

test('reparenting preserves absolute canvas position', () => {
  const nodes = fixture()
  const before = absoluteCanvasPosition(nodes, 'leaf')
  const moved = reparentPreservingAbsolute(nodes, ['leaf'], 'root')
  assert.deepEqual(absoluteCanvasPosition(moved, 'leaf'), before)
  assert.equal(moved.find(node => node.id === 'leaf')?.parentId, 'root')
  assert.deepEqual(moved.find(node => node.id === 'leaf')?.position, { x: 27, y: 38 })
})

test('moving a selected parent does not separately remap its selected descendants', () => {
  const nodes = fixture()
  const moved = reparentPreservingAbsolute(nodes, ['child', 'leaf'], undefined)
  assert.deepEqual(absoluteCanvasPosition(moved, 'leaf'), absoluteCanvasPosition(nodes, 'leaf'))
  assert.equal(moved.find(node => node.id === 'leaf')?.parentId, 'child')
})

test('collapsed ancestors recursively hide groups and nodes', () => {
  const nodes = fixture().map(node => node.id === 'root' ? { ...node, data: { ...node.data, collapsed: true } } : node)
  const visibility = new Map(applyRecursiveVisibility(nodes).map(node => [node.id, !!node.hidden]))
  assert.deepEqual(Object.fromEntries(visibility), { leaf: true, root: false, outside: false, child: true, direct: true })
})

test('expanding an ancestor retains a nested group collapse boundary', () => {
  const nodes = fixture().map(node => node.id === 'child' ? { ...node, data: { ...node.data, collapsed: true } } : node)
  const visibility = new Map(applyRecursiveVisibility(nodes).map(node => [node.id, !!node.hidden]))
  assert.equal(visibility.get('child'), false)
  assert.equal(visibility.get('leaf'), true)
  assert.equal(visibility.get('direct'), false)
})

test('recursive group membership contains direct and nested executable nodes only', () => {
  assert.deepEqual(recursiveMemberNodeIds(fixture(), 'root'), ['leaf', 'direct'])
  assert.deepEqual(recursiveMemberNodeIds(fixture(), 'child'), ['leaf'])
})

test('disabled state is visibly inherited without rewriting direct disabled state', () => {
  const nodes = fixture().map(node => node.id === 'root' ? { ...node, data: { ...node.data, disabled: true } } : node)
  const state = new Map(applyRecursiveVisibility(nodes).map(node => [node.id, node.data]))
  assert.equal(state.get('leaf').ancestorDisabled, true)
  assert.equal(state.get('child').ancestorDisabled, true)
  assert.equal(state.get('outside').ancestorDisabled, false)
  assert.equal(state.get('leaf').disabled, undefined)
})

const cyclicFixture = () => [
  { id: 'a', parentId: 'b', position: { x: 1, y: 2 }, data: { ntype: '__group' } },
  { id: 'b', parentId: 'a', position: { x: 3, y: 4 }, data: { ntype: '__group' } },
  { id: 'stray', parentId: 'ghost', position: { x: 5, y: 6 }, data: { ntype: 'agent' } },
]

test('missing or non-group destinations are rejected with an actionable message', () => {
  const nodes = fixture()
  const snapshot = structuredClone(nodes)
  assert.match(validateReparent(nodes, ['leaf'], 'ghost') || '', /destination section no longer exists/)
  assert.match(validateReparent(nodes, ['leaf'], 'outside') || '', /destination section no longer exists/)
  assert.match(validateReparent(nodes, ['ghost'], undefined) || '', /ghost no longer exists/)
  assert.throws(() => reparentPreservingAbsolute(nodes, ['leaf'], 'ghost'), /destination section no longer exists/)
  assert.deepEqual(nodes, snapshot)
})

test('cyclic ancestry terminates deterministically without mutating the input', () => {
  const nodes = cyclicFixture()
  const snapshot = structuredClone(nodes)
  assert.equal(hierarchyDepth(nodes, 'a'), 2)
  assert.deepEqual(absoluteCanvasPosition(nodes, 'a'), { x: 4, y: 6 })
  assert.deepEqual(orderHierarchyNodes(nodes).map(node => node.id), ['stray', 'a', 'b'])
  assert.deepEqual(applyRecursiveVisibility(nodes).map(node => node.hidden), [false, false, false])
  assert.deepEqual(nodes, snapshot)
})

test('a missing ancestor ends traversal instead of throwing or hiding the node', () => {
  const nodes = cyclicFixture()
  assert.equal(hierarchyDepth(nodes, 'stray'), 1)
  assert.deepEqual(absoluteCanvasPosition(nodes, 'stray'), { x: 5, y: 6 })
  const visibility = applyRecursiveVisibility(nodes).find(node => node.id === 'stray')
  assert.equal(visibility.hidden, false)
  assert.equal(visibility.data.ancestorDisabled, false)
})

test('reparenting returns new nodes and preserves every absolute canvas position', () => {
  const nodes = fixture()
  const snapshot = structuredClone(nodes)
  const moved = reparentPreservingAbsolute(nodes, ['direct'], 'child')
  assert.deepEqual(nodes, snapshot)
  assert.notEqual(moved, nodes)
  assert.notEqual(moved.find(node => node.id === 'direct'), nodes.find(node => node.id === 'direct'))
  assert.equal(moved.find(node => node.id === 'direct')?.parentId, 'child')
  for (const node of nodes) assert.deepEqual(absoluteCanvasPosition(moved, node.id), absoluteCanvasPosition(nodes, node.id))
})

test('reparenting to the canvas root drops parentId and keeps the absolute position', () => {
  const nodes = fixture()
  const before = absoluteCanvasPosition(nodes, 'direct')
  const moved = reparentPreservingAbsolute(nodes, ['direct'], undefined)
  const direct = moved.find(node => node.id === 'direct')
  assert.equal('parentId' in direct, false)
  assert.deepEqual(direct.position, before)
})

test('non-numeric or missing coordinates coerce to zero in absolute positions', () => {
  const nodes = [
    { id: 'g', position: { x: 'oops', y: null }, data: { ntype: '__group' } },
    { id: 'n', parentId: 'g', position: { x: 5, y: -5 }, data: { ntype: 'agent' } },
  ]
  assert.deepEqual(absoluteCanvasPosition(nodes, 'g'), { x: 0, y: 0 })
  assert.deepEqual(absoluteCanvasPosition(nodes, 'n'), { x: 5, y: -5 })
})

console.log(`${passed}/14 group UI helper checks passed`)
