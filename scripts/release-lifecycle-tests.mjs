import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installRelease, rollbackRelease } from '../server/operations/release-install.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-release-lifecycle-'))
const installRoot = path.join(root, 'install')

function archive(version) {
  const source = path.join(root, `source-${version}`), packageDir = path.join(source, 'package'), output = path.join(root, `${version}.tgz`)
  fs.mkdirSync(path.join(packageDir, 'server'), { recursive: true })
  fs.mkdirSync(path.join(packageDir, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'ai-command-center', version }))
  fs.writeFileSync(path.join(packageDir, 'server', 'index.js'), `// ${version}\n`)
  fs.writeFileSync(path.join(packageDir, 'dist', 'index.html'), `<p>${version}</p>`)
  const result = spawnSync('tar', ['-czf', output, '-C', source, 'package'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return output
}

try {
  fs.mkdirSync(path.join(installRoot, 'data', 'workflows'), { recursive: true })
  fs.writeFileSync(path.join(installRoot, 'data', 'workflows', 'alpha.json'), '{"revision":1}\n')
  const first = installRelease({ archive: archive('1.0.0'), installRoot, installDependencies: false, createdAt: 100 })
  assert.equal(first.previousRelease, null)
  assert.match(fs.readlinkSync(path.join(installRoot, 'current')), /^releases\/1\.0\.0-/)
  fs.writeFileSync(path.join(installRoot, 'data', 'workflows', 'alpha.json'), '{"revision":2}\n')
  const second = installRelease({ archive: archive('1.1.0'), installRoot, installDependencies: false, createdAt: 200 })
  assert.match(second.previousRelease, /^releases\/1\.0\.0-/)
  assert.ok(second.backupReceiptSha256)
  assert.match(fs.readlinkSync(path.join(installRoot, 'current')), /^releases\/1\.1\.0-/)
  fs.writeFileSync(path.join(installRoot, 'data', 'workflows', 'alpha.json'), '{"revision":3}\n')
  const rollback = rollbackRelease({ installRoot, receipt: second })
  assert.equal(rollback.status, 'rolled-back')
  assert.match(fs.readlinkSync(path.join(installRoot, 'current')), /^releases\/1\.0\.0-/)
  assert.equal(fs.readFileSync(path.join(installRoot, 'data', 'workflows', 'alpha.json'), 'utf8'), '{"revision":2}\n')
  const bad = { ...second, archiveSha256: 'tampered' }
  assert.throws(() => rollbackRelease({ installRoot, receipt: bad }), error => error.code === 'RELEASE_RECEIPT_INVALID')
  console.log('release lifecycle tests: 10/10 passed')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
