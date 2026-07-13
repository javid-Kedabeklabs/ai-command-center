import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createIntegrationManager } from '../server/collaboration/integration-manager.js'
import { createWorktreeManager } from '../server/collaboration/worktree-manager.js'

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS  ${name}`) }
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const write = (root, name, content) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file }

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-worktree-'))
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'fixture@example.invalid'])
  git(root, ['config', 'user.name', 'Fixture Worker'])
  write(root, '.gitignore', '.claude/worktrees/\n')
  write(root, 'src/allowed.txt', 'base\n')
  write(root, 'src/conflict.txt', 'base\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'fixture base'])
  return { root, baseSha: git(root, ['rev-parse', 'HEAD']) }
}

const packet = (taskId, overrides = {}) => ({
  schemaVersion: 1, taskId, title: 'Fixture worktree task', status: 'QUEUED', phase: 'PHASE D', priority: 50,
  createdBy: 'codex', assignedWorker: 'claude-fable', taskType: 'IMPLEMENTATION',
  objective: 'Modify one allowed fixture file in an isolated worktree.', background: 'This is a deterministic fixture with no vendor calls.',
  acceptanceCriteria: ['One isolated commit changes only allowed files.'], filesAllowed: ['src/allowed.txt'], filesForbidden: ['data/**'],
  readOnlyContextFiles: [], dependencies: [], requiredTests: ['fixture'], permissionProfile: 'WORKTREE_IMPLEMENTATION',
  modelPolicy: { primary: 'fable', fallback: 'sonnet', effort: 'max' }, maxTurns: 10, timeoutSeconds: 300,
  allowSubagents: false, allowNetwork: false, requiresCommit: true,
  expectedOutput: { summary: true, filesChanged: true, tests: true, commitSha: true, risks: true }, ...overrides,
})

const commit = (worktree, file, content, message = 'worker change') => {
  write(worktree, file, content)
  git(worktree, ['add', '--', file])
  git(worktree, ['commit', '-qm', message])
  return git(worktree, ['rev-parse', 'HEAD'])
}

console.log('== collaboration worktree isolation ==')

await test('creates a unique worktree and records the explicit reviewed base', () => {
  const { root, baseSha } = repository(), manager = createWorktreeManager({ repositoryRoot: root })
  const record = manager.create({ taskId: 'worktree-create', baseSha })
  assert.equal(record.baseSha, baseSha)
  assert(record.path.startsWith(`${fs.realpathSync(root)}${path.sep}.claude${path.sep}worktrees${path.sep}`))
  assert.equal(git(record.path, ['rev-parse', 'HEAD']), baseSha)
  assert.throws(() => manager.create({ taskId: 'worktree-create', baseSha }), error => error.code === 'COLLABORATION_WORKTREE_EXISTS')
  manager.markInactive('worktree-create'); manager.cleanup('worktree-create')
  fs.rmSync(root, { recursive: true, force: true })
})

await test('rejects dirty primary state and an unexpected explicit base', () => {
  const { root, baseSha } = repository(), manager = createWorktreeManager({ repositoryRoot: root })
  write(root, 'dirty.txt', 'unreviewed')
  assert.throws(() => manager.create({ taskId: 'dirty-primary', baseSha }), error => error.code === 'COLLABORATION_DIRTY_PRIMARY')
  fs.rmSync(path.join(root, 'dirty.txt'))
  write(root, 'next.txt', 'next'); git(root, ['add', '.']); git(root, ['commit', '-qm', 'new head'])
  assert.throws(() => manager.create({ taskId: 'stale-base', baseSha }), error => error.code === 'COLLABORATION_UNEXPECTED_BASE')
  fs.rmSync(root, { recursive: true, force: true })
})

await test('verifies one clean commit and rejects missing, dirty, and out-of-scope work', () => {
  const { root, baseSha } = repository(), manager = createWorktreeManager({ repositoryRoot: root })
  const missing = manager.create({ taskId: 'missing-commit', baseSha })
  assert.throws(() => manager.inspect('missing-commit', { taskPacket: packet('missing-commit') }), error => error.code === 'COLLABORATION_MISSING_OR_MULTIPLE_COMMITS')
  manager.markInactive('missing-commit'); manager.cleanup('missing-commit')

  const good = manager.create({ taskId: 'good-scope', baseSha })
  const sha = commit(good.path, 'src/allowed.txt', 'worker\n')
  const verified = manager.inspect('good-scope', { taskPacket: packet('good-scope') })
  assert.equal(verified.headSha, sha); assert.deepEqual(verified.filesChanged, ['src/allowed.txt'])
  write(good.path, 'scratch.txt', 'dirty')
  assert.throws(() => manager.inspect('good-scope', { taskPacket: packet('good-scope') }), error => error.code === 'COLLABORATION_DIRTY_WORKTREE')
  fs.rmSync(path.join(good.path, 'scratch.txt'))
  manager.markInactive('good-scope'); manager.cleanup('good-scope', { rejected: true })

  const bad = manager.create({ taskId: 'bad-scope', baseSha })
  commit(bad.path, 'outside.txt', 'bad\n')
  assert.throws(() => manager.inspect('bad-scope', { taskPacket: packet('bad-scope') }), error => error.code === 'COLLABORATION_SCOPE_VIOLATION' && error.violations[0].file === 'outside.txt')
  manager.markInactive('bad-scope'); manager.cleanup('bad-scope', { rejected: true })
  fs.rmSync(root, { recursive: true, force: true })
})

await test('rejects changed symlinks even when their path is otherwise allowed', () => {
  const { root, baseSha } = repository(), manager = createWorktreeManager({ repositoryRoot: root })
  const record = manager.create({ taskId: 'symlink-edit', baseSha })
  fs.symlinkSync('/tmp', path.join(record.path, 'src', 'link'))
  git(record.path, ['add', 'src/link']); git(record.path, ['commit', '-qm', 'symlink'])
  assert.throws(() => manager.inspect('symlink-edit', { taskPacket: packet('symlink-edit', { filesAllowed: ['src/**'] }) }), error => error.code === 'COLLABORATION_SYMLINK_EDIT')
  manager.markInactive('symlink-edit'); manager.cleanup('symlink-edit', { rejected: true })
  fs.rmSync(root, { recursive: true, force: true })
})

console.log('\n== gated integration ==')

await test('prepares without mutating and cherry-picks only after explicit approval', () => {
  const { root, baseSha } = repository(), worktrees = createWorktreeManager({ repositoryRoot: root })
  const worker = worktrees.create({ taskId: 'approved-pilot', baseSha })
  commit(worker.path, 'src/allowed.txt', 'integrated\n')
  const integrations = createIntegrationManager({ repositoryRoot: root, worktreeManager: worktrees })
  const before = git(root, ['rev-parse', 'HEAD']), plan = integrations.prepare({ taskId: 'approved-pilot', taskPacket: packet('approved-pilot') })
  assert.equal(git(root, ['rev-parse', 'HEAD']), before)
  assert.throws(() => integrations.integrate(plan.planId), error => error.code === 'COLLABORATION_INTEGRATION_NOT_APPROVED')
  const result = integrations.integrate(plan.planId, { approved: true })
  assert.equal(result.status, 'INTEGRATED'); assert.equal(fs.readFileSync(path.join(root, 'src/allowed.txt'), 'utf8'), 'integrated\n')
  worktrees.cleanup('approved-pilot', { integrated: true })
  fs.rmSync(root, { recursive: true, force: true })
})

await test('detects a cherry-pick conflict, aborts safely, and preserves the clean target commit', () => {
  const { root, baseSha } = repository(), worktrees = createWorktreeManager({ repositoryRoot: root })
  const worker = worktrees.create({ taskId: 'conflict-pilot', baseSha })
  commit(worker.path, 'src/conflict.txt', 'worker version\n')
  write(root, 'src/conflict.txt', 'target version\n'); git(root, ['add', 'src/conflict.txt']); git(root, ['commit', '-qm', 'target conflict'])
  const targetBefore = git(root, ['rev-parse', 'HEAD'])
  const integrations = createIntegrationManager({ repositoryRoot: root, worktreeManager: worktrees })
  const plan = integrations.prepare({ taskId: 'conflict-pilot', taskPacket: packet('conflict-pilot', { filesAllowed: ['src/conflict.txt'] }) })
  assert.throws(() => integrations.integrate(plan.planId, { approved: true }), error => error.code === 'COLLABORATION_INTEGRATION_CONFLICT')
  assert.equal(git(root, ['rev-parse', 'HEAD']), targetBefore)
  assert.equal(git(root, ['status', '--porcelain', '--untracked-files=all']), '')
  worktrees.markInactive('conflict-pilot'); worktrees.cleanup('conflict-pilot', { rejected: true })
  fs.rmSync(root, { recursive: true, force: true })
})

await test('cleanup refuses unknown, active, dirty, and unintegrated worktrees', () => {
  const { root, baseSha } = repository(), manager = createWorktreeManager({ repositoryRoot: root })
  assert.throws(() => manager.cleanup('unknown-task'), error => error.code === 'COLLABORATION_UNKNOWN_WORKTREE')
  const active = manager.create({ taskId: 'cleanup-guard', baseSha })
  assert.throws(() => manager.cleanup('cleanup-guard'), error => error.code === 'COLLABORATION_ACTIVE_WORKTREE')
  manager.markInactive('cleanup-guard'); write(active.path, 'dirty.txt', 'dirty')
  assert.throws(() => manager.cleanup('cleanup-guard'), error => error.code === 'COLLABORATION_DIRTY_WORKTREE')
  fs.rmSync(path.join(active.path, 'dirty.txt')); commit(active.path, 'src/allowed.txt', 'unintegrated\n')
  assert.throws(() => manager.cleanup('cleanup-guard'), error => error.code === 'COLLABORATION_UNINTEGRATED_WORKTREE')
  const cleanup = manager.cleanup('cleanup-guard', { rejected: true })
  assert.equal(cleanup.branchPreserved, true)
  assert.equal(git(root, ['rev-parse', '--verify', 'claude/cleanup-guard']), git(root, ['rev-parse', 'claude/cleanup-guard']))
  fs.rmSync(root, { recursive: true, force: true })
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
