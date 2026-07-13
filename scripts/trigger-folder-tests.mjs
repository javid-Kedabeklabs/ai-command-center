import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  advanceFolderCandidates,
  diffFolderSnapshots,
  folderDeliveryIdentity,
  normalizeFolderConfig,
  publicFolderEvidence,
  scanFolderSnapshot,
} from '../server/triggers/folder.js'

let passed = 0, failed = 0
async function test(name, operation) {
  try { await operation(); console.log(`  PASS  ${name}`); passed++ }
  catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ }
}
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trigger-folder-'))
const expectCode = (operation, code) => {
  try { operation(); throw new Error(`expected ${code}`) }
  catch (error) { if (error.code !== code) throw error }
}
const config = (directory, overrides = {}) => normalizeFolderConfig({ path: directory, settleMs: 100, debounceMs: 200, ...overrides }, { approvedRoots: [directory] })

console.log('== hardened folder trigger foundation ==')

await test('strict config requires a nonempty absolute readable directory and explicit roots', () => {
  const dir = fixture()
  expectCode(() => normalizeFolderConfig({ path: '' }, { approvedRoots: [dir] }), 'FOLDER_PATH_REQUIRED')
  expectCode(() => normalizeFolderConfig({ path: 'relative' }, { approvedRoots: [dir] }), 'FOLDER_PATH_INVALID')
  expectCode(() => normalizeFolderConfig({ path: dir }), 'FOLDER_SCOPE_REQUIRED')
  expectCode(() => normalizeFolderConfig({ path: dir, extensions: 'txt' }, { approvedRoots: [dir] }), 'FOLDER_CONFIG_INVALID')
  expectCode(() => normalizeFolderConfig({ path: dir, pollMs: Number.NaN }, { approvedRoots: [dir] }), 'FOLDER_CONFIG_INVALID')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('lexical and configured-root symlink escapes fail closed', () => {
  const parent = fixture(), approved = path.join(parent, 'approved'), outside = path.join(parent, 'outside')
  fs.mkdirSync(approved); fs.mkdirSync(outside)
  expectCode(() => normalizeFolderConfig({ path: outside }, { approvedRoots: [approved] }), 'FOLDER_PATH_ESCAPE')
  fs.symlinkSync(outside, path.join(approved, 'escape'))
  expectCode(() => normalizeFolderConfig({ path: path.join(approved, 'escape') }, { approvedRoots: [approved] }), 'FOLDER_SYMLINK_REJECTED')
  fs.rmSync(parent, { recursive: true, force: true })
})

await test('entry symlinks are rejected and never traversed', () => {
  const parent = fixture(), watched = path.join(parent, 'watched'), outside = path.join(parent, 'outside')
  fs.mkdirSync(watched); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 'not read')
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(watched, 'link.txt'))
  expectCode(() => scanFolderSnapshot(config(watched)), 'FOLDER_SYMLINK_REJECTED')
  fs.rmSync(parent, { recursive: true, force: true })
})

await test('extension filters are normalized, case-insensitive, and scans never read contents', () => {
  const dir = fixture(); fs.writeFileSync(path.join(dir, 'A.TXT'), 'one'); fs.writeFileSync(path.join(dir, 'b.md'), 'two')
  const normalized = config(dir, { extensions: ['.TXT', 'txt'] })
  const snapshot = scanFolderSnapshot(normalized)
  if (normalized.extensions.join(',') !== 'txt' || Object.keys(snapshot.entries).join(',') !== 'A.TXT') throw new Error(JSON.stringify({ normalized, snapshot }))
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('maximum files, depth, and scan duration fail explicitly', () => {
  const dir = fixture(); fs.writeFileSync(path.join(dir, 'a.txt'), 'a'); fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
  expectCode(() => scanFolderSnapshot(config(dir, { maxFiles: 1 })), 'FOLDER_MAX_FILES')
  fs.mkdirSync(path.join(dir, 'nested')); fs.writeFileSync(path.join(dir, 'nested', 'c.txt'), 'c')
  expectCode(() => scanFolderSnapshot(config(dir, { maxDepth: 0 })), 'FOLDER_MAX_DEPTH')
  let tick = 0
  expectCode(() => scanFolderSnapshot(config(dir, { scanTimeoutMs: 10 }), { clock: () => (tick += 20) }), 'FOLDER_SCAN_TIMEOUT')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('snapshot diff classifies create, modify, same-mtime replacement, rename, and optional deletion', () => {
  const dir = fixture(), normalized = config(dir)
  const empty = scanFolderSnapshot(normalized)
  const one = path.join(dir, 'one.txt'); fs.writeFileSync(one, 'one')
  const created = scanFolderSnapshot(normalized)
  if (diffFolderSnapshots(empty, created)[0]?.type !== 'created') throw new Error('creation not classified')
  fs.appendFileSync(one, '-changed')
  const modified = scanFolderSnapshot(normalized)
  if (diffFolderSnapshots(created, modified)[0]?.type !== 'modified') throw new Error('modification not classified')

  const previousMtime = fs.statSync(one).mtime
  fs.unlinkSync(one); fs.writeFileSync(one, 'replacement'); fs.utimesSync(one, previousMtime, previousMtime)
  const replaced = scanFolderSnapshot(normalized)
  if (diffFolderSnapshots(modified, replaced)[0]?.type !== 'replaced') throw new Error(JSON.stringify(diffFolderSnapshots(modified, replaced)))

  fs.renameSync(one, path.join(dir, 'renamed.txt'))
  const renamed = scanFolderSnapshot(normalized), renameEvents = diffFolderSnapshots(replaced, renamed)
  if (renameEvents.length !== 1 || renameEvents[0].type !== 'renamed' || renameEvents[0].previousRelativePath !== 'one.txt') throw new Error(JSON.stringify(renameEvents))

  fs.unlinkSync(path.join(dir, 'renamed.txt'))
  const deleted = scanFolderSnapshot(normalized)
  if (diffFolderSnapshots(renamed, deleted).length !== 0 || diffFolderSnapshots(renamed, deleted, { emitDeleted: true })[0]?.type !== 'deleted') throw new Error('deletion policy mismatch')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('settle state resets on partial writes and emits only after stable time', () => {
  const event = (hash, size) => ({ type: 'modified', relativePath: 'upload.txt', fingerprint: { hash, size } })
  let result = advanceFolderCandidates(null, [event('a'.repeat(64), 10)], { now: 0, settleMs: 100, debounceMs: 200 })
  if (result.ready.length) throw new Error('first observation emitted early')
  result = advanceFolderCandidates(result.state, [event('b'.repeat(64), 20)], { now: 50, settleMs: 100, debounceMs: 200 })
  result = advanceFolderCandidates(result.state, [], { now: 149, settleMs: 100, debounceMs: 200 })
  if (result.ready.length) throw new Error('changed file emitted before stable interval')
  result = advanceFolderCandidates(result.state, [], { now: 150, settleMs: 100, debounceMs: 200 })
  if (result.ready.length !== 1 || result.ready[0].fingerprint.size !== 20) throw new Error('stable candidate did not emit latest observation')
})

await test('debounce suppresses rapid re-emission and candidate count is bounded', () => {
  const event = hash => ({ type: 'modified', relativePath: 'rapid.txt', fingerprint: { hash } })
  let result = advanceFolderCandidates(null, [event('a'.repeat(64))], { now: 0, settleMs: 0, debounceMs: 200 })
  if (result.ready.length !== 1) throw new Error('initial stable event did not emit')
  result = advanceFolderCandidates(result.state, [event('b'.repeat(64))], { now: 50, settleMs: 0, debounceMs: 200 })
  if (result.ready.length) throw new Error('rapid event bypassed debounce')
  result = advanceFolderCandidates(result.state, [], { now: 199, settleMs: 0, debounceMs: 200 })
  if (result.ready.length) throw new Error('candidate emitted before debounce boundary')
  result = advanceFolderCandidates(result.state, [], { now: 200, settleMs: 0, debounceMs: 200 })
  if (result.ready.length !== 1) throw new Error('debounced candidate did not emit at boundary')
  expectCode(() => advanceFolderCandidates(null, [event('c'.repeat(64)), { ...event('d'.repeat(64)), relativePath: 'second.txt' }], { now: 0, settleMs: 100, maxCandidates: 1 }), 'FOLDER_MAX_CANDIDATES')
})

await test('delivery identity is stable and public evidence contains hashes, never paths', () => {
  const dir = fixture(), normalized = config(dir), event = { type: 'created', relativePath: 'private/customer.txt', fingerprint: { hash: 'c'.repeat(64) } }
  const first = folderDeliveryIdentity('trigger-fixture01', normalized.rootHash, event)
  const second = folderDeliveryIdentity('trigger-fixture01', normalized.rootHash, structuredClone(event))
  const evidence = publicFolderEvidence(event), serialized = JSON.stringify(evidence)
  if (first !== second || !/^[a-f0-9]{64}$/.test(first)) throw new Error('identity is not stable and redacted')
  if (serialized.includes('private') || serialized.includes('customer.txt') || serialized.includes(dir)) throw new Error(`public evidence leaked a path: ${serialized}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
