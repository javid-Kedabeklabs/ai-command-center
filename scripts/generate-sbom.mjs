import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function fail(message) { throw new Error(message) }
function encodePurl(value) { return encodeURIComponent(value).replaceAll('%2F', '%2F') }

export function generateSbom({ root = process.cwd(), serialNumber = null } = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') fail('package-lock v3 is required')
  const components = []
  const seen = new Set()
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || !entry?.version) continue
    const marker = '/node_modules/'
    const offset = location.lastIndexOf(marker)
    const name = offset >= 0 ? location.slice(offset + marker.length) : location.replace(/^node_modules\//, '')
    if (!name) continue
    const key = `${name}@${entry.version}`
    if (seen.has(key)) continue
    seen.add(key)
    const component = {
      type: 'library',
      'bom-ref': `pkg:npm/${encodePurl(name)}@${encodeURIComponent(entry.version)}`,
      name,
      version: entry.version,
      purl: `pkg:npm/${encodePurl(name)}@${encodeURIComponent(entry.version)}`,
      scope: entry.dev ? 'optional' : 'required',
    }
    if (entry.license) component.licenses = [{ license: { id: String(entry.license) } }]
    if (entry.integrity) component.hashes = [{ alg: 'SHA-512', content: Buffer.from(String(entry.integrity).replace(/^sha512-/, ''), 'base64').toString('hex') }]
    components.push(component)
  }
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']))
  const rootRef = `pkg:npm/${encodePurl(packageJson.name)}@${encodeURIComponent(packageJson.version)}`
  const stableIdentity = crypto.createHash('sha256').update(JSON.stringify({ rootRef, components })).digest('hex')
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serialNumber || `urn:uuid:${stableIdentity.slice(0, 8)}-${stableIdentity.slice(8, 12)}-4${stableIdentity.slice(13, 16)}-a${stableIdentity.slice(17, 20)}-${stableIdentity.slice(20, 32)}`,
    version: 1,
    metadata: {
      component: { type: 'application', 'bom-ref': rootRef, name: packageJson.name, version: packageJson.version, licenses: [{ license: { name: packageJson.license || 'UNLICENSED' } }] },
      tools: { components: [{ type: 'application', name: 'ai-command-center-sbom-generator', version: '1' }] },
      properties: [{ name: 'command-center:lockfileVersion', value: String(lock.lockfileVersion) }],
    },
    components,
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] || 'dist/sbom.cdx.json')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(generateSbom(), null, 2)}\n`, { mode: 0o644 })
  console.log(output)
}
