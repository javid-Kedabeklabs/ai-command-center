import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { generateSbom } from './generate-sbom.mjs'

const sbom = generateSbom()
assert.equal(sbom.components.every(component => Array.isArray(component.licenses) && component.licenses.length), true, 'every locked dependency must declare a license')
const deniedProductionLicense = /^(?:A?GPL|SSPL)(?:-|$)/i
const denied = sbom.components.filter(component => component.scope === 'required' && component.licenses.some(item => deniedProductionLicense.test(item.license.id || item.license.name || '')))
assert.deepEqual(denied, [], `production dependencies contain denied strong-copyleft licenses: ${denied.map(item => item.name).join(', ')}`)

const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 })
let report
try { report = JSON.parse(audit.stdout) } catch { throw new Error(`npm audit did not return JSON: ${audit.stderr || audit.stdout}`) }
const counts = report?.metadata?.vulnerabilities
assert.ok(counts, 'npm audit response is missing vulnerability totals')
assert.equal(Number(counts.critical || 0), 0, 'production dependency audit contains critical vulnerabilities')
assert.equal(Number(counts.high || 0), 0, 'production dependency audit contains high vulnerabilities')

const evidence = {
  schemaVersion: 1,
  status: 'passed',
  dependencyComponents: sbom.components.length,
  productionComponents: sbom.components.filter(component => component.scope === 'required').length,
  licenses: [...new Set(sbom.components.flatMap(component => component.licenses.map(item => item.license.id || item.license.name)))].sort(),
  vulnerabilities: counts,
}
evidence.receiptSha256 = crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
console.log(JSON.stringify(evidence, null, 2))
