import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createBackup, restoreBackup, verifyBackup } from '../server/operations/backup.js'

function usage() {
  console.error('usage: node scripts/backup.mjs create <data-dir> <backup-dir> | verify <backup-dir> | restore <backup-dir> <data-dir> --confirm-receipt <sha256>')
  process.exit(2)
}

function revision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

const [command, first, second, confirmationFlag, confirmation] = process.argv.slice(2)
if (command === 'create' && first && second) {
  const manifest = createBackup({ dataDir: path.resolve(first), backupDir: path.resolve(second), sourceRevision: revision() })
  console.log(JSON.stringify({ status: 'created', backupDir: path.resolve(second), ...manifest }, null, 2))
} else if (command === 'verify' && first && !second) {
  const manifest = verifyBackup({ backupDir: path.resolve(first) })
  console.log(JSON.stringify({ status: 'verified', backupDir: path.resolve(first), receiptSha256: manifest.receiptSha256, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes }, null, 2))
} else if (command === 'restore' && first && second) {
  const backupDir = path.resolve(first)
  const manifest = verifyBackup({ backupDir })
  if (confirmationFlag !== '--confirm-receipt' || confirmation !== manifest.receiptSha256) {
    console.error(`restore is destructive and requires: --confirm-receipt ${manifest.receiptSha256}`)
    process.exit(2)
  }
  const dataDir = path.resolve(second)
  if (fs.realpathSync(path.dirname(dataDir)) === fs.realpathSync(backupDir) || backupDir.startsWith(`${dataDir}${path.sep}`)) {
    throw Object.assign(new Error('backup directory must not be inside the restore destination'), { code: 'BACKUP_DESTINATION_CONFLICT' })
  }
  console.log(JSON.stringify(restoreBackup({ backupDir, dataDir }), null, 2))
} else usage()
