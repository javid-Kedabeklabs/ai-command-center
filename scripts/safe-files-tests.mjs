import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listRegularFilesBeneath, readFileBeneath, resolvePathBeneath, unlinkFileBeneath, writeFileBeneath } from '../server/security/safe-files.js'

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-safe-files-')), root = path.join(parent, 'root'), outside = path.join(parent, 'outside.txt')
fs.mkdirSync(root); fs.writeFileSync(outside, 'outside-canary'); fs.symlinkSync(outside, path.join(root, 'file-link')); fs.symlinkSync(parent, path.join(root, 'dir-link'))
let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS ${name}`) }
console.log('== symlink-safe filesystem boundary ==')
try {
  test('regular nested writes, reads, appends, listings, and deletes work', () => {
    writeFileBeneath(root, 'nested/result.txt', 'one')
    writeFileBeneath(root, 'nested/result.txt', '-two', { append: true })
    assert.equal(readFileBeneath(root, 'nested/result.txt'), 'one-two')
    assert.deepEqual(listRegularFilesBeneath(path.join(root, 'nested')).map(item => item.name), ['result.txt'])
    unlinkFileBeneath(root, 'nested/result.txt'); assert.equal(fs.existsSync(path.join(root, 'nested/result.txt')), false)
  })
  test('lexical traversal and absolute paths fail closed', () => {
    assert.throws(() => resolvePathBeneath(root, '../outside.txt'), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
    assert.throws(() => resolvePathBeneath(root, outside), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
  })
  test('file symlinks cannot be read, written, or deleted', () => {
    assert.throws(() => readFileBeneath(root, 'file-link'), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
    assert.throws(() => writeFileBeneath(root, 'file-link', 'changed'), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
    assert.throws(() => unlinkFileBeneath(root, 'file-link'), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside-canary')
  })
  test('broken symlink targets fail closed before creation', () => {
    fs.symlinkSync(path.join(parent, 'missing.txt'), path.join(root, 'broken-link'))
    assert.throws(() => writeFileBeneath(root, 'broken-link', 'changed'), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
    assert.equal(fs.existsSync(path.join(parent, 'missing.txt')), false)
  })
  test('directory symlinks cannot be crossed for existing or new targets', () => {
    assert.throws(() => readFileBeneath(root, 'dir-link/outside.txt'), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
    assert.throws(() => writeFileBeneath(root, 'dir-link/new.txt', 'changed'), error => error.code === 'UNSAFE_FILESYSTEM_PATH')
    assert.equal(fs.existsSync(path.join(parent, 'new.txt')), false)
  })
  test('listing excludes symbolic links', () => {
    writeFileBeneath(root, 'visible.txt', 'safe')
    assert.deepEqual(listRegularFilesBeneath(root).map(item => item.name), ['visible.txt'])
  })
} finally { fs.rmSync(parent, { recursive: true, force: true }) }
console.log(`safe filesystem tests: ${passed}/6 passed`)
