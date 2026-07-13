import assert from 'node:assert/strict'
import { minimalProviderEnvironment } from '../server/secrets/provider-env.js'

const source = { HOME: '/tmp/home', PATH: '/bin', LANG: 'en_US.UTF-8', COMMAND_CENTER_TEST_SECRET: 'must-not-leak', AWS_SECRET_ACCESS_KEY: 'must-not-leak-either', NODE_OPTIONS: '--require /tmp/hostile.js' }
const env = minimalProviderEnvironment(source, { openai: 'openai-fixture', anthropic: 'anthropic-fixture' })
assert.deepEqual(env, { HOME: '/tmp/home', PATH: '/bin', LANG: 'en_US.UTF-8', OPENAI_API_KEY: 'openai-fixture', ANTHROPIC_API_KEY: 'anthropic-fixture' })
assert.equal(JSON.stringify(env).includes('must-not-leak'), false)
assert.equal('NODE_OPTIONS' in env, false)
console.log('== provider execution environment ==')
console.log('  PASS  provider children receive only execution essentials and selected credentials')
console.log('\n== RESULT: 1 passed, 0 failed ==')
