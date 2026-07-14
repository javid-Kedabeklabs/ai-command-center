import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { patternsOverlap } from './conflict-detector.js'
import { validateTaskPacket } from './task-schema.js'
import { atomicWriteJsonSync } from '../storage/atomic-json.js'

const safeTaskId = value => {
  const id = String(value || '').trim()
  if (!/^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/.test(id)) throw new Error('invalid collaboration task id')
  return id
}
const safeBranch = value => {
  const branch = String(value || '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,150}$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.includes('@{')) throw new Error('invalid collaboration branch name')
  return branch
}
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)

function git(repository, args, options = {}) {
  try {
    const { trim = true, ...execOptions } = options
    const output = execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...execOptions })
    return trim ? output.trim() : output
  } catch (cause) {
    const error = new Error(`git ${args[0]} failed: ${String(cause.stderr || cause.message).trim().slice(0, 500)}`)
    error.code = 'COLLABORATION_GIT_ERROR'; error.cause = cause
    throw error
  }
}

function canonicalRepository(repositoryRoot) {
  const supplied = fs.realpathSync(path.resolve(repositoryRoot))
  const discovered = fs.realpathSync(git(supplied, ['rev-parse', '--show-toplevel']))
  if (supplied !== discovered) throw new Error('repositoryRoot must be the canonical Git repository root')
  return discovered
}

function changedFiles(repository, baseSha, headSha) {
  const output = git(repository, ['diff', '--name-only', '-z', `${baseSha}..${headSha}`], { trim: false })
  return output ? output.split('\0').filter(Boolean) : []
}

function dirtyPrimaryFiles(repository) {
  return git(repository, ['status', '--porcelain', '--untracked-files=all'], { trim: false }).split(/\r?\n/).filter(Boolean).map(line => {
    const value = line.slice(3).trim(), file = value.includes(' -> ') ? value.split(' -> ').at(-1) : value
    if (!file || path.isAbsolute(file) || file.split('/').some(part => part === '..')) throw Object.assign(new Error('primary checkout reported an unsafe dirty path'), { code: 'COLLABORATION_DIRTY_PRIMARY' })
    return file.replace(/^"|"$/g, '')
  })
}

const LEASE_STATES = new Set(['ACTIVE', 'INACTIVE', 'BLOCKED', 'INTEGRATED', 'REJECTED'])

function leaseError(message) {
  return Object.assign(new Error(`collaboration worktree lease store is corrupt: ${message}`), { code: 'COLLABORATION_LEASE_STORE_CORRUPT' })
}

function parseWorktreeList(repository) {
  const output = git(repository, ['worktree', 'list', '--porcelain'], { trim: false })
  const result = new Map()
  let current = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: fs.realpathSync(line.slice(9)), headSha: null, branch: null }
      result.set(current.path, current)
    } else if (current && line.startsWith('HEAD ')) current.headSha = line.slice(5)
    else if (current && line.startsWith('branch refs/heads/')) current.branch = line.slice(18)
  }
  return result
}

function validateChangedPath(worktreeRoot, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split('/').some(part => part === '..' || part === '.')) throw new Error('Git returned an unsafe changed path')
  const candidate = path.resolve(worktreeRoot, relativePath)
  if (!inside(worktreeRoot, candidate)) throw new Error('changed path escapes its worktree')
  if (fs.existsSync(candidate)) {
    if (fs.lstatSync(candidate).isSymbolicLink()) throw Object.assign(new Error(`changed path is an untrusted symlink: ${relativePath}`), { code: 'COLLABORATION_SYMLINK_EDIT' })
    if (!inside(worktreeRoot, fs.realpathSync(candidate))) throw Object.assign(new Error(`changed path resolves outside worktree: ${relativePath}`), { code: 'COLLABORATION_PATH_ESCAPE' })
  }
  return relativePath
}

export function createWorktreeManager({ repositoryRoot, worktreeRoot = path.join(repositoryRoot, '.claude', 'worktrees'), leaseFile = path.join(repositoryRoot, 'state', 'collaboration', 'worktree-leases.json'), now = () => Date.now() }) {
  const repositoryInput = path.resolve(repositoryRoot)
  const configuredInput = path.resolve(worktreeRoot)
  const requiredInput = path.join(repositoryInput, '.claude', 'worktrees')
  if (!inside(requiredInput, configuredInput)) throw new Error('worktree root must be contained under .claude/worktrees')
  const repository = canonicalRepository(repositoryRoot)
  const configured = path.resolve(repository, path.relative(repositoryInput, configuredInput))
  const requiredRoot = path.join(repository, '.claude', 'worktrees')
  if (!inside(requiredRoot, configured)) throw new Error('worktree root must be contained under .claude/worktrees')
  fs.mkdirSync(configured, { recursive: true, mode: 0o700 })
  const canonicalWorktrees = fs.realpathSync(configured)
  if (!inside(repository, canonicalWorktrees)) throw new Error('worktree root resolves outside repository')
  const leasesPath = path.resolve(repository, path.relative(repositoryInput, path.resolve(leaseFile)))
  if (!inside(repository, leasesPath) || fs.existsSync(leasesPath) && fs.lstatSync(leasesPath).isSymbolicLink()) throw Object.assign(new Error('worktree lease file must be a regular path inside the repository'), { code: 'COLLABORATION_PATH_OUTSIDE_REPOSITORY' })
  const records = new Map()

  function persistedRecord(record) {
    return {
      schemaVersion: 1, taskId: record.taskId, branch: record.branch,
      relativePath: path.relative(repository, record.path).split(path.sep).join('/'),
      baseSha: record.baseSha, primaryHeadAtCreation: record.primaryHeadAtCreation,
      createdAt: record.createdAt, updatedAt: record.updatedAt, endedAt: record.endedAt || null,
      state: record.state, reason: record.reason || null,
    }
  }

  function persist() {
    atomicWriteJsonSync(leasesPath, {
      schemaVersion: 1, revision: Math.max(1, ...[...records.values()].map(item => Number(item.revision) || 1)),
      updatedAt: now(), leases: Object.fromEntries([...records.entries()].map(([id, record]) => [id, persistedRecord(record)])),
    })
  }

  function hydrate(raw) {
    if (!raw || raw.schemaVersion !== 1 || !raw.leases || typeof raw.leases !== 'object' || Array.isArray(raw.leases)) throw leaseError('invalid root document')
    for (const [id, item] of Object.entries(raw.leases)) {
      try {
        if (safeTaskId(id) !== item.taskId || safeBranch(item.branch) !== item.branch || !LEASE_STATES.has(item.state)) throw new Error('invalid lease identity or state')
        if (typeof item.relativePath !== 'string' || path.isAbsolute(item.relativePath) || item.relativePath.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('invalid relative path')
        const candidate = path.resolve(repository, item.relativePath)
        if (!inside(canonicalWorktrees, candidate)) throw new Error('lease path escapes collaboration root')
        for (const sha of [item.baseSha, item.primaryHeadAtCreation]) if (!/^[a-f0-9]{40,64}$/.test(String(sha || ''))) throw new Error('invalid commit identity')
        records.set(id, Object.freeze({ ...item, path: candidate, active: item.state === 'ACTIVE', revision: Number(raw.revision) || 1 }))
      } catch (error) { throw leaseError(`${id}: ${error.message}`) }
    }
  }

  function reconcile() {
    if (!fs.existsSync(leasesPath)) return { recovered: [], blocked: [], missing: [] }
    let raw
    try { raw = JSON.parse(fs.readFileSync(leasesPath, 'utf8')); hydrate(raw) }
    catch (error) { throw error.code === 'COLLABORATION_LEASE_STORE_CORRUPT' ? error : leaseError(error.message) }
    const registered = parseWorktreeList(repository), recovered = [], blocked = [], missing = []
    for (const [id, record] of records) {
      if (!['ACTIVE', 'INACTIVE'].includes(record.state)) continue
      const actual = fs.existsSync(record.path) ? registered.get(fs.realpathSync(record.path)) : null
      let reason = null
      if (!actual) { reason = 'WORKTREE_MISSING'; missing.push(id) }
      else if (actual.branch !== record.branch) reason = 'BRANCH_MISMATCH'
      else {
        const mergeBase = git(record.path, ['merge-base', record.baseSha, actual.headSha])
        if (mergeBase !== record.baseSha) reason = 'BASE_MISMATCH'
      }
      const nextState = reason || record.state === 'ACTIVE' ? 'BLOCKED' : 'INACTIVE'
      const nextReason = reason || (record.state === 'ACTIVE' ? 'ORPHANED_AFTER_RESTART' : record.reason)
      records.set(id, Object.freeze({ ...record, state: nextState, active: false, reason: nextReason, updatedAt: now(), endedAt: record.endedAt || now(), revision: record.revision + 1 }))
      if (nextState === 'BLOCKED') blocked.push(id); else recovered.push(id)
    }
    persist()
    return { recovered, blocked, missing }
  }

  const recovery = reconcile()

  function assertPrimaryClean({ allowDirtyPrimaryPatterns = [] } = {}) {
    const dirty = dirtyPrimaryFiles(repository)
    const unexpected = dirty.filter(file => !allowDirtyPrimaryPatterns.some(pattern => patternsOverlap(file, pattern)))
    if (unexpected.length) throw Object.assign(new Error('primary checkout has source changes outside the approved runtime-data boundary'), { code: 'COLLABORATION_DIRTY_PRIMARY', files: unexpected })
    return { clean: true, allowedDirtyFiles: dirty }
  }

  function create({ taskId, baseSha, branchName, refuseDirtyPrimary = true, requireHeadBase = true, allowDirtyPrimaryPatterns = [], excludeSensitivePaths = true }) {
    const id = safeTaskId(taskId), branch = safeBranch(branchName || `claude/${id}`)
    if (records.has(id)) throw Object.assign(new Error('task already has a registered worktree'), { code: 'COLLABORATION_WORKTREE_EXISTS' })
    const destination = path.join(canonicalWorktrees, id)
    if (!inside(canonicalWorktrees, destination) || fs.existsSync(destination)) throw Object.assign(new Error('worktree destination already exists or is unsafe'), { code: 'COLLABORATION_WORKTREE_EXISTS' })
    const resolvedBase = git(repository, ['rev-parse', '--verify', `${baseSha}^{commit}`])
    const primaryHead = git(repository, ['rev-parse', 'HEAD'])
    if (requireHeadBase && resolvedBase !== primaryHead) throw Object.assign(new Error('explicit base SHA does not represent current primary HEAD'), { code: 'COLLABORATION_UNEXPECTED_BASE' })
    if (refuseDirtyPrimary) assertPrimaryClean({ allowDirtyPrimaryPatterns })
    git(repository, ['worktree', 'add', '-b', branch, destination, resolvedBase])
    if (excludeSensitivePaths) git(destination, ['sparse-checkout', 'set', '--no-cone', '/*', '!/data/', '!/logs/', '!/state/'])
    const timestamp = now()
    const record = Object.freeze({ schemaVersion: 1, taskId: id, branch, path: fs.realpathSync(destination), baseSha: resolvedBase, primaryHeadAtCreation: primaryHead, createdAt: timestamp, updatedAt: timestamp, state: 'ACTIVE', reason: null, active: true, revision: 1 })
    records.set(id, record)
    persist()
    return { ...record }
  }

  function get(taskId) { const value = records.get(safeTaskId(taskId)); return value ? { ...value } : null }
  function list() { return [...records.values()].map(item => ({ ...item })) }

  function inspect(taskId, { taskPacket, requireCommit = true } = {}) {
    const id = safeTaskId(taskId), record = records.get(id)
    if (!record) throw Object.assign(new Error('worktree is not registered'), { code: 'COLLABORATION_UNKNOWN_WORKTREE' })
    const packet = validateTaskPacket(taskPacket)
    if (packet.taskId !== id) throw new Error('task packet does not match registered worktree')
    const headSha = git(record.path, ['rev-parse', 'HEAD'])
    const mergeBase = git(record.path, ['merge-base', record.baseSha, headSha])
    if (mergeBase !== record.baseSha) throw Object.assign(new Error('worker history is not based on the approved base'), { code: 'COLLABORATION_UNEXPECTED_BASE' })
    const commitCount = Number(git(record.path, ['rev-list', '--count', `${record.baseSha}..${headSha}`]))
    if (requireCommit && commitCount !== 1) throw Object.assign(new Error(commitCount === 0 ? 'worker did not create the required commit' : 'worker must return exactly one isolated commit'), { code: 'COLLABORATION_MISSING_OR_MULTIPLE_COMMITS' })
    const dirty = git(record.path, ['status', '--porcelain', '--untracked-files=all'])
    if (dirty) throw Object.assign(new Error('worker worktree contains uncommitted or unexplained changes'), { code: 'COLLABORATION_DIRTY_WORKTREE' })
    const files = changedFiles(record.path, record.baseSha, headSha).map(file => validateChangedPath(record.path, file))
    const violations = []
    for (const file of files) {
      if (!packet.filesAllowed.some(pattern => patternsOverlap(file, pattern))) violations.push({ file, reason: 'OUTSIDE_ALLOWED_SCOPE' })
      if (packet.filesForbidden.some(pattern => patternsOverlap(file, pattern))) violations.push({ file, reason: 'FORBIDDEN_SCOPE' })
    }
    if (violations.length) {
      const error = new Error('worker commit contains out-of-scope changes')
      error.code = 'COLLABORATION_SCOPE_VIOLATION'; error.violations = violations
      throw error
    }
    return { taskId: id, branch: record.branch, path: record.path, baseSha: record.baseSha, headSha, commitCount, filesChanged: files, clean: true }
  }

  function markInactive(taskId) {
    const id = safeTaskId(taskId), record = records.get(id)
    if (!record) throw new Error('worktree is not registered')
    records.set(id, Object.freeze({ ...record, active: false, state: 'INACTIVE', reason: null, endedAt: now(), updatedAt: now(), revision: record.revision + 1 }))
    persist()
    return get(id)
  }

  function cleanup(taskId, { integrated = false, rejected = false, deleteBranch = false, forceDeleteRejectedBranch = false } = {}) {
    const id = safeTaskId(taskId), record = records.get(id)
    if (!record) throw Object.assign(new Error('refusing to clean an unknown worktree'), { code: 'COLLABORATION_UNKNOWN_WORKTREE' })
    if (record.active) throw Object.assign(new Error('refusing to clean an active worktree'), { code: 'COLLABORATION_ACTIVE_WORKTREE' })
    if (git(record.path, ['status', '--porcelain', '--untracked-files=all'])) throw Object.assign(new Error('refusing to clean a dirty worktree'), { code: 'COLLABORATION_DIRTY_WORKTREE' })
    const head = git(record.path, ['rev-parse', 'HEAD'])
    if (head !== record.baseSha && !integrated && !rejected) throw Object.assign(new Error('refusing to clean unintegrated worker commits'), { code: 'COLLABORATION_UNINTEGRATED_WORKTREE' })
    if (deleteBranch && rejected && !forceDeleteRejectedBranch) throw Object.assign(new Error('rejected branch deletion requires separate explicit force approval'), { code: 'COLLABORATION_REJECTED_BRANCH_PRESERVED' })
    git(repository, ['worktree', 'remove', record.path])
    if (deleteBranch && integrated) git(repository, ['branch', '-d', record.branch])
    else if (deleteBranch && rejected && forceDeleteRejectedBranch) git(repository, ['branch', '-D', record.branch])
    records.set(id, Object.freeze({ ...record, active: false, state: integrated ? 'INTEGRATED' : rejected ? 'REJECTED' : 'INACTIVE', reason: null, endedAt: now(), updatedAt: now(), revision: record.revision + 1 }))
    persist()
    return { taskId: id, removed: true, branchPreserved: !deleteBranch, disposition: integrated ? 'INTEGRATED' : rejected ? 'REJECTED' : 'EMPTY' }
  }

  return { create, get, list, inspect, markInactive, cleanup, assertPrimaryClean, recovery, repositoryRoot: repository, worktreeRoot: canonicalWorktrees, leaseFile: leasesPath }
}

export { git as runGit }
