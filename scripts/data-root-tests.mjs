import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDataRoot } from '../server/operations/data-root.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-data-root-'))
const repository = path.join(root, 'release')
const external = path.join(root, 'shared-data')
fs.mkdirSync(repository)
try {
  assert.equal(resolveDataRoot({ repositoryRoot: repository }), path.join(repository, 'data'))
  assert.equal(resolveDataRoot({ repositoryRoot: repository, configured: 'custom' }), path.join(repository, 'custom'))
  assert.throws(() => resolveDataRoot({ repositoryRoot: repository, configured: external }), /ACC_ALLOW_EXTERNAL_DATA_DIR/)
  assert.equal(resolveDataRoot({ repositoryRoot: repository, configured: external, allowExternal: true }), external)
  fs.mkdirSync(external)
  fs.symlinkSync(external, path.join(repository, 'linked-data'))
  assert.throws(() => resolveDataRoot({ repositoryRoot: repository, configured: 'linked-data' }), /symbolic link/)
  assert.throws(() => resolveDataRoot({ repositoryRoot: repository, configured: '/', allowExternal: true }), /filesystem root/)
  console.log('data root tests: 6/6 passed')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
