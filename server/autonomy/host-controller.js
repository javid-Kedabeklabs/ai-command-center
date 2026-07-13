import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const defaultExecFile = promisify(nodeExecFile)
const SAFE_BACKUP_FILES = new Set(['data/workflow-triggers.json', 'data/workflow-trigger-history.json'])
const SAFE_HEALTH_PATHS = new Set(['/', '/api/system', '/api/runs'])
const safeLabel = value => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(value || ''))
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)
const digest = value => crypto.createHash('sha256').update(value).digest('hex')

function safeRelative(root, value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('backup include path is unsafe')
  const candidate = path.resolve(root, value)
  if (!inside(root, candidate)) throw new Error('backup include path escapes repository')
  if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error('backup include path cannot be a symlink')
  return { relative: value, absolute: candidate }
}

async function run(execFile, command, args, options = {}) {
  const result = await execFile(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120_000, ...options })
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') }
}

export function createHostController({
  root,
  backupsRoot = path.join(path.dirname(fs.realpathSync(path.resolve(root))), 'command-center-backups'),
  serviceLabel = 'com.local.commandcenter',
  baseUrl = 'http://127.0.0.1:1717',
  execFile = defaultExecFile,
  fetchImpl = globalThis.fetch,
  clock = Date.now,
} = {}) {
  const repositoryRoot = fs.realpathSync(path.resolve(root))
  const backupRoot = path.resolve(backupsRoot)

  async function activeRuns() {
    const response = await fetchImpl(`${baseUrl}/api/runs`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`active workflow check returned HTTP ${response.status}`)
    const runs = await response.json()
    if (!Array.isArray(runs)) throw new Error('active workflow response is invalid')
    return runs.filter(run => ['running', 'paused', 'waiting', 'awaiting_approval', 'retrying'].includes(String(run?.status || '').toLowerCase()))
  }

  async function execute(request) {
    const startedAt = clock()
    let output
    if (request.operation === 'git.status') {
      output = await run(execFile, 'git', ['-C', repositoryRoot, 'status', '--short'])
    } else if (request.operation === 'workflow.active_count') {
      const active = await activeRuns()
      output = { activeCount: active.length, activeRunIds: active.map(run => String(run.id || '')).filter(Boolean).slice(0, 100) }
    } else if (request.operation === 'health.local') {
      const requestedPath = request.params.path || '/'
      if (!SAFE_HEALTH_PATHS.has(requestedPath)) throw new Error('health path is not allowlisted')
      const response = await fetchImpl(`${baseUrl}${requestedPath === '/' ? '/' : requestedPath}`, { signal: AbortSignal.timeout(5_000) })
      output = { path: requestedPath, status: response.status, ok: response.ok }
      if (!response.ok) throw new Error(`health check returned HTTP ${response.status}`)
    } else if (request.operation === 'service.status') {
      const uid = typeof process.getuid === 'function' ? process.getuid() : 501
      output = await run(execFile, 'launchctl', ['print', `gui/${uid}/${serviceLabel}`])
    } else if (request.operation === 'service.reload') {
      const active = await activeRuns()
      if (active.length) throw new Error(`service reload refused while ${active.length} workflow runs are active`)
      const uid = typeof process.getuid === 'function' ? process.getuid() : 501
      const processResult = await run(execFile, 'launchctl', ['kickstart', '-k', `gui/${uid}/${serviceLabel}`])
      let health = null
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const response = await fetchImpl(`${baseUrl}/api/system`, { signal: AbortSignal.timeout(2_000) })
          if (response.ok) { health = { status: response.status, attempts: attempt + 1 }; break }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      if (!health) throw new Error('service reload completed but the health postcondition did not pass')
      output = { ...processResult, health }
    } else if (request.operation === 'backup.create') {
      const label = request.params.label
      if (!safeLabel(label)) throw new Error('backup label is invalid')
      const destination = path.join(backupRoot, label)
      if (!inside(backupRoot, destination) || fs.existsSync(destination)) throw new Error('backup destination exists or is unsafe')
      const sources = []
      for (const item of request.params.includePaths || []) {
        if (!SAFE_BACKUP_FILES.has(item) && !item.startsWith('scripts/trigger-folder-') && !item.startsWith('server/triggers/')) throw new Error(`backup path is not allowlisted: ${item}`)
        const source = safeRelative(repositoryRoot, item)
        if (fs.existsSync(source.absolute)) {
          if (!fs.statSync(source.absolute).isFile()) throw new Error(`backup path is not a regular file: ${item}`)
          sources.push(source)
        }
      }
      fs.mkdirSync(destination, { recursive: false, mode: 0o700 })
      const diff = await run(execFile, 'git', ['-C', repositoryRoot, 'diff', '--binary', 'HEAD'])
      const patchFile = path.join(destination, 'working-tree.patch')
      fs.writeFileSync(patchFile, diff.stdout, { mode: 0o600 })
      const copied = []
      for (const source of sources) {
        const target = path.join(destination, 'files', source.relative)
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
        fs.copyFileSync(source.absolute, target); fs.chmodSync(target, 0o600)
        copied.push({ path: source.relative, sha256: digest(fs.readFileSync(target)) })
      }
      const manifest = { schemaVersion: 1, repositoryRoot, head: (await run(execFile, 'git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'])).stdout.trim(), createdAt: new Date(clock()).toISOString(), patch: { path: 'working-tree.patch', sha256: digest(fs.readFileSync(patchFile)) }, files: copied }
      fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      output = { backup: destination, manifestSha256: digest(fs.readFileSync(path.join(destination, 'manifest.json'))), files: copied.length }
    } else if (request.operation === 'backup.verify') {
      const label = request.params.label
      if (!safeLabel(label)) throw new Error('backup label is invalid')
      const destination = path.join(backupRoot, label), manifestFile = path.join(destination, 'manifest.json')
      if (!inside(backupRoot, destination) || !fs.existsSync(manifestFile)) throw new Error('backup manifest does not exist')
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      const patch = safeRelative(destination, manifest?.patch?.path)
      if (digest(fs.readFileSync(patch.absolute)) !== manifest.patch.sha256) throw new Error('backup patch hash mismatch')
      for (const file of manifest.files || []) {
        const stored = safeRelative(path.join(destination, 'files'), file.path)
        if (digest(fs.readFileSync(stored.absolute)) !== file.sha256) throw new Error(`backup file hash mismatch: ${file.path}`)
      }
      output = { backup: destination, verified: true, manifestSha256: digest(fs.readFileSync(manifestFile)) }
    } else {
      throw new Error('host operation is not implemented')
    }
    const safeOutput = JSON.parse(JSON.stringify(output, (key, value) => key === 'stdout' && typeof value === 'string' ? value.slice(-4_000) : key === 'stderr' && typeof value === 'string' ? value.slice(-2_000) : value))
    const receiptBody = { requestId: request.requestId, taskId: request.taskId, operation: request.operation, resource: request.resource, startedAt, finishedAt: clock(), output: safeOutput }
    return { ...receiptBody, receiptSha256: digest(JSON.stringify(receiptBody)) }
  }

  return { execute, repositoryRoot, backupRoot }
}
