import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = fs.mkdtempSync(path.join(root, '.agent-architecture-live-'))
const dataDir = path.join(fixtureRoot, 'data')
const brainDir = path.join(fixtureRoot, 'brain')
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(brainDir, { recursive: true })
const legacy = [
  { id: 'coder', avatar: '🛠', name: 'Coder', model: 'lmstudio/test-coder', prompt: 'Build and test.', folder: path.join(fixtureRoot, 'workspace'), permissions: 'standard', role: 'Software Engineer', department: 'Engineering' },
  { id: 'editor', avatar: '✍️', name: 'Editor', model: 'lmstudio/test-writer', prompt: 'Edit carefully.', folder: path.join(fixtureRoot, 'editor'), permissions: 'readonly', role: 'Editor', department: 'Editorial' },
]
fs.writeFileSync(path.join(dataDir, 'agents.json'), JSON.stringify(legacy, null, 2))

const port = await new Promise((resolve, reject) => {
  const socket = net.createServer()
  socket.once('error', reject)
  socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(() => resolve(value)) })
})
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ACC_DATA_DIR: path.relative(root, dataDir), ACC_BRAIN_DIR: path.relative(root, brainDir), ACC_SKIP_AGENT_MIRROR: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
let stderr = ''
server.stderr.on('data', chunk => { stderr += chunk })

async function request(route, options = {}) {
  const response = await fetch(base + route, options)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { response, body }
}
const mutation = body => ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-intent': 'agent-architecture-change' }, body: JSON.stringify(body) })
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch(base + '/api/agents')).ok) break } catch {}
  if (attempt === 99) throw new Error(`server did not start: ${stderr}`)
  await new Promise(resolve => setTimeout(resolve, 25))
}

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`  PASS  ${name}`) }
console.log('== live agent architecture API ==')
try {
  let preview
  await test('preview is live, nondestructive, and identifies ambiguous legacy roles', async () => {
    const result = await request('/api/agents/migration-preview')
    assert.equal(result.response.status, 200)
    preview = result.body
    assert.equal(preview.architectureRevision, 0)
    assert.equal(preview.summary.ready, 1)
    assert.equal(preview.summary.reviewRequired, 1)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'agents.json'), 'utf8')), legacy)
  })

  let migration
  await test('migration requires intent and returns immutable architecture identity', async () => {
    const proposal = preview.proposals.find(item => item.legacyAgentId === 'coder')
    const denied = await request('/api/agents/coder/migrate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(denied.response.status, 400)
    const result = await request('/api/agents/coder/migrate', mutation({ expectedLegacyHash: proposal.legacySnapshotHash, expectedRevision: 0, commandId: 'live-migrate-coder' }))
    assert.equal(result.response.status, 201)
    migration = result.body
    assert.equal(migration.receipt.primitiveId, 'coder')
    const agents = await request('/api/agents')
    assert.equal(agents.response.status, 200, `${agents.body}\n${stderr}`)
    assert.ok(Array.isArray(agents.body), `${agents.body}\n${stderr}`)
    assert.deepEqual(agents.body.find(item => item.id === 'coder').architecture, { primitiveId: 'coder', roleCardId: 'legacy-coder', roleCardVersion: 1, agentInstanceId: 'coder', organizationalClass: 'shared_service', status: 'available' })
  })

  await test('Company World exposes technical identity without replacing the human-facing role', async () => {
    const world = await request('/api/company-world/state')
    const coder = world.body.agents.find(item => item.id === 'coder')
    assert.equal(coder.role, 'Software Engineer')
    assert.equal(coder.architecture.primitiveId, 'coder')
    assert.equal(coder.architecture.roleCardVersion, 1)
  })

  await test('workflow assignments bind an exact instance and Role Card version', async () => {
    const result = await request('/api/workflow-assignments/live-coder-build', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-command-center-intent': 'agent-architecture-change' }, body: JSON.stringify({ expectedRevision: 1, workflowId: 'live-workflow', nodeId: 'build', agentInstanceId: 'coder', roleCardId: 'legacy-coder', roleCardVersion: 1, assignmentInstructions: 'Build the exact reviewed slice.' }) })
    assert.equal(result.response.status, 200)
    assert.equal(result.body.revision, 2)
    assert.equal(result.body.assignment.agentInstanceId, 'coder')
    assert.equal(Object.prototype.hasOwnProperty.call(result.body.assignment, 'expectedRevision'), false)
  })

  await test('ambiguous mappings and stale revisions fail closed', async () => {
    const proposal = preview.proposals.find(item => item.legacyAgentId === 'editor')
    const ambiguous = await request('/api/agents/editor/migrate', mutation({ expectedLegacyHash: proposal.legacySnapshotHash, expectedRevision: 2, commandId: 'ambiguous-editor' }))
    assert.equal(ambiguous.response.status, 409)
    const stale = await request('/api/agents/editor/migrate', mutation({ primitiveId: 'writer', expectedLegacyHash: proposal.legacySnapshotHash, expectedRevision: 0, commandId: 'stale-editor' }))
    assert.equal(stale.response.status, 412)
  })

  await test('rollback restores legacy fallback and retains the architecture audit ledger', async () => {
    const proposal = preview.proposals.find(item => item.legacyAgentId === 'coder')
    const result = await request('/api/agents/coder/migration-rollback', mutation({ expectedLegacyHash: proposal.legacySnapshotHash, expectedRevision: 2, commandId: 'live-rollback-coder' }))
    assert.equal(result.response.status, 200)
    assert.equal(result.body.receipt.migratedReceiptHash, migration.receipt.receiptHash)
    const agents = await request('/api/agents')
    assert.equal(agents.body.find(item => item.id === 'coder').architecture, null)
    const architecture = await request('/api/agent-architecture')
    assert.equal(architecture.body.revision, 3)
    assert.equal(architecture.body.migrationReceipts.length, 2)
    assert.equal(architecture.body.primitives.length, 14)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'agents.json'), 'utf8')), legacy)
  })
} finally {
  server.kill('SIGTERM')
  await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 2500).unref() })
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
