import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostController } from '../../server/autonomy/host-controller.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-host-')), backup = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-backup-'))
  fs.mkdirSync(path.join(root, '.git')); fs.mkdirSync(path.join(root, 'data'))
  fs.writeFileSync(path.join(root, 'data', 'workflow-triggers.json'), '{}')
  return { root, backup }
}
const request = (operation, params = {}, resource = 'command-center-repository') => ({ requestId: `request-${operation.replace('.', '-')}`, taskId: 'task-one', operation, resource, params })

console.log('== Deterministic host controller ==')
await test('git status uses execFile argument arrays and never a shell', async () => {
  const { root, backup } = fixture(); const calls = []
  const controller = createHostController({ root, backupsRoot: backup, execFile: async (command, args, options) => { calls.push({ command, args, options }); return { stdout: '', stderr: '' } } })
  await controller.execute(request('git.status')); assert.equal(calls[0].command, 'git'); assert.deepEqual(calls[0].args.slice(-2), ['status', '--short']); assert.equal(calls[0].options.shell, undefined)
})
await test('service reload refuses while a workflow is active', async () => {
  const { root, backup } = fixture(); const controller = createHostController({ root, backupsRoot: backup, fetchImpl: async () => ({ ok: true, json: async () => [{ id: 'run-1', status: 'running' }] }), execFile: async () => ({ stdout: '', stderr: '' }) })
  await assert.rejects(() => controller.execute(request('service.reload', {}, 'command-center-service')), /refused/)
})
await test('service reload returns only after its health postcondition passes', async () => {
  const { root, backup } = fixture(); const calls = []
  const controller = createHostController({ root, backupsRoot: backup, fetchImpl: async url => { calls.push(url); return url.endsWith('/api/runs') ? { ok: true, json: async () => [] } : { ok: true, status: 200 } }, execFile: async () => ({ stdout: '', stderr: '' }) })
  const result = await controller.execute(request('service.reload', {}, 'command-center-service'))
  assert.equal(result.output.health.status, 200); assert.equal(calls.at(-1).endsWith('/api/system'), true)
})
await test('health checks reject arbitrary URLs and paths', async () => {
  const { root, backup } = fixture(); const controller = createHostController({ root, backupsRoot: backup, fetchImpl: async () => ({ ok: true, status: 200 }) })
  await assert.rejects(() => controller.execute(request('health.local', { path: 'http://evil.test' }, 'command-center-http')), /not allowlisted/)
})
await test('backup copies only allowlisted evidence and writes verified hashes', async () => {
  const { root, backup } = fixture()
  const execFile = async (_command, args) => ({ stdout: args.includes('rev-parse') ? 'abc123\n' : 'diff data\n', stderr: '' })
  const controller = createHostController({ root, backupsRoot: backup, execFile, clock: () => 1000 })
  const created = await controller.execute(request('backup.create', { label: 'safe-backup', includePaths: ['data/workflow-triggers.json'] }))
  assert.equal(created.output.files, 1)
  const verified = await controller.execute(request('backup.verify', { label: 'safe-backup' }))
  assert.equal(verified.output.verified, true)
})
await test('backup rejects non-allowlisted and traversal paths', async () => {
  const { root, backup } = fixture(); const controller = createHostController({ root, backupsRoot: backup, execFile: async () => ({ stdout: 'abc\n', stderr: '' }) })
  await assert.rejects(() => controller.execute(request('backup.create', { label: 'unsafe-backup', includePaths: ['../secret'] })), /not allowlisted|unsafe/)
  assert.equal(fs.existsSync(path.join(backup, 'unsafe-backup')), false)
})
await test('backup verification rejects paths injected into a tampered manifest', async () => {
  const { root, backup } = fixture()
  const execFile = async (_command, args) => ({ stdout: args.includes('rev-parse') ? 'abc123\n' : 'diff data\n', stderr: '' })
  const controller = createHostController({ root, backupsRoot: backup, execFile })
  await controller.execute(request('backup.create', { label: 'tampered-backup', includePaths: [] }))
  const manifestFile = path.join(backup, 'tampered-backup', 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  manifest.patch.path = '../outside'
  fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  await assert.rejects(() => controller.execute(request('backup.verify', { label: 'tampered-backup' })), /unsafe/)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
