import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { patternsOverlap } from './conflict-detector.js'
import { validateTaskPacket } from './task-schema.js'
import { verifyTaskContract } from './contract-verifier.js'

const AUTHORITY_CATEGORIES = Object.freeze(['productBehavior', 'securityAndCapabilities', 'persistenceSchema', 'semanticPort', 'wireApi', 'designAndCopy', 'acceptanceTests'])
const PLAN_KEYS = new Set(['reviewedBaseSha', 'acceptanceTestCommitSha', 'scenarioIds', 'maxChangedFiles', 'planningCodexSeconds', 'stopConditions', 'authoritySet', 'acceptanceSet'])
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const git = (root, args, options = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function canonicalRepository(repositoryRoot) {
  const supplied = fs.realpathSync(path.resolve(repositoryRoot))
  const discovered = fs.realpathSync(git(supplied, ['rev-parse', '--show-toplevel']).trim())
  if (supplied !== discovered) throw Object.assign(new Error('repositoryRoot must be the canonical Git repository root'), { code: 'COLLABORATION_PREPARE_REPOSITORY_INVALID' })
  return discovered
}

function dirtySourceFiles(repository) {
  const output = git(repository, ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    const raw = line.slice(3).trim(), file = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw
    if (!file || path.isAbsolute(file) || file.split('/').some(part => part === '..')) throw Object.assign(new Error('Git reported an unsafe dirty path'), { code: 'COLLABORATION_PREPARE_DIRTY_SOURCE' })
    return file.replace(/^"|"$/g, '')
  }).filter(file => !['data/**', 'logs/**', 'state/**', 'dist/**'].some(pattern => patternsOverlap(file, pattern)))
}

function exactCommit(repository, value, label) {
  if (!/^[a-f0-9]{40,64}$/.test(String(value || ''))) throw Object.assign(new Error(`${label} must be an exact commit SHA`), { code: 'COLLABORATION_PREPARE_COMMIT_INVALID' })
  try { return git(repository, ['rev-parse', '--verify', `${value}^{commit}`]).trim() }
  catch { throw Object.assign(new Error(`${label} is unavailable`), { code: 'COLLABORATION_PREPARE_COMMIT_MISSING' }) }
}

function blobEvidence(repository, baseSha, filePath) {
  let content
  try { content = git(repository, ['show', `${baseSha}:${filePath}`], { encoding: null, maxBuffer: 16 * 1024 * 1024 }) }
  catch { throw Object.assign(new Error(`authority file is unavailable at the reviewed base: ${filePath}`), { code: 'COLLABORATION_PREPARE_AUTHORITY_MISSING' }) }
  return { path: filePath, sha256: digest(content) }
}

export function prepareTaskPacket({ repositoryRoot, draft } = {}) {
  if (!plainObject(draft) || !plainObject(draft.contractPlan)) throw Object.assign(new Error('draft.contractPlan is required'), { code: 'COLLABORATION_PREPARE_PLAN_REQUIRED' })
  for (const key of Object.keys(draft.contractPlan)) if (!PLAN_KEYS.has(key)) throw new Error(`contractPlan contains unsupported field: ${key}`)
  const repository = canonicalRepository(repositoryRoot), plan = draft.contractPlan
  const reviewedBaseSha = exactCommit(repository, plan.reviewedBaseSha, 'contractPlan.reviewedBaseSha')
  const head = git(repository, ['rev-parse', 'HEAD']).trim()
  if (head !== reviewedBaseSha) throw Object.assign(new Error('reviewed base is not the current repository HEAD'), { code: 'COLLABORATION_PREPARE_BASE_STALE' })
  const dirty = dirtySourceFiles(repository)
  if (dirty.length) throw Object.assign(new Error('source changes must be reviewed and committed before packet preparation'), { code: 'COLLABORATION_PREPARE_DIRTY_SOURCE', files: dirty })
  const acceptanceTestCommitSha = exactCommit(repository, plan.acceptanceTestCommitSha, 'contractPlan.acceptanceTestCommitSha')
  if (spawnSync('git', ['-C', repository, 'merge-base', '--is-ancestor', acceptanceTestCommitSha, reviewedBaseSha], { stdio: 'ignore' }).status !== 0) throw Object.assign(new Error('acceptance-test commit is not an ancestor of the reviewed base'), { code: 'COLLABORATION_PREPARE_ACCEPTANCE_NOT_FROZEN' })
  if (!plainObject(plan.authoritySet)) throw new Error('contractPlan.authoritySet must define every authority category')
  const authoritySet = {}, frozenPaths = new Set()
  for (const category of AUTHORITY_CATEGORIES) {
    const entry = plan.authoritySet[category]
    if (!plainObject(entry) || !['bound', 'not-applicable-and-forbidden'].includes(entry.disposition) || !Array.isArray(entry.paths)) throw new Error(`contractPlan.authoritySet.${category} is invalid`)
    const paths = [...new Set(entry.paths)].sort()
    if (entry.disposition === 'bound' && !paths.length || entry.disposition === 'not-applicable-and-forbidden' && paths.length) throw new Error(`contractPlan.authoritySet.${category} contradicts its disposition`)
    for (const filePath of paths) frozenPaths.add(filePath)
    authoritySet[category] = { disposition: entry.disposition, paths }
  }
  for (const key of Object.keys(plan.authoritySet)) if (!AUTHORITY_CATEGORIES.includes(key)) throw new Error(`contractPlan.authoritySet contains unsupported category: ${key}`)
  if (!plainObject(plan.acceptanceSet) || !Array.isArray(plan.acceptanceSet.tests) || !plainObject(plan.acceptanceSet.environment)) throw new Error('contractPlan.acceptanceSet is invalid')
  const testPlans = plan.acceptanceSet.tests.map(item => {
    if (!plainObject(item) || typeof item.id !== 'string' || typeof item.path !== 'string') throw new Error('contractPlan acceptance test identity is invalid')
    frozenPaths.add(item.path)
    return { id: item.id, path: item.path }
  })
  const contractFiles = [...frozenPaths].sort().map(filePath => blobEvidence(repository, reviewedBaseSha, filePath))
  const hashByPath = new Map(contractFiles.map(item => [item.path, item.sha256]))
  const acceptanceSet = { tests: testPlans.map(item => ({ ...item, sha256: hashByPath.get(item.path) })), environment: { ...plan.acceptanceSet.environment } }
  const { contractPlan: _contractPlan, schemaVersion: _schemaVersion, contractPack: _contractPack, ...taskFields } = draft
  const packet = validateTaskPacket({
    ...taskFields, schemaVersion: 3,
    readOnlyContextFiles: [...new Set([...(Array.isArray(taskFields.readOnlyContextFiles) ? taskFields.readOnlyContextFiles : []), ...frozenPaths])].sort(),
    contractPack: {
      reviewedBaseSha, acceptanceTestCommitSha, contractFiles, scenarioIds: plan.scenarioIds,
      maxChangedFiles: plan.maxChangedFiles, planningCodexSeconds: plan.planningCodexSeconds,
      stopConditions: plan.stopConditions, authoritySet, acceptanceSet,
    },
  })
  const verification = verifyTaskContract({ repositoryRoot: repository, taskPacket: packet, requestedBaseSha: reviewedBaseSha })
  return Object.freeze({ schemaVersion: 1, task: packet, preparationReceipt: Object.freeze({ ...verification, preparedWithoutDispatch: true }) })
}
