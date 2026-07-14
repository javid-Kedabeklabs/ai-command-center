import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { classifyTaskPacketCompatibility, createCollaborationRouter } from '../server/collaboration/router.js'
import { createCollaborationTaskStore } from '../server/collaboration/task-store.js'
import { createWorktreeManager } from '../server/collaboration/worktree-manager.js'
import { createDeliveryMetricsStore } from '../server/collaboration/delivery-metrics.js'

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-collaboration-api-'))
fs.mkdirSync(path.join(root, 'src'), { recursive: true })
fs.writeFileSync(path.join(root, '.gitignore'), '.claude/worktrees/\nstate/collaboration/\n')
fs.writeFileSync(path.join(root, 'src', 'fixture.txt'), 'base\n')
git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'base'])
const taskStore = createCollaborationTaskStore({ repositoryRoot: root })
const worktreeManager = createWorktreeManager({ repositoryRoot: root })
const metricsStore = createDeliveryMetricsStore({ repositoryRoot: root })
const questionLedgerFile = fs.realpathSync(new URL('../docs/OPEN_QUESTIONS.md', import.meta.url).pathname)
const audits = []
const app = express(); app.use(express.json()); app.use('/api/collaboration', createCollaborationRouter({ taskStore, worktreeManager, metricsStore, questionLedgerFile, appendAudit: (...entry) => audits.push(entry) }))
const server = http.createServer(app)
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/collaboration`
const baseSha = git(root, ['rev-parse', 'HEAD'])
const contractHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src', 'fixture.txt'))).digest('hex')
const packet = {
  schemaVersion: 2, taskId: 'api-fable-task', title: 'Bounded UI implementation', status: 'QUEUED', phase: 'COLLABORATION', priority: 50,
  createdBy: 'codex', assignedWorker: 'claude-fable', taskType: 'UX_IMPLEMENTATION', objective: 'Implement one bounded UI slice.',
  background: 'The API stores a task packet but never dispatches it automatically.', acceptanceCriteria: ['Packet is validated and durable.'],
  filesAllowed: ['web/src/components/**'], filesForbidden: ['server/**', 'data/**'], readOnlyContextFiles: ['src/fixture.txt'], dependencies: [],
  requiredTests: ['npm run build'], permissionProfile: 'WORKTREE_IMPLEMENTATION', modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' },
  maxTurns: 20, timeoutSeconds: 600, allowSubagents: false, allowNetwork: false, requiresCommit: true,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
  contractPack: { reviewedBaseSha: baseSha, acceptanceTestCommitSha: baseSha, contractFiles: [{ path: 'src/fixture.txt', sha256: contractHash }], scenarioIds: ['API-01'], maxChangedFiles: 25, estimatedCodexSeconds: 3600, stopConditions: ['Stop outside the leased paths.', 'Stop when a frozen contract changes.', 'Stop rather than weaken acceptance tests.'] },
}
const request = async (route, options) => { const response = await fetch(base + route, options); return { response, body: await response.json() } }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== collaboration control-plane API ==')
try {
  await test('distinguishes terminal legacy evidence from packets that require upgrade', () => {
    const result = classifyTaskPacketCompatibility([
      { status: 'FAILED', task: { schemaVersion: 1 } }, { status: 'COMPLETED', task: { schemaVersion: 1 } },
      { status: 'BLOCKED', task: { schemaVersion: 1 } }, { status: 'QUEUED', task: { schemaVersion: 2 } },
    ])
    assert.deepEqual(result, { contractComplete: 1, legacyRecords: 3, upgradeRequired: 1, historicalLegacy: 2 })
  })
  await test('reports a sanitized non-dispatching control plane', async () => {
    const { response, body } = await request('/status')
    assert.equal(response.status, 200); assert.equal(body.dispatchEnabled, false); assert.equal(body.worktreeEnabled, true); assert.equal(body.dispatchContract.verified, true); assert.equal(body.taskPacketContract.currentSchemaVersion, 2); assert.equal(body.taskPacketContract.historicalLegacy, 0); assert.equal(body.metrics.mode, 'SHADOW_ONLY'); assert.equal(body.metrics.observations, 0); assert.equal(body.policy.centralRuntimeWriter, 'codex')
    assert.equal(JSON.stringify(body).includes(root), false)
  })
  await test('serves the durable question ledger read-only with exact status filtering', async () => {
    const all = await request('/questions'), open = await request('/questions?status=OPEN'), invalid = await request('/questions?status=unknown')
    assert.equal(all.response.status, 200); assert(all.body.questions.length >= open.body.questions.length); assert(open.body.questions.length > 0)
    assert(open.body.questions.every(item => item.status === 'OPEN')); assert.equal(invalid.response.status, 400)
    assert.equal(all.response.headers.get('cache-control'), 'no-store')
  })
  await test('requires explicit mutation intent and validates task packets', async () => {
    const denied = await request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) })
    assert.equal(denied.response.status, 400)
    const invalid = await request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-intent': 'collaboration-task-change' }, body: JSON.stringify({ ...packet, allowNetwork: true }) })
    assert.equal(invalid.response.status, 400)
  })
  await test('persists an idempotent task packet without dispatching a worker', async () => {
    const options = { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-intent': 'collaboration-task-change' }, body: JSON.stringify(packet) }
    const first = await request('/tasks', options), replay = await request('/tasks', options)
    assert.equal(first.response.status, 201, JSON.stringify(first.body)); assert.equal(replay.response.status, 200)
    assert.equal(first.body.dispatchEnabled, false); assert.equal(first.body.task.status, 'QUEUED'); assert.equal(audits.length, 2)
    const listed = await request('/tasks'); assert.equal(listed.body.length, 1); assert.equal(listed.body[0].taskId, packet.taskId)
    const detail = await request(`/tasks/${packet.taskId}`); assert.equal(detail.body.task.objective, packet.objective)
  })
  await test('never exposes absolute lease paths', async () => {
    worktreeManager.create({ taskId: 'lease-api-task', baseSha: git(root, ['rev-parse', 'HEAD']) })
    const leases = await request('/leases')
    assert.equal(leases.response.status, 200); assert.equal(leases.body.length, 1); assert.equal(Object.hasOwn(leases.body[0], 'path'), false)
  })
  await test('keeps live dispatch disabled even with explicit mutation intent', async () => {
    const result = await request(`/tasks/${packet.taskId}/dispatch`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-intent': 'collaboration-dispatch' }, body: '{}' })
    assert.equal(result.response.status, 409); assert.equal(result.body.code, 'COLLABORATION_DISPATCH_DISABLED'); assert.equal(result.body.dispatchEnabled, false)
  })
  await test('exposes empty shadow metrics and denies unproven outcome recording', async () => {
    const metrics = await request('/metrics')
    assert.equal(metrics.response.status, 200); assert.equal(metrics.body.summary.mode, 'SHADOW_ONLY'); assert.deepEqual(metrics.body.observations, [])
    const denied = await request('/metrics/outcomes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(denied.response.status, 400)
  })
} finally {
  server.close(); await new Promise(resolve => server.once('close', resolve)); fs.rmSync(root, { recursive: true, force: true })
}
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
