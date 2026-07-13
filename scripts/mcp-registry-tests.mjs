import assert from 'node:assert/strict'
import path from 'node:path'
import {
  assertMcpExecutable,
  assertMcpToolAllowed,
  createMcpServer,
  mcpEvidence,
  migrateMcpRegistry,
  normalizeMcpServer,
  redactDiscoveredTools,
  reviewMcpServer,
} from '../server/mcp/registry.js'
import { minimalMcpEnvironment, normalizeMcpError, requestLocalMcp } from '../server/mcp/client.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
const fixture = path.resolve('scripts/fixtures/mcp-echo-server.mjs')
const local = { id: 'fixture-local', type: 'local', command: [process.execPath, fixture], enabled: true, trustStatus: 'trusted-local', review: { status: 'approved' }, scopes: {} }

console.log('== MCP registry and client security ==')

await test('legacy definitions migrate without losing safe unknown fields', () => {
  const source = { legacy: { type: 'local', command: ['node', 'server.js'], enabled: true, vendorExtension: { color: 'blue' } } }
  const { registry, changed } = migrateMcpRegistry(source)
  assert.equal(changed, true); assert.equal(registry.legacy.vendorExtension.color, 'blue'); assert.equal(registry.legacy.trustStatus, 'trusted-legacy'); assert.equal(registry.legacy.enabled, true)
})

await test('new local executables require review and cannot execute', () => {
  const server = createMcpServer('new-local', { type: 'local', command: ['node', 'server.js'] })
  assert.equal(server.enabled, false); assert.equal(server.trustStatus, 'untrusted'); assert.throws(() => assertMcpExecutable(server), /disabled/)
  const reviewed = reviewMcpServer(server, { approved: true }); assert.equal(reviewed.enabled, true); assert.doesNotThrow(() => assertMcpExecutable(reviewed))
})

await test('transport, id, URL, and command validation fail closed', () => {
  assert.throws(() => normalizeMcpServer('../bad', { type: 'local', command: ['node'] }), /id/)
  assert.throws(() => normalizeMcpServer('bad-url', { type: 'remote', url: 'file:///tmp/socket' }), /http/)
  assert.throws(() => normalizeMcpServer('credential-url', { type: 'remote', url: 'https://user:pass@example.com/mcp' }), /credentials/)
  assert.throws(() => normalizeMcpServer('bad-command', { type: 'local', command: ['node\nrm'] }), /invalid/)
  assert.throws(() => createMcpServer('inline-secret', { type: 'remote', url: 'https://example.com/mcp', headers: { authorization: 'Bearer raw' } }), /inline credentials/)
  assert.throws(() => createMcpServer('inline-env', { type: 'local', command: ['node'], env: { SAFE_LOOKING: 'value' } }), /environment values/)
})

await test('remote auth references are opaque and inline credential migration fails closed', () => {
  const server = createMcpServer('remote-auth', { type: 'remote', url: 'https://example.com/mcp', authRef: 'MCP.Example', authMode: 'bearer' })
  assert.equal(server.authRef, 'mcp.example'); assert.equal(server.authMode, 'bearer')
  assert.throws(() => createMcpServer('local-auth', { type: 'local', command: ['node'], authRef: 'mcp.example' }), /only for remote/)
  assert.throws(() => createMcpServer('bad-auth', { type: 'remote', url: 'https://example.com/mcp', authRef: '../escape' }), /secret reference/)
  assert.throws(() => migrateMcpRegistry({ legacy: { type: 'remote', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer raw' } } }), /inline credentials/)
})

await test('server and workflow tool allow scopes compose deny-wins', () => {
  const server = { ...local, scopes: { allowTools: ['echo'], denyTools: [] } }
  assert.equal(assertMcpToolAllowed(server, 'echo', [{ mcpServers: ['fixture-local'], mcpTools: ['fixture-local/echo'] }]), 'echo')
  assert.throws(() => assertMcpToolAllowed(server, 'environment'), /outside/)
  assert.throws(() => assertMcpToolAllowed(server, 'echo', [{ denyMcpTools: ['echo'] }]), /denied/)
})

await test('discovered schemas retain structure but redact secret defaults', () => {
  const tools = redactDiscoveredTools([{ name: 'login', description: 'authorization: Bearer-description-value', inputSchema: { type: 'object', properties: { apiKey: { type: 'string', default: 'raw-secret', examples: ['also-secret'] }, query: { type: 'string', default: 'safe', description: 'token=embedded-value' } } } }], { serverId: 'fixture-local', serverVersion: '1' })
  assert.equal(tools[0].inputSchema.properties.apiKey.default, '[redacted]')
  assert.equal(tools[0].inputSchema.properties.apiKey.examples, '[redacted]')
  assert.equal(tools[0].inputSchema.properties.query.default, 'safe')
  assert.equal(JSON.stringify(tools).includes('embedded-value'), false)
  assert.equal(JSON.stringify(tools).includes('Bearer-description-value'), false)
  assert.equal(tools[0].provenance.serverId, 'fixture-local')
})

await test('minimal stdio environment omits unrelated secret-like variables', async () => {
  process.env.COMMAND_CENTER_TEST_SECRET = 'must-not-leak'
  const response = await requestLocalMcp(local, 'tools/call', { name: 'environment', arguments: {} }, { timeoutMs: 2000 })
  assert.equal(response.result.structuredContent.leaked, null)
  assert.equal(response.result.structuredContent.keys.includes('COMMAND_CENTER_TEST_SECRET'), false)
  assert.throws(() => minimalMcpEnvironment(process.env, { EXTRA_API_KEY: 'nope' }), /not allowlisted/)
  delete process.env.COMMAND_CENTER_TEST_SECRET
})

await test('stdio timeout is normalized without child output', async () => {
  await assert.rejects(() => requestLocalMcp(local, 'tools/call', { name: 'delay', arguments: {} }, { timeoutMs: 40 }), error => error.code === 'MCP_TIMEOUT' && !error.message.includes('must-not-leak'))
})

await test('stdio cancellation terminates the request', async () => {
  const controller = new AbortController(); setTimeout(() => controller.abort(), 30)
  await assert.rejects(() => requestLocalMcp(local, 'tools/call', { name: 'delay', arguments: {} }, { timeoutMs: 2000, signal: controller.signal }), error => error.code === 'MCP_CANCELLED')
})

await test('remote bearer tokens are injected ephemerally and rejected on header injection', async () => {
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    requests.push(options)
    const input = JSON.parse(options.body)
    return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', ...(input.id ? { id: input.id } : {}), result: input.method === 'initialize' ? { serverInfo: { name: 'fixture' } } : input.method === 'tools/list' ? { tools: [] } : {} }), headers: { get: () => null } }
  }
  try {
    const { requestRemoteMcp } = await import('../server/mcp/client.js')
    await requestRemoteMcp({ url: 'https://example.com/mcp' }, 'tools/list', {}, { bearerToken: 'ephemeral-fixture' })
    assert(requests.every(request => request.headers.authorization === 'Bearer ephemeral-fixture'))
    await assert.rejects(() => requestRemoteMcp({ url: 'https://example.com/mcp' }, 'tools/list', {}, { bearerToken: 'bad\r\nheader: value' }), error => error.code === 'MCP_AUTH_INVALID')
  } finally { globalThis.fetch = originalFetch }
})

await test('malformed frames and remote errors use stable safe codes', async () => {
  await assert.rejects(() => requestLocalMcp(local, 'tools/call', { name: 'malformed', arguments: {} }, { timeoutMs: 1000 }), error => error.code === 'MCP_MALFORMED_FRAME')
  await assert.rejects(() => requestLocalMcp(local, 'tools/call', { name: 'remote-error', arguments: {} }, { timeoutMs: 1000 }), error => error.code === 'MCP_REMOTE_ERROR' && error.message === 'fixture rejected the call')
  assert.equal(normalizeMcpError(new Error('raw internal secret')).code, 'MCP_ERROR')
})

await test('call evidence is bounded metadata without arguments or output', () => {
  const evidence = mcpEvidence({ serverId: 'fixture-local', tool: 'echo', status: 'failed', error: Object.assign(new Error('token=abc123'), { code: 'MCP_REMOTE_ERROR' }) })
  assert.equal(JSON.stringify(evidence).includes('abc123'), false)
  assert.equal('arguments' in evidence, false); assert.equal('output' in evidence, false)
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
