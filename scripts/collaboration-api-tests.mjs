import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { execFileSync } from 'node:child_process'
import { createCollaborationRouter } from '../server/collaboration/router.js'
import { createCollaborationTaskStore } from '../server/collaboration/task-store.js'
import { createWorktreeManager } from '../server/collaboration/worktree-manager.js'

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-collaboration-api-'))
fs.mkdirSync(path.join(root, 'src'), { recursive: true })
fs.writeFileSync(path.join(root, '.gitignore'), '.claude/worktrees/\nstate/collaboration/\n')
fs.writeFileSync(path.join(root, 'src', 'fixture.txt'), 'base\n')
git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'base'])
const taskStore = createCollaborationTaskStore({ repositoryRoot: root })
const worktreeManager = createWorktreeManager({ repositoryRoot: root })
const audits = []
const app = express(); app.use(express.json()); app.use('/api/collaboration', createCollaborationRouter({ taskStore, worktreeManager, appendAudit: (...entry) => audits.push(entry) }))
const server = http.createServer(app)
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/collaboration`
const packet = {
  schemaVersion: 1, taskId: 'api-fable-task', title: 'Bounded UI implementation', status: 'QUEUED', phase: 'COLLABORATION', priority: 50,
  createdBy: 'codex', assignedWorker: 'claude-fable', taskType: 'UX_IMPLEMENTATION', objective: 'Implement one bounded UI slice.',
  background: 'The API stores a task packet but never dispatches it automatically.', acceptanceCriteria: ['Packet is validated and durable.'],
  filesAllowed: ['web/src/components/**'], filesForbidden: ['server/**', 'data/**'], readOnlyContextFiles: ['web/src/api.ts'], dependencies: [],
  requiredTests: ['npm run build'], permissionProfile: 'WORKTREE_IMPLEMENTATION', modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' },
  maxTurns: 20, timeoutSeconds: 600, allowSubagents: false, allowNetwork: false, requiresCommit: true,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
}
const request = async (route, options) => { const response = await fetch(base + route, options); return { response, body: await response.json() } }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== collaboration control-plane API ==')
try {
  await test('reports a sanitized non-dispatching control plane', async () => {
    const { response, body } = await request('/status')
    assert.equal(response.status, 200); assert.equal(body.dispatchEnabled, false); assert.equal(body.worktreeEnabled, true); assert.equal(body.policy.centralRuntimeWriter, 'codex')
    assert.equal(JSON.stringify(body).includes(root), false)
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
} finally {
  server.close(); await new Promise(resolve => server.once('close', resolve)); fs.rmSync(root, { recursive: true, force: true })
}
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
