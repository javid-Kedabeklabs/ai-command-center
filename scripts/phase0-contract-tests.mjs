import fs from 'node:fs'
import path from 'node:path'

const base = process.env.CC_URL || 'http://127.0.0.1:1717'
const root = process.cwd()
let passed = 0, failed = 0

async function request(url, options = {}) {
  const response = await fetch(base + url, options)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { response, body }
}
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
function check(condition, label, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${label}`) }
  else { failed++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
async function waitRun(id, timeout = 15000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const { body } = await request(`/api/runs/${id}/detail`)
    if (body && !['running', 'paused'].includes(body.status)) return body
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`run ${id} timed out`)
}
async function save(workflow) { return request('/api/workflows', { method: 'POST', ...json(workflow) }) }
async function removeWorkflow(id) { await request(`/api/workflows/${id}`, { method: 'DELETE' }) }
async function deployExact(workflowId) {
  const transition = async (action, candidate, extra = {}) => request(`/api/workflows/${workflowId}/lifecycle`, { method: 'POST', ...json({ action, actor: 'phase0-test', reason: `${action} fixture`, candidateId: candidate.id, expectedWorkflowId: workflowId, expectedWorkflowVersion: candidate.workflowVersion, expectedWorkflowHash: candidate.sourceHash, expectedOperationalHash: candidate.operationalHash, selectedGateResultIds: [], ...extra }) })
  const development = await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'phase0-test' }) }); if (!development.response.ok) return development
  let result = await transition('prepare-testing', development.body); if (!result.response.ok) return result
  result = await transition('approve-testing', development.body); if (!result.response.ok) return result
  result = await transition('enter-testing', development.body, { approvalDecisionId: result.body.lifecycle.testingApprovalId }); if (!result.response.ok) return result
  const testing = await request(`/api/workflows/${workflowId}/candidates`, { method: 'POST', ...json({ by: 'phase0-test' }) }); if (!testing.response.ok) return testing
  result = await transition('prepare-production', testing.body); if (!result.response.ok) return result
  result = await transition('approve-production', testing.body); if (!result.response.ok) return result
  return transition('deploy-production', testing.body, { approvalDecisionId: result.body.lifecycle.productionApprovalId })
}

console.log('== interrupted capability recovery ==')

const incompatible = await save({ id: 'phase0-bad-ports', name: 'Bad Ports', nodes: [
  { id: 'files', type: 'folder-input', data: { label: 'Files', path: '/tmp' } },
  { id: 'critic', type: 'critic', data: { label: 'Critic', model: 'policy:local' } },
], edges: [{ id: 'e', source: 'files', target: 'critic' }] })
check(incompatible.response.status === 400 && String(incompatible.body.error).includes('incompatible'), 'typed ports reject incompatible files → text connection', JSON.stringify(incompatible.body))
const preview = await request('/api/workflow-connections/preview', { method: 'POST', ...json({ value: '{"claim":{"score":90}}', parseJson: true, mapping: { 'claim.score': 'review.score' }, schema: { type: 'object', required: ['review'], properties: { review: { type: 'object', required: ['score'], properties: { score: { type: 'number', minimum: 80 } } } } } }) })
check(preview.response.ok && preview.body.valid && preview.body.value?.review?.score === 90, 'mapping preview applies nested paths and destination schema')
const schemaWorkflow = { id: 'phase0-schema-runtime', name: 'Schema Runtime', nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'in', target: 'out', data: { coercion: 'object', schema: { type: 'object', required: ['score'], properties: { score: { type: 'number', minimum: 80 } } } } }] }
await save(schemaWorkflow); let schemaStarted = await request('/api/workflows/phase0-schema-runtime/run', { method: 'POST', ...json({ input: '{"score":90}' }) }); let schemaRun = await waitRun(schemaStarted.body.runId)
check(schemaRun.status === 'done' && String(schemaRun.result).includes('90'), 'runtime applies explicit coercion and validates edge schema')
schemaStarted = await request('/api/workflows/phase0-schema-runtime/run', { method: 'POST', ...json({ input: '{"score":20}' }) }); schemaRun = await waitRun(schemaStarted.body.runId)
check(schemaRun.status === 'failed' && (schemaRun.events || []).some(event => String(event.text).includes('schema validation')), 'runtime rejects values that fail destination schema')

const customDef = { id: 'phase0-upper', name: 'Uppercase Fixture', description: 'Uppercase text deterministically', inputs: [{ id: 'input', type: 'any', label: 'Input' }], outputs: [{ id: 'output', type: 'text', label: 'Output' }], permissions: [], implementation: { kind: 'python', code: 'import json,sys\np=json.load(sys.stdin)\nprint(str(p["input"]).upper())' }, tests: [] }
const customSaved = await request('/api/custom-nodes', { method: 'POST', ...json(customDef) })
check(customSaved.response.ok && customSaved.body.id === customDef.id, 'custom-node CRUD creates a typed definition')
const customWorkflow = { id: 'phase0-custom-runtime', name: 'Custom Runtime', nodes: [
  { id: 'in', type: 'input', data: { label: 'Input' } },
  { id: 'custom', type: 'custom', data: { label: 'Upper', customNodeId: customDef.id } },
  { id: 'out', type: 'output', data: { label: 'Output' } },
], edges: [{ id: 'e1', source: 'in', target: 'custom' }, { id: 'e2', source: 'custom', target: 'out' }] }
let saved = await save(customWorkflow)
check(saved.response.ok, 'custom-node workflow saves', JSON.stringify(saved.body))
let started = await request('/api/workflows/phase0-custom-runtime/run', { method: 'POST', ...json({ input: 'hello contract' }) })
let run = started.response.ok ? await waitRun(started.body.runId) : started.body
check(run.status === 'done' && String(run.result).includes('HELLO CONTRACT'), 'custom-node implementation executes', JSON.stringify(run))

const plugin = await request('/api/plugins/install', { method: 'POST', ...json({ plugin: { id: 'phase0-fixture-plugin', name: 'Fixture Plugin', version: '1.0.0', publisher: 'Tests', trust: 'local-review', nodes: [] } }) })
check(plugin.response.ok && plugin.body.enabled === false && plugin.body.trustStatus === 'untrusted', 'imported plugin installs disabled and untrusted')
const refusedEnable = await request('/api/plugins/phase0-fixture-plugin/toggle', { method: 'POST', ...json({ enabled: true }) })
check(refusedEnable.response.status === 403, 'untrusted plugin cannot be enabled before review')
const reviewed = await request('/api/plugins/phase0-fixture-plugin/review', { method: 'POST', ...json({ decision: 'approve', by: 'phase0-test' }) })
const enabledPlugin = await request('/api/plugins/phase0-fixture-plugin/toggle', { method: 'POST', ...json({ enabled: true }) })
check(reviewed.response.ok && enabledPlugin.body.enabled, 'reviewed plugin can be explicitly enabled')
const toggled = await request('/api/plugins/phase0-fixture-plugin/toggle', { method: 'POST', ...json({ enabled: false }) })
check(toggled.response.ok && toggled.body.enabled === false, 'plugin can be disabled')
await request('/api/plugins/phase0-fixture-plugin', { method: 'DELETE' })

const suite = await request('/api/evaluations', { method: 'POST', ...json({ id: 'phase0-eval', name: 'Fixture Evaluation', workflowId: 'phase0-custom-runtime', checks: [{ type: 'contains', value: 'HELLO' }, { type: 'min-length', value: 5 }] }) })
const evaluation = await request('/api/evaluations/phase0-eval/run', { method: 'POST', ...json({ output: 'HELLO CONTRACT' }) })
check(suite.response.ok && evaluation.body.passed && evaluation.body.score === 100, 'deterministic evaluation records a passing score', JSON.stringify(evaluation.body))

const promoted = await deployExact('phase0-custom-runtime')
check(promoted.response.ok && promoted.body.workflow?.governance?.locked, 'exact lifecycle deployment locks workflow')
const lockedSave = await save({ ...promoted.body.workflow, name: 'Should Not Save' })
check(lockedSave.response.status === 423, 'locked production workflow rejects edits')
const unlocked = await request('/api/workflows/phase0-custom-runtime/unlock', { method: 'POST', ...json({ reason: 'fixture cleanup' }) })
check(unlocked.response.status === 409 && unlocked.body.code === 'LIFECYCLE_DEVELOPMENT_REVISION_REQUIRED', 'in-place production unlock is rejected')

const child = { id: 'phase0-child', name: 'Child', settings: { resources: { maxSubprocesses: 4 } }, nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'py', type: 'python', data: { label: 'Child Python', code: 'import json,sys\np=json.load(sys.stdin)\nprint("child:"+p["input"])' } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'in', target: 'py' }, { id: 'e2', source: 'py', target: 'out' }] }
await save(child)
const childVersions = await request('/api/workflows/phase0-child/versions')
const childPin = childVersions.body?.[0]?.id
const parent = { id: 'phase0-parent', name: 'Parent', settings: { localOnly: true, resources: { maxSubprocesses: 1 } }, nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'sub', type: 'subworkflow', data: { label: 'Child Workflow', workflowId: 'phase0-child', workflowVersion: childPin } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'in', target: 'sub' }, { id: 'e2', source: 'sub', target: 'out' }] }
await save(parent)
started = await request('/api/workflows/phase0-parent/run', { method: 'POST', ...json({ input: 'nested' }) }); run = await waitRun(started.body.runId)
check(run.status === 'done' && String(run.result).includes('child:nested'), 'nested subworkflow executes and returns output', JSON.stringify(run))
const nestedChild = run.childRunIds?.[0] ? await waitRun(run.childRunIds[0]) : null
check(nestedChild?.executionPolicy?.resources?.maxSubprocesses === 1 && nestedChild.executionPolicy.localOnly === true && nestedChild.executionPolicy.parentRunId === run.id, 'nested subworkflow persists stricter inherited resource/local-only policy and cancellation identity', JSON.stringify(nestedChild?.executionPolicy))
check(run.checkpoint?.subworkflows?.[0]?.executionPolicy?.resources?.maxSubprocesses === 1 && !JSON.stringify(run.checkpoint.subworkflows[0].executionPolicy).includes('nested'), 'parent checkpoint persists redacted child-policy evidence')
child.nodes.find(node => node.id === 'py').data.code = 'import json,sys\np=json.load(sys.stdin)\nprint("changed:"+p["input"])'
await save(child); started = await request('/api/workflows/phase0-parent/run', { method: 'POST', ...json({ input: 'stable' }) }); const pinnedRun = await waitRun(started.body.runId)
check(pinnedRun.status === 'done' && String(pinnedRun.result).includes('child:stable') && !String(pinnedRun.result).includes('changed:'), 'pinned subworkflow execution remains stable after the child draft changes', JSON.stringify(pinnedRun))
const missingPinParent = { ...parent, id: 'phase0-parent-missing-pin', name: 'Missing Pin Parent', nodes: parent.nodes.map(node => node.id === 'sub' ? { ...node, data: { ...node.data, workflowVersion: 'missing-version-deadbeef' } } : node) }
await save(missingPinParent); started = await request('/api/workflows/phase0-parent-missing-pin/run', { method: 'POST', ...json({ input: 'must not start child work' }) }); const missingPinRun = await waitRun(started.body.runId)
check(missingPinRun.status === 'failed' && !missingPinRun.childRunIds?.length && (missingPinRun.events || []).some(event => String(event.text).includes('explicitly update its pin')), 'missing subworkflow pin fails before a child run or child side effect starts', JSON.stringify(missingPinRun))
const deniedParent = { ...parent, id: 'phase0-parent-denied', name: 'Denied Parent', permissions: { 'execute-code': false }, nodes: parent.nodes.map(node => node.id === 'sub' ? { ...node, permissions: { 'execute-code': true } } : node) }
await save(deniedParent); started = await request('/api/workflows/phase0-parent-denied/run', { method: 'POST', ...json({ input: 'must not execute' }) }); const deniedRun = await waitRun(started.body.runId)
const deniedChild = deniedRun.childRunIds?.[0] ? await waitRun(deniedRun.childRunIds[0]) : null
check(deniedRun.status === 'failed' && deniedChild?.status === 'failed' && deniedChild.executionPolicy?.deniedPermissions?.includes('execute-code'), 'child cannot restore a permission denied by its parent workflow', JSON.stringify(deniedChild))
const deniedRetryStart = await request(`/api/workflows/runs/${deniedChild.id}/retry`, { method: 'POST', ...json({ nodeId: 'py', scope: 'branch' }) })
const deniedRetry = deniedRetryStart.response.ok ? await waitRun(deniedRetryStart.body.runId) : deniedRetryStart.body
check(deniedRetry.status === 'failed' && deniedRetry.executionPolicy?.deniedPermissions?.includes('execute-code'), 'retry reconstructs the persisted inherited permission ceiling', JSON.stringify(deniedRetry))
const overDepth = await request('/api/workflows/phase0-child/run', { method: 'POST', ...json({ input: 'no side effects', executionContext: { stack: Array.from({ length: 9 }, (_, index) => `depth-${index}`) } }) })
check(overDepth.response.status === 400 && String(overDepth.body.error).includes('depth limit'), 'over-depth nested calls are rejected before a child run starts')
const recursive = { ...parent, id: 'phase0-recursive', name: 'Recursive', nodes: parent.nodes.map(n => n.id === 'sub' ? { ...n, data: { ...n.data, workflowId: 'phase0-recursive' } } : n) }
await save(recursive); started = await request('/api/workflows/phase0-recursive/run', { method: 'POST', ...json({ input: 'stop recursion' }) }); run = await waitRun(started.body.runId)
check(run.status === 'failed' && (run.events || []).some(event => String(event.text).includes('recursive subworkflow')), 'recursive subworkflow is rejected')

const resumeWf = { id: 'phase0-resume', name: 'Resume', nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'ok', type: 'python', data: { label: 'Preserved', code: 'import json,sys\np=json.load(sys.stdin)\nprint("preserved:"+p["input"])' } }, { id: 'fail', type: 'python', data: { label: 'Repair Me', code: 'raise RuntimeError("fixture failure")' } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'in', target: 'ok' }, { id: 'e2', source: 'ok', target: 'fail' }, { id: 'e3', source: 'fail', target: 'out' }] }
await save(resumeWf); started = await request('/api/workflows/phase0-resume/run', { method: 'POST', ...json({ input: 'resume-data' }) }); const failedRun = await waitRun(started.body.runId)
check(failedRun.status === 'failed' && failedRun.failedNodeId === 'fail', 'failed run persists exact failed node')
resumeWf.nodes.find(node => node.id === 'fail').data.code = 'import json,sys\np=json.load(sys.stdin)\nprint("repaired:"+p["input"])'
await save(resumeWf); started = await request('/api/workflows/phase0-resume/run', { method: 'POST', ...json({ resumeRunId: failedRun.id, fromNodeId: 'fail' }) }); const resumed = await waitRun(started.body.runId)
check(resumed.status === 'failed' && resumed.workflowVersion === failedRun.workflowVersion && resumed.resumedFrom === failedRun.id, 'checkpoint recovery remains pinned to the exact failed workflow definition', JSON.stringify(resumed))
const retriedStart = await request(`/api/workflows/runs/${failedRun.id}/retry`, { method: 'POST', ...json({ nodeId: 'fail', scope: 'branch' }) }); const retried = await waitRun(retriedStart.body.runId)
check(retried.status === 'failed' && retried.resumedFrom === failedRun.id && retried.workflowVersion === failedRun.workflowVersion, 'retry endpoint preserves exact checkpoint provenance instead of silently adopting draft edits')
started = await request('/api/workflows/phase0-resume/run', { method: 'POST', ...json({ input: 'preserved:resume-data', nodeId: 'fail', runMode: 'from' }) }); const repairedRun = await waitRun(started.body.runId)
check(repairedRun.status === 'done' && String(repairedRun.result).includes('repaired:') && repairedRun.workflowVersion !== failedRun.workflowVersion, 'explicit repaired draft starts a separately pinned version', JSON.stringify(repairedRun))
started = await request('/api/workflows/phase0-resume/run', { method: 'POST', ...json({ input: 'selected-data', nodeId: 'ok', runMode: 'selected' }) }); const selectedRun = await waitRun(started.body.runId)
check(selectedRun.status === 'done' && String(selectedRun.result).includes('preserved:selected-data') && !(selectedRun.events || []).some(event => event.nodeId === 'fail'), 'run-selected-node executes dependencies but not downstream nodes')
started = await request('/api/workflows/phase0-resume/run', { method: 'POST', ...json({ input: 'group-data', nodeIds: ['ok', 'fail'], runMode: 'selected' }) }); const groupRun = await waitRun(started.body.runId)
check(groupRun.status === 'done' && String(groupRun.result).includes('repaired:preserved:group-data') && (groupRun.events || []).some(event => String(event.text).includes('exactly 2 steps')), 'run-selected-group executes exactly its recursive member-node set')

const fixture = path.join(root, 'scripts', 'fixtures', 'mcp-echo-server.mjs')
const mcpAdded = await request('/api/tools/mcp', { method: 'POST', ...json({ name: 'phase0-echo', command: `node ${fixture}`, url: '' }) })
const mcpWf = { id: 'phase0-mcp', name: 'MCP', nodes: [{ id: 'mcp', type: 'mcp', data: { label: 'Echo Tool', server: 'phase0-echo', tool: 'echo', arguments: { message: 'fixture' } } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'mcp', target: 'out' }] }
saved = await save(mcpWf); started = saved.response.ok ? await request('/api/workflows/phase0-mcp/run', { method: 'POST', ...json({ input: '{"message":"fixture"}' }) }) : saved; run = started.response?.ok ? await waitRun(started.body.runId) : started.body
check(mcpAdded.response.ok && mcpAdded.body.reviewRequired === true && run.status === 'failed' && String(run.events?.at(-1)?.text || '').includes('disabled'), 'new local stdio MCP server is blocked before explicit review', JSON.stringify(run))
const mcpReviewed = await request('/api/tools/mcp/phase0-echo', { method: 'PUT', ...json({ reviewed: true, enabled: true }) })
started = mcpReviewed.response.ok ? await request('/api/workflows/phase0-mcp/run', { method: 'POST', ...json({ input: '{"message":"fixture"}' }) }) : mcpReviewed; run = started.response?.ok ? await waitRun(started.body.runId) : started.body
check(mcpReviewed.response.ok && run.status === 'done' && String(run.result).includes('fixture'), 'reviewed local stdio MCP tool executes through deterministic fixture', JSON.stringify(run))
await request('/api/tools/mcp/phase0-echo', { method: 'DELETE' })

const learning = await request('/api/learning/analyze', { method: 'POST', ...json({ workflowId: 'phase0-resume' }) })
check(learning.response.ok && Array.isArray(learning.body), 'learning analyzer produces evidence-backed proposal list')

const cancellationWf = { id: 'phase0-cancel', name: 'Cancellation', nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'wait', type: 'delay', data: { label: 'Long Wait', durationMs: 10000 } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'in', target: 'wait' }, { id: 'e2', source: 'wait', target: 'out' }] }
await save(cancellationWf); started = await request('/api/workflows/phase0-cancel/run', { method: 'POST', ...json({ input: 'cancel me' }) })
await new Promise(resolve => setTimeout(resolve, 150)); const cancelStartedAt = Date.now(); await request(`/api/runs/${started.body.runId}/stop`, { method: 'POST' }); const cancelled = await waitRun(started.body.runId, 3000)
check(cancelled.status === 'cancelled' && Date.now() - cancelStartedAt < 2500, 'cancellation interrupts a waiting node promptly')
const nestedCancelChild = { ...cancellationWf, id: 'phase0-nested-cancel-child', name: 'Nested Cancel Child' }
const nestedCancelParent = { id: 'phase0-nested-cancel-parent', name: 'Nested Cancel Parent', nodes: [{ id: 'sub', type: 'subworkflow', data: { label: 'Nested Wait', workflowId: nestedCancelChild.id } }], edges: [] }
await save(nestedCancelChild); await save(nestedCancelParent); started = await request(`/api/workflows/${nestedCancelParent.id}/run`, { method: 'POST', ...json({ input: 'cancel nested' }) })
let activeParent
for (let attempt = 0; attempt < 20; attempt++) { activeParent = (await request(`/api/runs/${started.body.runId}/detail`)).body; if (activeParent.childRunIds?.length) break; await new Promise(resolve => setTimeout(resolve, 50)) }
const nestedChildRunId = activeParent?.childRunIds?.[0]
await request(`/api/runs/${started.body.runId}/stop`, { method: 'POST' }); const nestedCancelledParent = await waitRun(started.body.runId, 3000); const nestedCancelledChild = nestedChildRunId ? await waitRun(nestedChildRunId, 3000) : null
check(nestedCancelledParent.status === 'cancelled' && nestedCancelledChild?.status === 'cancelled', 'parent cancellation propagates to the active child workflow')
const processCancelWf = { id: 'phase0-process-cancel', name: 'Process Cancellation', nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'shell', type: 'shell', data: { label: 'Long Process', command: 'sleep 10; echo should-not-complete', timeoutMs: 20000 } }, { id: 'out', type: 'output', data: { label: 'Output' } }], edges: [{ id: 'e1', source: 'in', target: 'shell' }, { id: 'e2', source: 'shell', target: 'out' }] }
await save(processCancelWf); started = await request('/api/workflows/phase0-process-cancel/run', { method: 'POST', ...json({ input: 'cancel process' }) }); await new Promise(resolve => setTimeout(resolve, 200)); const processCancelAt = Date.now(); await request(`/api/runs/${started.body.runId}/stop`, { method: 'POST' }); const processCancelled = await waitRun(started.body.runId, 3000)
check(processCancelled.status === 'cancelled' && Date.now() - processCancelAt < 2500, 'cancellation terminates an active subprocess group promptly')

const parallelWf = { id: 'phase0-parallel-graph', name: 'Parallel Graph', settings: { parallelism: 2 }, nodes: [{ id: 'in', type: 'input', data: { label: 'Input' } }, { id: 'a', type: 'delay', data: { label: 'Branch A', durationMs: 450 } }, { id: 'b', type: 'delay', data: { label: 'Branch B', durationMs: 450 } }, { id: 'out', type: 'output', data: { label: 'Merge' } }], edges: [{ id: 'e1', source: 'in', target: 'a' }, { id: 'e2', source: 'in', target: 'b' }, { id: 'e3', source: 'a', target: 'out' }, { id: 'e4', source: 'b', target: 'out' }] }
await save(parallelWf); const graphStartedAt = Date.now(); started = await request('/api/workflows/phase0-parallel-graph/run', { method: 'POST', ...json({ input: 'parallel' }) }); const parallelRun = await waitRun(started.body.runId)
check(parallelRun.status === 'done' && Date.now() - graphStartedAt < 800 && (parallelRun.events || []).some(event => String(event.text).includes('independent workflow branches')), 'independent graph branches execute concurrently before fan-in')

for (const id of ['phase0-schema-runtime', 'phase0-custom-runtime', 'phase0-child', 'phase0-parent', 'phase0-parent-missing-pin', 'phase0-parent-denied', 'phase0-recursive', 'phase0-resume', 'phase0-mcp', 'phase0-cancel', 'phase0-nested-cancel-child', 'phase0-nested-cancel-parent', 'phase0-process-cancel', 'phase0-parallel-graph']) await removeWorkflow(id)
await request('/api/custom-nodes/phase0-upper', { method: 'DELETE' })
await request('/api/evaluations/phase0-eval', { method: 'DELETE' })

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
if (failed) process.exitCode = 1
