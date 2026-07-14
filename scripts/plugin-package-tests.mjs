import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { pluginPackageChecks, portablePluginPackage, validatePluginCompatibility, verifyPluginSignature } from '../server/plugins/package.js'

assert.deepEqual(validatePluginCompatibility({ commandCenter: { min: '0.1.0', maxExclusive: '1.0.0' } }, '0.1.0'), { commandCenter: { min: '0.1.0', maxExclusive: '1.0.0' } })
assert.throws(() => validatePluginCompatibility({ commandCenter: { min: '0.2.0' } }, '0.1.0'), error => error.code === 'PLUGIN_INCOMPATIBLE')
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const hash = crypto.createHash('sha256').update('fixture').digest('hex')
const signature = crypto.sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64')
assert.equal(verifyPluginSignature({ manifestHash: hash, signature: { algorithm: 'ed25519', publicKey: publicKey.export({ type: 'spki', format: 'pem' }), value: signature } }).status, 'verified-integrity')
assert.throws(() => verifyPluginSignature({ manifestHash: '0'.repeat(64), signature: { algorithm: 'ed25519', publicKey: publicKey.export({ type: 'spki', format: 'pem' }), value: signature } }), error => error.code === 'PLUGIN_SIGNATURE_INVALID')
const plugin = { id: 'fixture', name: 'Fixture', version: '1.0.0', compatibility: { commandCenter: { min: '0.1.0' } }, nodes: [{ id: 'node', implementation: { kind: 'transform' }, tests: [{ input: 1 }] }], trustStatus: 'trusted' }
assert.equal(pluginPackageChecks(plugin, '0.1.0').passed, true)
assert.equal(pluginPackageChecks({ ...plugin, nodes: [{ ...plugin.nodes[0], tests: [] }] }, '0.1.0').passed, false)
assert.equal(Object.prototype.hasOwnProperty.call(portablePluginPackage(plugin), 'trustStatus'), false)
assert.equal(verifyPluginSignature({ manifestHash: hash }).status, 'unsigned')
console.log('plugin package tests: 8/8 passed')
