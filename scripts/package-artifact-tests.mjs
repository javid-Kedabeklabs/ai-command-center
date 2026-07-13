import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateSbom } from './generate-sbom.mjs'

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: process.cwd(), encoding: 'utf8' })
assert.equal(result.status, 0, result.stderr)
const jsonStart = result.stdout.lastIndexOf('[\n  {\n    "id"')
assert.ok(jsonStart >= 0, `npm pack did not emit its JSON report:\n${result.stdout}`)
const report = JSON.parse(result.stdout.slice(jsonStart))[0]
const paths = report.files.map(file => file.path)
const forbidden = ['data/', 'state/', 'logs/', '.git/', '.claude/', '.agent-skills/', '.tmp', 'node_modules/']
for (const prefix of forbidden) assert.equal(paths.some(file => file === prefix.slice(0, -1) || file.startsWith(prefix)), false, `artifact contains forbidden path ${prefix}`)
for (const required of ['package.json', 'server/index.js', 'web/index.html', 'scripts/verify-release.mjs']) assert.equal(paths.includes(required), true, `artifact is missing ${required}`)

const sbom = generateSbom()
assert.equal(sbom.bomFormat, 'CycloneDX')
assert.equal(sbom.specVersion, '1.5')
assert.ok(sbom.components.length > 20)
assert.equal(new Set(sbom.components.map(component => component['bom-ref'])).size, sbom.components.length)
assert.equal(sbom.components.some(component => component.name === 'express' && component.scope === 'required'), true)
assert.equal(sbom.components.some(component => component.name === '@playwright/test' && component.scope === 'optional'), true)
assert.equal(sbom.components.every(component => /^pkg:npm\/.+@.+/.test(component.purl)), true)

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-package-test-'))
try {
  const output = path.join(temp, 'sbom.cdx.json')
  fs.writeFileSync(output, JSON.stringify(sbom))
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), sbom)
} finally { fs.rmSync(temp, { recursive: true, force: true }) }

console.log(`package artifact tests: 15/15 passed (${paths.length} files, ${sbom.components.length} dependency components)`)
