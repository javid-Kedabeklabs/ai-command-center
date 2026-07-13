import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBackup, restoreBackup, verifyBackup } from '../server/operations/backup.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-backup-test-'))
const source = path.join(root, 'source')
const backup = path.join(root, 'backup')
const restored = path.join(root, 'restored')
fs.mkdirSync(path.join(source, 'workflows'), { recursive: true })
fs.mkdirSync(path.join(source, 'runs'), { recursive: true })
fs.mkdirSync(path.join(source, 'python-envs'), { recursive: true })
fs.writeFileSync(path.join(source, 'workflows', 'alpha.json'), '{"id":"alpha"}\n')
fs.writeFileSync(path.join(source, 'runs', 'run-1.json'), '{"id":"run-1","status":"done"}\n')
fs.writeFileSync(path.join(source, 'secret-references.json'), '{"schemaVersion":1,"references":{}}\n')
fs.writeFileSync(path.join(source, 'workflow-cache.json'), 'must-not-be-backed-up')
fs.writeFileSync(path.join(source, 'python-envs', 'binary'), 'must-not-be-backed-up')

try {
  const manifest = createBackup({ dataDir: source, backupDir: backup, sourceRevision: 'test-revision', createdAt: 123 })
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.secretValuesIncluded, false)
  assert.deepEqual(manifest.files.map(file => file.path), ['runs/run-1.json', 'secret-references.json', 'workflows/alpha.json'])
  assert.equal(verifyBackup({ backupDir: backup }).receiptSha256, manifest.receiptSha256)

  fs.mkdirSync(restored, { recursive: true })
  fs.writeFileSync(path.join(restored, 'old.json'), 'preserve in rollback')
  const receipt = restoreBackup({ backupDir: backup, dataDir: restored })
  assert.equal(receipt.status, 'restored')
  assert.equal(fs.readFileSync(path.join(restored, 'workflows', 'alpha.json'), 'utf8'), '{"id":"alpha"}\n')
  assert.equal(fs.existsSync(path.join(restored, 'workflow-cache.json')), false)
  assert.equal(fs.readFileSync(path.join(receipt.rollbackDir, 'old.json'), 'utf8'), 'preserve in rollback')

  fs.appendFileSync(path.join(backup, 'payload', 'workflows', 'alpha.json'), 'tampered')
  assert.throws(() => verifyBackup({ backupDir: backup }), error => error.code === 'BACKUP_PAYLOAD_MISMATCH')

  const symlinkSource = path.join(root, 'symlink-source')
  const symlinkBackup = path.join(root, 'symlink-backup')
  fs.mkdirSync(path.join(symlinkSource, 'workflows'), { recursive: true })
  fs.symlinkSync('/tmp', path.join(symlinkSource, 'workflows', 'escape'))
  assert.throws(() => createBackup({ dataDir: symlinkSource, backupDir: symlinkBackup }), error => error.code === 'BACKUP_SYMLINK_DENIED')

  console.log('backup/restore tests: 10/10 passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
