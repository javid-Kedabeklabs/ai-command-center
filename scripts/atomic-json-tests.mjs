import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { atomicWriteJsonSync } from '../server/storage/atomic-json.js'

let passed = 0
const test = (name, fn) => { try { fn(); passed++; console.log(`ok ${passed} - ${name}`) } catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1 } }
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-atomic-json-'))

test('writes parseable JSON through a same-directory replacement', () => {
  const root = fixture(), file = path.join(root, 'nested', 'state.json')
  atomicWriteJsonSync(file, { revision: 1, value: 'ready' })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { revision: 1, value: 'ready' })
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('preserves the previous canonical file when failure occurs before rename', () => {
  const root = fixture(), file = path.join(root, 'state.json')
  atomicWriteJsonSync(file, { revision: 1 })
  assert.throws(() => atomicWriteJsonSync(file, { revision: 2 }, { onStage(stage) { if (stage === 'before-rename') throw new Error('injected failure') } }), /injected failure/)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { revision: 1 })
  assert.deepEqual(fs.readdirSync(root), ['state.json'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('commits the complete new value when interruption occurs after rename', () => {
  const root = fixture(), file = path.join(root, 'state.json')
  atomicWriteJsonSync(file, { revision: 1 })
  assert.throws(() => atomicWriteJsonSync(file, { revision: 2 }, { onStage(stage) { if (stage === 'after-rename') throw new Error('injected interruption') } }), /injected interruption/)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { revision: 2 })
  fs.rmSync(root, { recursive: true, force: true })
})

test('rejects symbolic-link targets without modifying the linked file', () => {
  const root = fixture(), outside = path.join(root, 'outside.json'), link = path.join(root, 'state.json')
  fs.writeFileSync(outside, '{"safe":true}\n'); fs.symlinkSync(outside, link)
  assert.throws(() => atomicWriteJsonSync(link, { safe: false }), error => error.code === 'ATOMIC_WRITE_SYMLINK')
  assert.deepEqual(JSON.parse(fs.readFileSync(outside, 'utf8')), { safe: true })
  fs.rmSync(root, { recursive: true, force: true })
})

test('rejects a symbolic-link parent directory', () => {
  const root = fixture(), outside = path.join(root, 'outside'), link = path.join(root, 'state')
  fs.mkdirSync(outside); fs.symlinkSync(outside, link)
  assert.throws(() => atomicWriteJsonSync(path.join(link, 'state.json'), { safe: false }), error => error.code === 'ATOMIC_WRITE_SYMLINK_DIRECTORY')
  assert.deepEqual(fs.readdirSync(outside), [])
  fs.rmSync(root, { recursive: true, force: true })
})

test('never exposes partial JSON during repeated replacement', () => {
  const root = fixture(), file = path.join(root, 'state.json')
  for (let revision = 0; revision < 100; revision++) {
    atomicWriteJsonSync(file, { revision, payload: 'x'.repeat(revision * 10) })
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).revision, revision)
  }
  assert.deepEqual(fs.readdirSync(root), ['state.json'])
  fs.rmSync(root, { recursive: true, force: true })
})

if (!process.exitCode) console.log(`1..${passed}`)
