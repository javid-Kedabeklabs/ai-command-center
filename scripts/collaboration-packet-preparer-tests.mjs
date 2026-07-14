import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareTaskPacket } from '../server/collaboration/packet-preparer.js'

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-packet-preparer-'))
fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); fs.mkdirSync(path.join(root, 'tests'), { recursive: true })
fs.writeFileSync(path.join(root, 'docs', 'behavior.md'), 'frozen behavior\n'); fs.writeFileSync(path.join(root, 'tests', 'accept.mjs'), 'assert true\n')
git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'reviewed base'])
const baseSha = git(root, ['rev-parse', 'HEAD'])
const cli = fs.realpathSync(new URL('./collaboration/prepare-task-packet.mjs', import.meta.url).pathname)
const draft = (overrides = {}) => ({
  taskId: 'prepared-ui-slice', title: 'Prepared UI slice', status: 'QUEUED', phase: 'COLLABORATION', priority: 50, createdBy: 'codex', assignedWorker: 'claude-fable', taskType: 'UX_IMPLEMENTATION',
  objective: 'Implement one already-specified UI state without creating semantics.', background: 'All authority and acceptance inputs are frozen at the reviewed base.',
  acceptanceCriteria: ['The frozen acceptance scenario passes.'], filesAllowed: ['web/src/feature/**'], filesForbidden: ['server/**'], readOnlyContextFiles: [], dependencies: [], requiredTests: ['node tests/accept.mjs'],
  permissionProfile: 'WORKTREE_IMPLEMENTATION', modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' }, maxTurns: 12, timeoutSeconds: 600, allowSubagents: false, allowNetwork: false, requiresCommit: true,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
  contractPlan: {
    reviewedBaseSha: baseSha, acceptanceTestCommitSha: baseSha, scenarioIds: ['PREPARE-01'], maxChangedFiles: 8, planningCodexSeconds: 7200,
    stopConditions: ['Stop outside the leased paths.', 'Stop when an authority input changes.', 'Stop rather than weaken acceptance evidence.'],
    authoritySet: {
      productBehavior: { disposition: 'bound', paths: ['docs/behavior.md'] }, securityAndCapabilities: { disposition: 'not-applicable-and-forbidden', paths: [] }, persistenceSchema: { disposition: 'not-applicable-and-forbidden', paths: [] }, semanticPort: { disposition: 'not-applicable-and-forbidden', paths: [] }, wireApi: { disposition: 'not-applicable-and-forbidden', paths: [] }, designAndCopy: { disposition: 'not-applicable-and-forbidden', paths: [] }, acceptanceTests: { disposition: 'bound', paths: ['tests/accept.mjs'] },
    },
    acceptanceSet: { tests: [{ id: 'PREPARE-01', path: 'tests/accept.mjs' }], environment: { locale: 'en-US', timezone: 'UTC', clockSeed: 'fixed', dataSeed: 'fixture-v1' } },
  },
  ...overrides,
})

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`) }
console.log('== authority-complete packet preparation ==')
try {
  test('generates deterministic hashes, read-only context, and a verified nondispatch receipt', () => {
    const first = prepareTaskPacket({ repositoryRoot: root, draft: draft() }), second = prepareTaskPacket({ repositoryRoot: root, draft: draft() })
    assert.deepEqual(first, second); assert.equal(first.task.schemaVersion, 3); assert.deepEqual(first.task.readOnlyContextFiles, ['docs/behavior.md', 'tests/accept.mjs'])
    assert(first.task.contractPack.contractFiles.every(item => /^[a-f0-9]{64}$/.test(item.sha256)))
    assert.equal(first.preparationReceipt.preparedWithoutDispatch, true); assert.equal(first.preparationReceipt.dispatchAttestation.signed, false)
  })
  test('CLI reads a bounded draft from stdin and emits the same validated packet', () => {
    const output = JSON.parse(execFileSync(process.execPath, [cli], { cwd: root, input: JSON.stringify(draft()), encoding: 'utf8' }))
    assert.equal(output.task.taskId, 'prepared-ui-slice'); assert.equal(output.preparationReceipt.preparedWithoutDispatch, true)
  })
  test('permits dirty runtime data but rejects dirty source', () => {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true }); fs.writeFileSync(path.join(root, 'data', 'runtime.json'), '{}')
    assert.equal(prepareTaskPacket({ repositoryRoot: root, draft: draft() }).task.taskId, 'prepared-ui-slice')
    fs.writeFileSync(path.join(root, 'source-dirt.txt'), 'unreviewed')
    assert.throws(() => prepareTaskPacket({ repositoryRoot: root, draft: draft() }), error => error.code === 'COLLABORATION_PREPARE_DIRTY_SOURCE')
    fs.rmSync(path.join(root, 'source-dirt.txt'))
  })
  test('rejects missing authority categories and writable authority overlap', () => {
    const missing = draft(); delete missing.contractPlan.authoritySet.wireApi
    assert.throws(() => prepareTaskPacket({ repositoryRoot: root, draft: missing }), /wireApi/)
    const overlap = draft({ filesAllowed: ['docs/**'] })
    assert.throws(() => prepareTaskPacket({ repositoryRoot: root, draft: overlap }), /cannot overlap writable/)
  })
  test('rejects a stale reviewed base and absent authority blob', () => {
    fs.writeFileSync(path.join(root, 'next.txt'), 'next'); git(root, ['add', 'next.txt']); git(root, ['commit', '-qm', 'advance'])
    assert.throws(() => prepareTaskPacket({ repositoryRoot: root, draft: draft() }), error => error.code === 'COLLABORATION_PREPARE_BASE_STALE')
    const current = git(root, ['rev-parse', 'HEAD']), absent = draft(); absent.contractPlan.reviewedBaseSha = current; absent.contractPlan.acceptanceTestCommitSha = current; absent.contractPlan.authoritySet.productBehavior.paths = ['docs/missing.md']
    assert.throws(() => prepareTaskPacket({ repositoryRoot: root, draft: absent }), error => error.code === 'COLLABORATION_PREPARE_AUTHORITY_MISSING')
  })
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
