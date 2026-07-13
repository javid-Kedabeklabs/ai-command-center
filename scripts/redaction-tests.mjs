import assert from 'node:assert/strict'
import { createRedactor } from '../server/security/redaction.js'

const canary = 'fixture-secret-canary-4f952a', secrets = new Set([canary]), { redact } = createRedactor({ secretValues: secrets })
const input = {
  authorization: `Bearer ${canary}`,
  safeReference: 'keychain.reference.id',
  nested: { output: `prefix ${canary} suffix`, cookie: 'session=private', url: `http://localhost/?token=${canary}` },
  events: [{ text: `api_key=${canary}` }],
}
const output = redact(input), serialized = JSON.stringify(output)
assert.equal(input.nested.output, `prefix ${canary} suffix`)
assert.equal(output.safeReference, 'keychain.reference.id')
assert.equal(output.authorization, '[REDACTED]')
assert.equal(output.nested.cookie, '[REDACTED]')
assert.ok(!serialized.includes(canary))
assert.ok(serialized.includes('[REDACTED]'))
for (const encoded of [encodeURIComponent(canary), Buffer.from(canary).toString('base64'), Buffer.from(canary).toString('base64url'), Buffer.from(canary).toString('hex')]) {
  assert.ok(!JSON.stringify(redact({ value: `before:${encoded}:after` })).includes(encoded))
}
assert.doesNotThrow(() => { const cycle = {}; cycle.self = cycle; redact(cycle) })
const shared = { approvalId: 'approval-safe' }, repeated = redact({ nested: shared, lifecycle: shared })
assert.equal(repeated.lifecycle.approvalId, 'approval-safe')
console.log('redaction tests: 11/11 passed')
