import assert from 'node:assert/strict'
import { createRunControl, decideApproval, pendingApprovalForNode, requestApproval, setManualPause } from '../server/runtime/run-control.js'

let passed = 0
const check = (condition, label) => { assert.ok(condition, label); passed += 1; console.log(`✓ ${label}`) }
const subject = { runId: 'logical-run-1', workflowVersionHash: 'workflow-hash', nodeExecKey: 'exec-approval', operationKey: null, inputHash: 'input-hash', permissionHash: 'permission-hash', message: 'Ship this result?', nodeId: 'approve' }

let control = createRunControl()
let requested = requestApproval(control, subject)
control = requested.control
check(requested.approval.state === 'pending' && pendingApprovalForNode(control, 'approve')?.id === requested.approval.id, 'approval request is durable and discoverable by node')
const duplicateRequest = requestApproval(control, subject)
check(duplicateRequest.approval.id === requested.approval.id && duplicateRequest.control.revision === control.revision, 'same logical approval request is idempotent')

let decided = decideApproval(control, { approvalId: requested.approval.id, decision: 'approved', commandId: 'decision-1', expectedRevision: 0, expectedSubjectHash: requested.approval.subjectHash, commentRef: 'comment-hash' })
control = decided.control
check(control.approvals[requested.approval.id].state === 'approved' && decided.receipt.approvalRevision === 1, 'approval decision and command receipt commit together')
const replay = decideApproval(control, { approvalId: requested.approval.id, decision: 'approved', commandId: 'decision-1', expectedRevision: 0, expectedSubjectHash: requested.approval.subjectHash, commentRef: 'comment-hash' })
check(replay.replay && replay.receipt.committedAt === decided.receipt.committedAt, 'identical approval command replay returns the original receipt')
assert.throws(() => decideApproval(control, { approvalId: requested.approval.id, decision: 'rejected', commandId: 'decision-2' }), error => error.code === 'APPROVAL_DECISION_CONFLICT')
passed += 1; console.log('✓ conflicting terminal approval decision fails closed')

let pause = setManualPause(control, { paused: true, commandId: 'pause-1', expectedGeneration: 0 })
control = pause.control
check(control.manualPause.paused && control.approvals[requested.approval.id].state === 'approved', 'manual pause is orthogonal to approval state')
const pauseReplay = setManualPause(control, { paused: true, commandId: 'pause-1', expectedGeneration: 0 })
check(pauseReplay.replay && pauseReplay.receipt.generation === 1, 'manual pause command replay is idempotent')
assert.throws(() => setManualPause(control, { paused: false, commandId: 'resume-stale', expectedGeneration: 0 }), error => error.code === 'STALE_PAUSE_GENERATION')
passed += 1; console.log('✓ stale resume generation is rejected')
const resumed = setManualPause(control, { paused: false, commandId: 'resume-1', expectedGeneration: 1 })
check(!resumed.control.manualPause.paused && resumed.control.approvals[requested.approval.id].state === 'approved', 'resume does not mutate approval decisions')

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
