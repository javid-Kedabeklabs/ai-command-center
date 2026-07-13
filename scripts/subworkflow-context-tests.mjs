import assert from 'node:assert/strict'
import {
  childExecutionContext,
  effectiveExecutionContext,
  executionContextFromEvidence,
  executionPolicyEvidence,
  intersectPermissionCeilings,
  intersectResourceCeilings,
  MAX_SUBWORKFLOW_DEPTH,
  parseInheritedExecutionContext,
} from '../server/runtime/subworkflow-context.js'

let passed = 0
async function test(name, fn) {
  await fn()
  passed++
  console.log(`PASS ${name}`)
}

console.log('== subworkflow execution context ==')

await test('resource ceilings always choose the stricter effective limit', () => {
  assert.deepEqual(intersectResourceCeilings(
    { maxModelCalls: 1, maxSubprocesses: 4, maxHttpRequests: 3, maxMcpCalls: 2 },
    { maxModelCalls: 3, maxSubprocesses: 2, maxHttpRequests: 8, maxMcpCalls: 1 },
  ), { maxModelCalls: 1, maxSubprocesses: 2, maxHttpRequests: 3, maxMcpCalls: 1 })
})

await test('permission denials cannot be restored by a child workflow or node', () => {
  assert.deepEqual(intersectPermissionCeilings(
    { network: false, tools: false },
    { network: true, tools: true, 'execute-shell': false },
  ), { network: false, tools: false, 'execute-shell': false })
})

await test('child context inherits local-only policy, cancellation identity, stack, and node ceilings', () => {
  const parent = effectiveExecutionContext({
    inherited: { resources: { maxModelCalls: 1 }, permissions: { network: false }, localOnly: true, stack: ['root'] },
    workflow: { settings: { resources: { maxSubprocesses: 3 } }, permissions: { tools: false } },
  })
  const child = childExecutionContext({
    parent,
    workflowId: 'parent',
    parentRunId: 'run-1',
    parentNode: { id: 'nested', permissions: { 'execute-shell': false }, runtime: { resources: { maxSubprocesses: 1 } } },
  })
  assert.equal(child.localOnly, true)
  assert.equal(child.resources.maxModelCalls, 1)
  assert.equal(child.resources.maxSubprocesses, 1)
  assert.deepEqual(child.permissions, { network: false, tools: false, 'execute-shell': false })
  assert.deepEqual(child.stack, ['root', 'parent'])
  assert.equal(child.parentRunId, 'run-1')
  assert.equal(child.parentNodeId, 'nested')
})

await test('a child workflow intersects its own policy with the inherited ceiling', () => {
  const inherited = parseInheritedExecutionContext({
    resources: { maxHttpRequests: 1 },
    permissions: { network: false },
    localOnly: true,
    stack: ['parent'],
  })
  const effective = effectiveExecutionContext({ inherited, workflow: {
    settings: { localOnly: false, resources: { maxHttpRequests: 8 } },
    permissions: { network: true },
  } })
  assert.equal(effective.resources.maxHttpRequests, 1)
  assert.equal(effective.permissions.network, false)
  assert.equal(effective.localOnly, true)
})

await test('depth is bounded before another child can launch', () => {
  const parent = { stack: Array.from({ length: MAX_SUBWORKFLOW_DEPTH }, (_, index) => `wf-${index}`) }
  assert.throws(() => childExecutionContext({ parent, workflowId: 'last', parentNode: { id: 'sub' } }), /depth limit/)
})

await test('persisted evidence exposes policy metadata but no unknown payload fields', () => {
  const evidence = executionPolicyEvidence({
    resources: { maxModelCalls: 1 },
    permissions: { network: false },
    localOnly: true,
    stack: ['parent'],
    parentRunId: 'run-parent',
    parentNodeId: 'sub',
    secret: 'must-not-appear',
    input: 'also-secret',
  })
  assert.deepEqual(evidence.deniedPermissions, ['network'])
  assert.equal(JSON.stringify(evidence).includes('must-not-appear'), false)
  assert.equal(JSON.stringify(evidence).includes('also-secret'), false)
})

await test('persisted evidence reconstructs the inherited ceiling for retry and recovery', () => {
  const restored = executionContextFromEvidence({
    resources: { maxModelCalls: 1, maxSubprocesses: 2 },
    deniedPermissions: ['execute-code', 'network'],
    localOnly: true,
    stack: ['parent'],
    parentRunId: 'run-parent',
    parentNodeId: 'sub',
    input: 'must-not-survive',
  })
  assert.equal(restored.resources.maxModelCalls, 1)
  assert.equal(restored.resources.maxSubprocesses, 2)
  assert.deepEqual(restored.permissions, { 'execute-code': false, network: false })
  assert.equal(restored.localOnly, true)
  assert.deepEqual(restored.stack, ['parent'])
  assert.equal(JSON.stringify(restored).includes('must-not-survive'), false)
})

console.log(`${passed}/${passed} subworkflow context tests passed`)
