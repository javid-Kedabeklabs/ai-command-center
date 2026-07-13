import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSubworkflowRun, normalizeParentOperation } from '../server/runtime/subworkflow-receipts.js'

let passed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log(`✓ ${name}`) }
  catch (error) { console.error(`✗ ${name}\n  ${error.message}`); process.exitCode = 1 }
}

const operation = {
  operationKey: `op-${'a'.repeat(32)}`,
  parentRunId: 'parent-run-1',
  parentLogicalRunId: 'parent-logical-run-1',
  parentWorkflowId: 'parent',
  parentNodeId: 'child-node',
  parentWorkflowVersionHash: 'b'.repeat(12),
}

test('normalizes a complete server-owned parent operation', () => {
  assert.deepEqual(normalizeParentOperation(operation), operation)
})

test('rejects an invalid or attempt-scoped operation identity', () => {
  assert.throws(() => normalizeParentOperation({ ...operation, operationKey: 'attempt-2' }), /invalid parent operation/)
})

test('finds an active child by stable logical operation key', () => {
  const child = { id: 'child-run', workflowId: 'child', workflowVersion: 'version-1', parentOperation: operation }
  assert.equal(findSubworkflowRun({ activeRuns: [child], operation, workflowId: 'child', workflowVersion: 'version-1' }), child)
})

test('finds a persisted child after the parent process restarts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-subworkflow-receipt-'))
  try {
    fs.writeFileSync(path.join(dir, 'child-run.json'), JSON.stringify({ id: 'child-run', workflowId: 'child', workflowVersion: 'version-1', parentOperation: operation }))
    assert.equal(findSubworkflowRun({ runsDir: dir, operation, workflowId: 'child', workflowVersion: 'version-1' })?.id, 'child-run')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('fails closed when an operation key is reused for a different child identity', () => {
  const child = { id: 'child-run', workflowId: 'other-child', workflowVersion: 'version-1', parentOperation: operation }
  assert.throws(() => findSubworkflowRun({ activeRuns: [child], operation, workflowId: 'child', workflowVersion: 'version-1' }), error => error.code === 'SUBWORKFLOW_OPERATION_CONFLICT')
})

console.log(`\n== RESULT: ${passed} passed, ${process.exitCode ? 1 : 0} failed ==`)
