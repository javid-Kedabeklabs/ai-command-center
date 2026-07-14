import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { verifyTaskContract } from '../server/collaboration/contract-verifier.js'

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-contract-'))
fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
fs.writeFileSync(path.join(root, 'docs', 'contract.md'), 'frozen contract\n')
git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'freeze contract'])
const baseSha = git(root, ['rev-parse', 'HEAD'])
const contractHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'docs', 'contract.md'))).digest('hex')
const packet = (overrides = {}) => ({
  schemaVersion: 2, taskId: 'contract-fixture', title: 'Contract fixture', status: 'QUEUED', phase: 'COLLABORATION', priority: 50,
  createdBy: 'codex', assignedWorker: 'claude-fable', taskType: 'IMPLEMENTATION', objective: 'Implement one bounded contract-proven fixture safely.',
  background: 'The fixture verifies dispatch-time provenance without external calls.', acceptanceCriteria: ['Frozen inputs are verified before dispatch.'],
  filesAllowed: ['web/feature/**'], filesForbidden: ['server/**'], readOnlyContextFiles: ['docs/contract.md'], dependencies: [], requiredTests: ['node fixture'],
  permissionProfile: 'WORKTREE_IMPLEMENTATION', modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' }, maxTurns: 10, timeoutSeconds: 300,
  allowSubagents: false, allowNetwork: false, requiresCommit: true, expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
  contractPack: { reviewedBaseSha: baseSha, acceptanceTestCommitSha: baseSha, contractFiles: [{ path: 'docs/contract.md', sha256: contractHash }], scenarioIds: ['CONTRACT-01'], maxChangedFiles: 10, estimatedCodexSeconds: 3600, stopConditions: ['Stop outside leased paths.', 'Stop when contract inputs drift.', 'Stop rather than weaken tests.'] },
  ...overrides,
})
let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== collaboration contract freeze ==')
try {
  test('verifies the exact current base, acceptance ancestor, and content hashes', () => {
    const receipt = verifyTaskContract({ repositoryRoot: root, taskPacket: packet(), requestedBaseSha: baseSha })
    assert.equal(receipt.verified, true); assert.equal(receipt.reviewedBaseSha, baseSha); assert.equal(receipt.contractFiles[0].sha256, contractHash)
  })
  test('rejects a dispatch base different from the reviewed packet base', () => {
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: packet(), requestedBaseSha: 'f'.repeat(40) }), error => error.code === 'COLLABORATION_CONTRACT_BASE_MISMATCH')
  })
  test('rejects altered contract hashes and stale reviewed heads', () => {
    const wrong = packet({ contractPack: { ...packet().contractPack, contractFiles: [{ path: 'docs/contract.md', sha256: 'f'.repeat(64) }] } })
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: wrong, requestedBaseSha: baseSha }), error => error.code === 'COLLABORATION_CONTRACT_HASH_MISMATCH')
    fs.writeFileSync(path.join(root, 'next.txt'), 'next\n'); git(root, ['add', '.']); git(root, ['commit', '-qm', 'advance head'])
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: packet(), requestedBaseSha: baseSha }), error => error.code === 'COLLABORATION_CONTRACT_BASE_STALE')
  })
  test('rejects legacy packets before any work reservation', () => {
    const { contractPack, ...legacy } = packet({ schemaVersion: 1 })
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: legacy, requestedBaseSha: baseSha }), error => error.code === 'COLLABORATION_PACKET_UPGRADE_REQUIRED')
  })
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
