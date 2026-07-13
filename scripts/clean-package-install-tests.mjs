import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-clean-install-'))
let server
let serverOutput = ''

async function freePort() {
  return await new Promise((resolve, reject) => {
    const socket = net.createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => { const { port } = socket.address(); socket.close(() => resolve(port)) })
  })
}

async function waitForHealth(port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) return { ok: true }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`packed server did not become healthy:\n${serverOutput}`)
}

try {
  const packed = spawnSync('npm', ['pack', '--silent', '--json', '--pack-destination', temp], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
  const jsonStart = packed.stdout.lastIndexOf('[\n  {\n    "id"')
  assert.ok(jsonStart >= 0, `npm pack did not emit its JSON report:\n${packed.stdout}`)
  const report = JSON.parse(packed.stdout.slice(jsonStart))[0]
  const tarball = path.join(temp, report.filename)
  assert.equal(fs.existsSync(tarball), true)
  const extract = spawnSync('tar', ['-xzf', tarball, '-C', temp], { encoding: 'utf8' })
  assert.equal(extract.status, 0, extract.stderr)
  const app = path.join(temp, 'package')
  assert.equal(fs.existsSync(path.join(app, 'dist', 'index.html')), true)
  assert.equal(fs.existsSync(path.join(app, 'dist', 'sbom.cdx.json')), true)
  assert.equal(fs.existsSync(path.join(app, 'data')), false)

  const install = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8', timeout: 120_000 })
  assert.equal(install.status, 0, install.stderr)
  const port = await freePort()
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: app,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ACC_DATA_DIR: '.test-data', ACC_BRAIN_DIR: '.test-brain' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => { serverOutput += chunk })
  server.stderr.on('data', chunk => { serverOutput += chunk })
  const health = await waitForHealth(port)
  assert.equal(health.ok, true)
  const shell = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(shell.status, 200)
  assert.match(await shell.text(), /AI Command Center/i)
  console.log('clean package install tests: 10/10 passed')
} finally {
  if (server && !server.killed) server.kill('SIGTERM')
  fs.rmSync(temp, { recursive: true, force: true })
}
