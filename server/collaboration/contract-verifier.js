import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { validateTaskPacket } from './task-schema.js'

const git = (repository, args, options = {}) => execFileSync('git', ['-C', repository, ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...options })
const contractError = (message, code = 'COLLABORATION_CONTRACT_MISMATCH') => Object.assign(new Error(message), { code })
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

export function verifyTaskContract({ repositoryRoot, taskPacket, requestedBaseSha } = {}) {
  const task = validateTaskPacket(taskPacket)
  if (task.schemaVersion !== 3 || !task.contractPack) throw contractError('task packet must be upgraded to the authority-complete schema', 'COLLABORATION_PACKET_UPGRADE_REQUIRED')
  const repository = fs.realpathSync(path.resolve(repositoryRoot)), contract = task.contractPack
  if (requestedBaseSha !== contract.reviewedBaseSha) throw contractError('dispatch base does not match the frozen task contract', 'COLLABORATION_CONTRACT_BASE_MISMATCH')
  let resolvedBase, head
  try {
    resolvedBase = String(git(repository, ['rev-parse', '--verify', `${contract.reviewedBaseSha}^{commit}`], { encoding: 'utf8' })).trim()
    head = String(git(repository, ['rev-parse', 'HEAD'], { encoding: 'utf8' })).trim()
  } catch { throw contractError('frozen task base is not available in the repository', 'COLLABORATION_CONTRACT_BASE_MISSING') }
  if (resolvedBase !== contract.reviewedBaseSha || head !== resolvedBase) throw contractError('frozen task base is not the current reviewed repository HEAD', 'COLLABORATION_CONTRACT_BASE_STALE')
  const ancestor = spawnSync('git', ['-C', repository, 'merge-base', '--is-ancestor', contract.acceptanceTestCommitSha, resolvedBase], { stdio: 'ignore' })
  if (ancestor.status !== 0) throw contractError('frozen acceptance-test commit is not an ancestor of the reviewed base', 'COLLABORATION_ACCEPTANCE_TEST_NOT_FROZEN')
  const verifiedFiles = []
  for (const item of contract.contractFiles) {
    let content
    try { content = git(repository, ['show', `${resolvedBase}:${item.path}`], { encoding: null, maxBuffer: 16 * 1024 * 1024 }) }
    catch { throw contractError(`frozen contract file is unavailable: ${item.path}`, 'COLLABORATION_CONTRACT_FILE_MISSING') }
    const actual = crypto.createHash('sha256').update(content).digest('hex')
    if (actual !== item.sha256) throw contractError(`frozen contract file hash mismatch: ${item.path}`, 'COLLABORATION_CONTRACT_HASH_MISMATCH')
    verifiedFiles.push({ path: item.path, sha256: actual })
  }
  for (const test of contract.acceptanceSet.tests) {
    const frozen = verifiedFiles.find(item => item.path === test.path)
    if (!frozen || frozen.sha256 !== test.sha256) throw contractError(`frozen acceptance test hash mismatch: ${test.path}`, 'COLLABORATION_ACCEPTANCE_HASH_MISMATCH')
  }
  const authorityEvidence = Object.fromEntries(Object.entries(contract.authoritySet).map(([category, entry]) => [category, { disposition: entry.disposition, files: entry.paths.map(filePath => verifiedFiles.find(item => item.path === filePath)) }]))
  const authoritySetId = digest(authorityEvidence), acceptanceSetId = digest(contract.acceptanceSet)
  const baseReadyAttestation = { reviewedBaseSha: resolvedBase, acceptanceTestCommitSha: contract.acceptanceTestCommitSha, authoritySetId, acceptanceSetId }
  const taskPacketDigest = digest(task)
  const dispatchAttestation = {
    mode: 'DIGEST_BOUND_LOCAL', signed: false, taskPacketDigest, baseReadyAttestationDigest: digest(baseReadyAttestation),
    authoritySetId, acceptanceSetId,
  }
  dispatchAttestation.dispatchId = digest(dispatchAttestation)
  return Object.freeze({ schemaVersion: 2, taskId: task.taskId, reviewedBaseSha: resolvedBase, acceptanceTestCommitSha: contract.acceptanceTestCommitSha, contractFiles: Object.freeze(verifiedFiles), scenarioIds: contract.scenarioIds, maxChangedFiles: contract.maxChangedFiles, planningCodexSeconds: contract.planningCodexSeconds, authoritySetId, acceptanceSetId, dispatchAttestation: Object.freeze(dispatchAttestation), verified: true })
}
