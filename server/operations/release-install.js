import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createBackup, restoreBackup } from './backup.js'

function fail(code, message) { throw Object.assign(new Error(message), { code }) }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function safeId(value) { return String(value || '').replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  fs.renameSync(temporary, file)
}
function receiptHash(value) { const { receiptSha256: _receipt, ...payload } = value; return sha256(JSON.stringify(payload)) }

function validateArchive(archive) {
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  if (listing.status !== 0) fail('RELEASE_ARCHIVE_INVALID', listing.stderr || 'release archive cannot be listed')
  const paths = listing.stdout.split('\n').filter(Boolean)
  if (!paths.length || paths.some(item => item !== 'package' && !item.startsWith('package/') || item.split('/').includes('..'))) fail('RELEASE_ARCHIVE_INVALID', 'release archive contains an unsafe path')
}

function rejectLinks(root, current = root) {
  for (const name of fs.readdirSync(current)) {
    const entry = path.join(current, name), stat = fs.lstatSync(entry)
    if (stat.isSymbolicLink()) fail('RELEASE_ARCHIVE_INVALID', `release archive contains a symbolic link: ${path.relative(root, entry)}`)
    if (stat.isDirectory()) rejectLinks(root, entry)
  }
}

function switchCurrent(installRoot, target) {
  const current = path.join(installRoot, 'current')
  const temporary = `${current}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  fs.symlinkSync(target, temporary)
  fs.renameSync(temporary, current)
}

export function installRelease({ archive, installRoot, installDependencies = true, createdAt = Date.now() }) {
  archive = path.resolve(archive)
  installRoot = path.resolve(installRoot)
  if (!fs.statSync(archive).isFile()) fail('RELEASE_ARCHIVE_INVALID', 'release archive is not a file')
  validateArchive(archive)
  const archiveSha256 = sha256(fs.readFileSync(archive))
  const releasesDir = path.join(installRoot, 'releases'), dataDir = path.join(installRoot, 'data')
  const backupsDir = path.join(installRoot, 'backups'), receiptsDir = path.join(installRoot, 'receipts')
  fs.mkdirSync(releasesDir, { recursive: true, mode: 0o700 })
  const staging = path.join(releasesDir, `.staging-${process.pid}-${crypto.randomBytes(5).toString('hex')}`)
  fs.mkdirSync(staging, { mode: 0o700 })
  let releaseDir
  try {
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', staging], { encoding: 'utf8' })
    if (extracted.status !== 0) fail('RELEASE_ARCHIVE_INVALID', extracted.stderr || 'release archive cannot be extracted')
    const packageRoot = path.join(staging, 'package')
    rejectLinks(packageRoot)
    const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
    if (metadata.name !== 'ai-command-center' || !metadata.version || !fs.existsSync(path.join(packageRoot, 'server', 'index.js')) || !fs.existsSync(path.join(packageRoot, 'dist', 'index.html'))) fail('RELEASE_ARCHIVE_INVALID', 'archive is not a complete AI Command Center release')
    const releaseId = `${safeId(metadata.version)}-${archiveSha256.slice(0, 12)}`
    releaseDir = path.join(releasesDir, releaseId)
    if (fs.existsSync(releaseDir)) fail('RELEASE_ALREADY_INSTALLED', `release ${releaseId} is already installed`)
    if (installDependencies) {
      const install = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: packageRoot, encoding: 'utf8', timeout: 180_000 })
      if (install.status !== 0) fail('RELEASE_DEPENDENCY_INSTALL_FAILED', install.stderr || install.stdout || 'dependency installation failed')
    }
    fs.renameSync(packageRoot, releaseDir)
    fs.rmSync(staging, { recursive: true, force: true })
    const current = path.join(installRoot, 'current')
    const previousRelease = fs.existsSync(current) ? fs.readlinkSync(current) : null
    let backupDir = null, backupReceiptSha256 = null
    if (fs.existsSync(dataDir)) {
      backupDir = path.join(backupsDir, `pre-${releaseId}-${createdAt}`)
      const backup = createBackup({ dataDir, backupDir, sourceRevision: previousRelease, createdAt })
      backupReceiptSha256 = backup.receiptSha256
    } else fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    const relativeTarget = path.relative(installRoot, releaseDir)
    switchCurrent(installRoot, relativeTarget)
    const receipt = { schemaVersion: 1, kind: 'ai-command-center/release-install', status: 'installed', createdAt, releaseId, archiveSha256, currentRelease: relativeTarget, previousRelease, backupDir, backupReceiptSha256 }
    receipt.receiptSha256 = receiptHash(receipt)
    atomicJson(path.join(receiptsDir, `${releaseId}-${createdAt}.json`), receipt)
    return receipt
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    if (releaseDir && fs.existsSync(releaseDir) && !fs.existsSync(path.join(installRoot, 'current'))) fs.rmSync(releaseDir, { recursive: true, force: true })
    throw error
  }
}

export function rollbackRelease({ installRoot, receipt, restoreData = true }) {
  installRoot = path.resolve(installRoot)
  if (receipt?.kind !== 'ai-command-center/release-install' || receipt.receiptSha256 !== receiptHash(receipt)) fail('RELEASE_RECEIPT_INVALID', 'release receipt is invalid')
  if (!receipt.previousRelease) fail('RELEASE_ROLLBACK_UNAVAILABLE', 'the initial release has no previous version')
  const previous = path.resolve(installRoot, receipt.previousRelease)
  if (!previous.startsWith(`${path.resolve(installRoot, 'releases')}${path.sep}`) || !fs.existsSync(previous)) fail('RELEASE_ROLLBACK_UNAVAILABLE', 'previous release is unavailable')
  switchCurrent(installRoot, receipt.previousRelease)
  let dataReceipt = null
  if (restoreData && receipt.backupDir) dataReceipt = restoreBackup({ backupDir: receipt.backupDir, dataDir: path.join(installRoot, 'data') })
  const result = { schemaVersion: 1, kind: 'ai-command-center/release-rollback', status: 'rolled-back', fromRelease: receipt.currentRelease, currentRelease: receipt.previousRelease, dataReceipt }
  result.receiptSha256 = receiptHash(result)
  return result
}
