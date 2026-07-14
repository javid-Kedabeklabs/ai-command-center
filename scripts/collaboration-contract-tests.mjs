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
  schemaVersion: 3, taskId: 'contract-fixture', title: 'Contract fixture', status: 'QUEUED', phase: 'COLLABORATION', priority: 50,
  createdBy: 'codex', assignedWorker: 'claude-fable', taskType: 'IMPLEMENTATION', objective: 'Implement one bounded contract-proven fixture safely.',
  background: 'The fixture verifies dispatch-time provenance without external calls.', acceptanceCriteria: ['Frozen inputs are verified before dispatch.'],
  filesAllowed: ['web/feature/**'], filesForbidden: ['server/**'], readOnlyContextFiles: ['docs/contract.md'], dependencies: [], requiredTests: ['node fixture'],
  permissionProfile: 'WORKTREE_IMPLEMENTATION', modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' }, maxTurns: 10, timeoutSeconds: 300,
  allowSubagents: false, allowNetwork: false, requiresCommit: true, expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true },
  contractPack: {
    reviewedBaseSha: baseSha, acceptanceTestCommitSha: baseSha, contractFiles: [{ path: 'docs/contract.md', sha256: contractHash }], scenarioIds: ['CONTRACT-01'], maxChangedFiles: 10, planningCodexSeconds: 3600,
    stopConditions: ['Stop outside leased paths.', 'Stop when contract inputs drift.', 'Stop rather than weaken tests.'],
    authoritySet: {
      productBehavior: { disposition: 'bound', paths: ['docs/contract.md'] }, securityAndCapabilities: { disposition: 'not-applicable-and-forbidden', paths: [] },
      persistenceSchema: { disposition: 'not-applicable-and-forbidden', paths: [] }, semanticPort: { disposition: 'not-applicable-and-forbidden', paths: [] },
      wireApi: { disposition: 'not-applicable-and-forbidden', paths: [] }, designAndCopy: { disposition: 'not-applicable-and-forbidden', paths: [] },
      acceptanceTests: { disposition: 'bound', paths: ['docs/contract.md'] },
    },
    acceptanceSet: { tests: [{ id: 'CONTRACT-01', path: 'docs/contract.md', sha256: contractHash }], environment: { locale: 'en-US', timezone: 'UTC', clockSeed: 'fixed', dataSeed: 'fixture-v1' } },
  },
  ...overrides,
})
let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== collaboration contract freeze ==')
try {
  test('verifies the exact current base, acceptance ancestor, and content hashes', () => {
    const receipt = verifyTaskContract({ repositoryRoot: root, taskPacket: packet(), requestedBaseSha: baseSha })
    assert.equal(receipt.verified, true); assert.equal(receipt.reviewedBaseSha, baseSha); assert.equal(receipt.contractFiles[0].sha256, contractHash)
    assert.match(receipt.authoritySetId, /^[a-f0-9]{64}$/); assert.match(receipt.acceptanceSetId, /^[a-f0-9]{64}$/)
    assert.equal(receipt.dispatchAttestation.signed, false); assert.equal(receipt.dispatchAttestation.mode, 'DIGEST_BOUND_LOCAL')
  })
  test('rejects a dispatch base different from the reviewed packet base', () => {
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: packet(), requestedBaseSha: 'f'.repeat(40) }), error => error.code === 'COLLABORATION_CONTRACT_BASE_MISMATCH')
  })
  test('rejects altered contract hashes', () => {
    const wrong = packet({ contractPack: { ...packet().contractPack, contractFiles: [{ path: 'docs/contract.md', sha256: 'f'.repeat(64) }] } })
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: wrong, requestedBaseSha: baseSha }), error => error.code === 'COLLABORATION_CONTRACT_HASH_MISMATCH')
  })
  test('rejects omitted authority categories and mismatched acceptance identity', () => {
    const missing = packet(); delete missing.contractPack.authoritySet.wireApi
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: missing, requestedBaseSha: baseSha }), /wireApi is required/)
    const mismatch = packet({ contractPack: { ...packet().contractPack, acceptanceSet: { ...packet().contractPack.acceptanceSet, tests: [{ id: 'CONTRACT-01', path: 'docs/contract.md', sha256: 'f'.repeat(64) }] } } })
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: mismatch, requestedBaseSha: baseSha }), error => error.code === 'COLLABORATION_ACCEPTANCE_HASH_MISMATCH')
  })
  test('rejects stale reviewed heads', () => {
    fs.writeFileSync(path.join(root, 'next.txt'), 'next\n'); git(root, ['add', '.']); git(root, ['commit', '-qm', 'advance head'])
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: packet(), requestedBaseSha: baseSha }), error => error.code === 'COLLABORATION_CONTRACT_BASE_STALE')
  })
  test('rejects legacy packets before any work reservation', () => {
    const legacy = { ...packet(), schemaVersion: 2, contractPack: { reviewedBaseSha: baseSha, acceptanceTestCommitSha: baseSha, contractFiles: [{ path: 'docs/contract.md', sha256: contractHash }], scenarioIds: ['CONTRACT-01'], maxChangedFiles: 10, estimatedCodexSeconds: 3600, stopConditions: ['Stop outside leased paths.', 'Stop when contract inputs drift.', 'Stop rather than weaken tests.'] } }
    assert.throws(() => verifyTaskContract({ repositoryRoot: root, taskPacket: legacy, requestedBaseSha: baseSha }), error => error.code === 'COLLABORATION_PACKET_UPGRADE_REQUIRED')
  })
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
