import crypto from 'node:crypto'

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/
const IMPLEMENTATIONS = new Set(['agent', 'python', 'shell', 'http', 'mcp', 'transform'])

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }) }
function tuple(value) { const match = VERSION.exec(String(value || '')); if (!match) fail('PLUGIN_VERSION_INVALID', `invalid semantic version: ${value}`); return match.slice(1, 4).map(Number) }
function compare(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }

export function validatePluginCompatibility(compatibility, currentVersion) {
  const current = tuple(currentVersion), source = compatibility?.commandCenter || compatibility || {}
  const minimum = source.min ? tuple(source.min) : [0, 0, 0], maximumExclusive = source.maxExclusive ? tuple(source.maxExclusive) : null
  if (compare(current, minimum) < 0 || maximumExclusive && compare(current, maximumExclusive) >= 0) fail('PLUGIN_INCOMPATIBLE', `plugin requires Command Center >=${source.min || '0.0.0'}${source.maxExclusive ? ` and <${source.maxExclusive}` : ''}`, 409)
  return { commandCenter: { min: source.min || '0.0.0', ...(source.maxExclusive ? { maxExclusive: source.maxExclusive } : {}) } }
}

export function verifyPluginSignature({ manifestHash, signature }) {
  if (!signature) return { status: 'unsigned' }
  if (signature.algorithm !== 'ed25519' || typeof signature.publicKey !== 'string' || typeof signature.value !== 'string') fail('PLUGIN_SIGNATURE_INVALID', 'plugin signature must be an Ed25519 public key and base64 signature')
  let valid = false
  try { valid = crypto.verify(null, Buffer.from(manifestHash, 'hex'), signature.publicKey, Buffer.from(signature.value, 'base64')) } catch {}
  if (!valid) fail('PLUGIN_SIGNATURE_INVALID', 'plugin signature does not match the exact manifest hash', 409)
  const key = crypto.createPublicKey(signature.publicKey).export({ type: 'spki', format: 'der' })
  return { status: 'verified-integrity', keyFingerprint: crypto.createHash('sha256').update(key).digest('hex') }
}

export function pluginPackageChecks(plugin, currentVersion) {
  const checks = []
  const add = (name, passed, detail) => checks.push({ name, passed, detail })
  add('manifest identity', /^[a-z0-9_-]+$/i.test(String(plugin?.id || '')) && !!plugin?.name && VERSION.test(String(plugin?.version || '')), 'Safe ID, name, and semantic version')
  try { validatePluginCompatibility(plugin?.compatibility, currentVersion); add('compatibility', true, `Compatible with ${currentVersion}`) } catch (error) { add('compatibility', false, error.message) }
  const nodes = Array.isArray(plugin?.nodes) ? plugin.nodes : []
  add('contributed node identities', new Set(nodes.map(node => node?.id)).size === nodes.length && nodes.every(node => /^[a-z0-9_-]+$/i.test(String(node?.id || ''))), `${nodes.length} unique contributed nodes`)
  add('implementation adapters', nodes.every(node => IMPLEMENTATIONS.has(node?.implementation?.kind)), 'Every node uses a supported adapter')
  add('test declarations', nodes.every(node => Array.isArray(node.tests) && node.tests.length > 0), 'Every contributed node declares at least one deterministic fixture')
  return { passed: checks.every(check => check.passed), checks }
}

export function portablePluginPackage(plugin) {
  const keys = ['id', 'name', 'version', 'description', 'publisher', 'license', 'compatibility', 'permissions', 'dependencies', 'provenance', 'nodes', 'signature']
  return Object.fromEntries(keys.filter(key => plugin[key] != null).map(key => [key, plugin[key]]))
}
