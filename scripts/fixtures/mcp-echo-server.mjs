import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize' && message.id != null) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'command-center-fixture', version: '1.0.0' } } }) + '\n')
  } else if (message.method === 'tools/list' && message.id != null) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'echo', description: 'Return the supplied arguments', inputSchema: { type: 'object' } },
      { name: 'environment', description: 'Return environment key names for isolation tests', inputSchema: { type: 'object' } },
      { name: 'delay', description: 'Never resolve, for timeout and cancellation tests', inputSchema: { type: 'object' } },
      { name: 'remote-error', description: 'Return a deterministic JSON-RPC error', inputSchema: { type: 'object' } },
      { name: 'malformed', description: 'Return a malformed frame', inputSchema: { type: 'object' } },
    ] } }) + '\n')
  } else if (message.method === 'tools/call' && message.id != null) {
    const tool = message.params?.name
    if (tool === 'delay') return
    if (tool === 'malformed') return process.stdout.write('{not-json}\n')
    if (tool === 'remote-error') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'fixture rejected the call' } }) + '\n')
    const value = tool === 'environment'
      ? { keys: Object.keys(process.env).sort(), leaked: process.env.COMMAND_CENTER_TEST_SECRET || null }
      : (message.params?.arguments || {})
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value } }) + '\n')
  }
})
