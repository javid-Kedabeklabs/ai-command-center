import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function syncDirectory(directory, fsModule) {
  let descriptor
  try {
    descriptor = fsModule.openSync(directory, 'r')
    fsModule.fsyncSync(descriptor)
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EISDIR'].includes(error?.code)) throw error
  } finally {
    if (descriptor != null) fsModule.closeSync(descriptor)
  }
}

function isInside(candidate, directory) {
  const relative = path.relative(directory, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function atomicWriteFileSync(file, content, options = {}) {
  const fsModule = options.fsModule || fs
  const target = path.resolve(file)
  const directory = path.dirname(target)
  fsModule.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (fsModule.lstatSync(directory).isSymbolicLink()) {
    throw Object.assign(new Error('atomic writer refuses a symbolic-link directory'), { code: 'ATOMIC_WRITE_SYMLINK_DIRECTORY' })
  }
  if (fsModule.existsSync(target) && fsModule.lstatSync(target).isSymbolicLink()) {
    throw Object.assign(new Error('atomic writer refuses a symbolic-link target'), { code: 'ATOMIC_WRITE_SYMLINK' })
  }

  const temporary = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}.tmp`
  if (!isInside(temporary, directory)) throw new Error('invalid atomic-write temporary path')
  let descriptor, renamed = false
  try {
    descriptor = fsModule.openSync(temporary, 'wx', options.mode ?? 0o600)
    fsModule.writeFileSync(descriptor, content, options.encoding ? { encoding: options.encoding } : undefined)
    fsModule.fsyncSync(descriptor)
    fsModule.closeSync(descriptor)
    descriptor = undefined
    options.onStage?.('before-rename', { target, temporary })
    fsModule.renameSync(temporary, target)
    renamed = true
    options.onStage?.('after-rename', { target, temporary })
    syncDirectory(directory, fsModule)
  } catch (error) {
    if (descriptor != null) {
      try { fsModule.closeSync(descriptor) } catch {}
    }
    try { fsModule.rmSync(temporary, { force: true }) } catch {}
    if (renamed && error && typeof error === 'object') {
      error.atomicWriteCommitted = true
      error.atomicWriteDurability = 'uncertain'
      error.atomicWriteTarget = target
    }
    throw error
  }
}

export function atomicWriteJsonSync(file, value, options = {}) {
  let serialized
  try { serialized = `${JSON.stringify(value, null, 2)}\n` }
  catch (error) { throw Object.assign(new Error(`value cannot be serialized as JSON: ${error.message}`), { code: 'ATOMIC_JSON_SERIALIZE' }) }
  atomicWriteFileSync(file, serialized, { ...options, encoding: 'utf8' })
}
