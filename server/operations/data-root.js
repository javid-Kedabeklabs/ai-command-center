import fs from 'node:fs'
import path from 'node:path'

function beneath(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

export function resolveDataRoot({ repositoryRoot, configured, allowExternal = false }) {
  const root = path.resolve(repositoryRoot)
  const candidate = configured ? path.resolve(root, configured) : path.join(root, 'data')
  if (!beneath(root, candidate) && !allowExternal) throw new Error('ACC_DATA_DIR must resolve inside the repository worktree unless ACC_ALLOW_EXTERNAL_DATA_DIR=1')
  if (candidate === path.parse(candidate).root || candidate === path.resolve(process.env.HOME || '~')) throw new Error('ACC_DATA_DIR cannot be a filesystem root or home directory')
  const existing = fs.existsSync(candidate) ? fs.realpathSync(candidate) : null
  if (existing && existing !== candidate) throw new Error('ACC_DATA_DIR must not be a symbolic link')
  return candidate
}
