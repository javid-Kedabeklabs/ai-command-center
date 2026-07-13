import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const BACKUP_SCHEMA_VERSION = 1
export const BACKUP_KIND = 'ai-command-center/authoritative-backup'

// Secret values live in macOS Keychain and are intentionally never portable.
// These paths contain user-authored state, durable execution evidence, or the
// metadata required to resolve that state after restore.
export const AUTHORITATIVE_DATA_PATHS = Object.freeze([
  'agents.json',
  'audit.log',
  'component-import-proposals.json',
  'custom-nodes.json',
  'evaluations.json',
  'governance-candidates.json',
  'governance-lifecycle.json',
  'import-proposals.json',
  'knowledge',
  'learning-proposals.json',
  'plugins.json',
  'profiles.json',
  'providers.json',
  'runs',
  'secret-references.json',
  'workflow-trigger-history.json',
  'workflow-triggers.json',
  'workflow-versions',
  'workflows',
])

export const REBUILDABLE_DATA_PATHS = Object.freeze(['python-envs', 'server.log', 'workflow-cache.json'])

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizedRelative(value) {
  const relative = String(value || '').replaceAll('\\', '/')
  if (!relative || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('BACKUP_UNSAFE_PATH', `unsafe backup path: ${value}`)
  }
  return relative
}

function resolveBeneath(root, relative) {
  const safe = normalizedRelative(relative)
  const target = path.resolve(root, ...safe.split('/'))
  const base = path.resolve(root)
  if (!target.startsWith(`${base}${path.sep}`)) fail('BACKUP_UNSAFE_PATH', `backup path escapes root: ${relative}`)
  return target
}

function walkFiles(root, relative, output) {
  const absolute = resolveBeneath(root, relative)
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) fail('BACKUP_SYMLINK_DENIED', `symbolic links are not portable: ${relative}`)
  if (stat.isFile()) {
    output.push(relative)
    return
  }
  if (!stat.isDirectory()) fail('BACKUP_FILE_TYPE_DENIED', `unsupported file type: ${relative}`)
  for (const name of fs.readdirSync(absolute).sort()) walkFiles(root, `${relative}/${name}`, output)
}

function atomicWrite(file, bytes, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, mode)
  try {
    fs.writeFileSync(fd, bytes)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temporary, file)
}

function manifestPayload(manifest) {
  const { receiptSha256: _receipt, ...payload } = manifest
  return payload
}

export function verifyBackup({ backupDir }) {
  const manifestFile = path.join(backupDir, 'manifest.json')
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) } catch (error) {
    fail('BACKUP_MANIFEST_INVALID', `backup manifest cannot be read: ${error.message}`)
  }
  if (manifest?.schemaVersion !== BACKUP_SCHEMA_VERSION || manifest.kind !== BACKUP_KIND || !Array.isArray(manifest.files)) {
    fail('BACKUP_MANIFEST_INVALID', 'backup manifest has an unsupported shape')
  }
  if (JSON.stringify(manifest.authoritativeInventory) !== JSON.stringify(AUTHORITATIVE_DATA_PATHS)) {
    fail('BACKUP_MANIFEST_INVALID', 'backup manifest does not use the supported authoritative inventory')
  }
  const expectedReceipt = sha256(JSON.stringify(manifestPayload(manifest)))
  if (manifest.receiptSha256 !== expectedReceipt) fail('BACKUP_RECEIPT_MISMATCH', 'backup manifest receipt does not match')
  const seen = new Set()
  let totalBytes = 0
  for (const entry of manifest.files) {
    const relative = normalizedRelative(entry?.path)
    if (seen.has(relative)) fail('BACKUP_MANIFEST_INVALID', `duplicate backup path: ${relative}`)
    seen.add(relative)
    if (!/^[a-f0-9]{64}$/.test(String(entry.sha256 || '')) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      fail('BACKUP_MANIFEST_INVALID', `invalid backup entry: ${relative}`)
    }
    const payload = resolveBeneath(path.join(backupDir, 'payload'), relative)
    const stat = fs.lstatSync(payload)
    if (!stat.isFile() || stat.isSymbolicLink()) fail('BACKUP_FILE_TYPE_DENIED', `invalid backup payload: ${relative}`)
    const bytes = fs.readFileSync(payload)
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail('BACKUP_PAYLOAD_MISMATCH', `backup payload does not match manifest: ${relative}`)
    if (relative.endsWith('.json')) {
      try { JSON.parse(bytes.toString('utf8')) } catch { fail('BACKUP_PAYLOAD_INVALID', `backup JSON is corrupt: ${relative}`) }
    }
    totalBytes += bytes.length
  }
  if (manifest.fileCount !== manifest.files.length || manifest.totalBytes !== totalBytes) fail('BACKUP_MANIFEST_INVALID', 'backup totals do not match payload')
  return manifest
}

export function createBackup({ dataDir, backupDir, sourceRevision = null, createdAt = Date.now(), inventory = AUTHORITATIVE_DATA_PATHS }) {
  if (fs.existsSync(backupDir)) fail('BACKUP_DESTINATION_EXISTS', 'backup destination already exists')
  const staging = `${backupDir}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  const files = []
  try {
    fs.mkdirSync(path.join(staging, 'payload'), { recursive: true, mode: 0o700 })
    const discovered = []
    for (const item of inventory) if (fs.existsSync(resolveBeneath(dataDir, item))) walkFiles(dataDir, item, discovered)
    for (const relative of [...new Set(discovered)].sort()) {
      const bytes = fs.readFileSync(resolveBeneath(dataDir, relative))
      atomicWrite(resolveBeneath(path.join(staging, 'payload'), relative), bytes)
      files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) })
    }
    const manifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      kind: BACKUP_KIND,
      createdAt,
      sourceRevision,
      secretValuesIncluded: false,
      keychainRestoreRequired: true,
      authoritativeInventory: [...inventory],
      excludedRebuildablePaths: [...REBUILDABLE_DATA_PATHS],
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
    }
    manifest.receiptSha256 = sha256(JSON.stringify(manifest))
    atomicWrite(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    verifyBackup({ backupDir: staging })
    fs.renameSync(staging, backupDir)
    return manifest
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

export function restoreBackup({ backupDir, dataDir }) {
  const manifest = verifyBackup({ backupDir })
  const rollbackDir = `${dataDir}.pre-restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const existed = fs.existsSync(dataDir)
  if (existed) fs.renameSync(dataDir, rollbackDir)
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    for (const entry of manifest.files) {
      const bytes = fs.readFileSync(resolveBeneath(path.join(backupDir, 'payload'), entry.path))
      atomicWrite(resolveBeneath(dataDir, entry.path), bytes)
    }
    return { schemaVersion: 1, status: 'restored', receiptSha256: manifest.receiptSha256, fileCount: manifest.fileCount, rollbackDir: existed ? rollbackDir : null, keychainRestoreRequired: true }
  } catch (error) {
    fs.rmSync(dataDir, { recursive: true, force: true })
    if (existed) fs.renameSync(rollbackDir, dataDir)
    throw error
  }
}
