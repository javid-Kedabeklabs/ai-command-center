import fs from 'node:fs'
import path from 'node:path'

const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)
const fail = message => { throw Object.assign(new Error(message), { code: 'UNSAFE_FILESYSTEM_PATH' }) }
const lstat = value => { try { return fs.lstatSync(value) } catch (error) { if (error?.code === 'ENOENT') return null; throw error } }

function canonicalRoot(root) {
  const resolved = fs.realpathSync(path.resolve(root))
  if (!fs.statSync(resolved).isDirectory()) fail('filesystem root must be a directory')
  return resolved
}

function inspectBeneath(root, candidate, { allowMissing = false, allowRoot = false } = {}) {
  if (!inside(root, candidate) || (!allowRoot && candidate === root)) fail('path must stay beneath the authorized root')
  const relative = path.relative(root, candidate), parts = relative ? relative.split(path.sep) : []
  let current = root
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index])
    const stat = lstat(current)
    if (!stat) {
      if (allowMissing) return
      fail('filesystem path does not exist')
    }
    if (stat.isSymbolicLink()) fail('symbolic links are not allowed beneath an authorized root')
    if (index < parts.length - 1 && !stat.isDirectory()) fail('filesystem parent is not a directory')
  }
}

export function resolvePathBeneath(rootValue, relativeValue, options = {}) {
  const root = canonicalRoot(rootValue)
  const relative = String(relativeValue || '')
  if (!relative || path.isAbsolute(relative) || relative.includes('\0')) fail('path must be a non-empty relative path')
  const candidate = path.resolve(root, relative)
  inspectBeneath(root, candidate, options)
  return { root, path: candidate, relative: path.relative(root, candidate) }
}

function ensureParents(root, file) {
  const parts = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    let stat = lstat(current)
    if (!stat) { fs.mkdirSync(current, { mode: 0o700 }); stat = fs.lstatSync(current) }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('write parent must be a real directory beneath the authorized root')
  }
}

export function readFileBeneath(root, relative, encoding = 'utf8') {
  const target = resolvePathBeneath(root, relative)
  const descriptor = fs.openSync(target.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    if (!fs.fstatSync(descriptor).isFile()) fail('read target must be a regular file')
    return fs.readFileSync(descriptor, encoding)
  } finally { fs.closeSync(descriptor) }
}

export function writeFileBeneath(rootValue, relative, value, { encoding = 'utf8', append = false, mode = 0o600 } = {}) {
  const target = resolvePathBeneath(rootValue, relative, { allowMissing: true })
  ensureParents(target.root, target.path)
  if (lstat(target.path)?.isSymbolicLink()) fail('write target cannot be a symbolic link')
  const flags = (append ? fs.constants.O_APPEND : fs.constants.O_TRUNC) | fs.constants.O_CREAT | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0)
  const descriptor = fs.openSync(target.path, flags, mode)
  try {
    if (!fs.fstatSync(descriptor).isFile()) fail('write target must be a regular file')
    fs.writeFileSync(descriptor, value, encoding)
  } finally { fs.closeSync(descriptor) }
  return target.path
}

export function unlinkFileBeneath(root, relative) {
  const target = resolvePathBeneath(root, relative)
  if (!fs.lstatSync(target.path).isFile()) fail('delete target must be a regular file')
  fs.unlinkSync(target.path)
}

export function listRegularFilesBeneath(rootValue) {
  const root = canonicalRoot(rootValue), files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink() || !entry.isFile()) continue
    const target = resolvePathBeneath(root, entry.name)
    const stat = fs.lstatSync(target.path)
    files.push({ name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs })
  }
  return files
}
