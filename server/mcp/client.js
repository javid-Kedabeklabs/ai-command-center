import { spawn } from 'node:child_process'

const SAFE_ENV_KEYS = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SYSTEMROOT', 'WINDIR']
const safeMessage = value => String(value || '')
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/ig, '$1 [redacted]')
  .replace(/\b(token|secret|password|api[-_]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]')
  .slice(0, 500)

export class McpClientError extends Error {
  constructor(code, message, cause) { super(message, cause ? { cause } : undefined); this.name = 'McpClientError'; this.code = code }
}

export function minimalMcpEnvironment(source = process.env, additions = {}) {
  const env = {}
  for (const key of SAFE_ENV_KEYS) if (typeof source[key] === 'string' && source[key]) env[key] = source[key]
  for (const [key, value] of Object.entries(additions)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || /(TOKEN|SECRET|PASSWORD|API_KEY|AUTH|COOKIE)/i.test(key)) throw new McpClientError('MCP_ENV_DENIED', `MCP environment key "${key}" is not allowlisted`)
    env[key] = String(value)
  }
  return env
}

function payloadFromText(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) throw new McpClientError('MCP_MALFORMED_FRAME', 'MCP server returned an empty response')
  const sse = trimmed.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(value => value && value !== '[DONE]')
  const candidates = sse.length ? sse : [trimmed]
  for (let index = candidates.length - 1; index >= 0; index--) {
    try { return JSON.parse(candidates[index]) } catch {}
  }
  throw new McpClientError('MCP_MALFORMED_FRAME', 'MCP server returned malformed JSON-RPC')
}

function resultOrThrow(payload) {
  if (!payload || payload.jsonrpc !== '2.0') throw new McpClientError('MCP_MALFORMED_FRAME', 'MCP response is not valid JSON-RPC 2.0')
  if (payload.error) throw new McpClientError('MCP_REMOTE_ERROR', safeMessage(payload.error.message || 'MCP request failed'))
  return payload.result
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export async function requestRemoteMcp(config, method, params, { timeoutMs = 60000, signal, bearerToken } = {}) {
  if (bearerToken != null && (!String(bearerToken) || /\r|\n/.test(String(bearerToken)))) throw new McpClientError('MCP_AUTH_INVALID', 'MCP bearer credential is invalid')
  const call = async (body, session) => {
    let response
    try {
      response = await fetch(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}), ...(session ? { 'mcp-session-id': session } : {}) },
        body: JSON.stringify(body),
        signal: combinedSignal(signal, timeoutMs),
      })
    } catch (error) {
      if (signal?.aborted) throw new McpClientError('MCP_CANCELLED', 'MCP request was cancelled', error)
      if (error?.name === 'TimeoutError') throw new McpClientError('MCP_TIMEOUT', `MCP request timed out after ${timeoutMs}ms`, error)
      throw new McpClientError('MCP_TRANSPORT_ERROR', 'MCP remote transport failed', error)
    }
    const text = await response.text()
    if (!response.ok) throw new McpClientError('MCP_HTTP_ERROR', `MCP server returned HTTP ${response.status}`)
    return { payload: payloadFromText(text), session: response.headers.get('mcp-session-id') || session }
  }
  const initialized = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-command-center', version: '1.0.0' } } })
  const initResult = resultOrThrow(initialized.payload)
  await call({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, initialized.session)
  const response = await call({ jsonrpc: '2.0', id: 2, method, params }, initialized.session)
  return { result: resultOrThrow(response.payload), serverInfo: initResult?.serverInfo || {} }
}

export function requestLocalMcp(config, method, params, { timeoutMs = 60000, signal, run, nodeId, subprocessLimit = null, terminateProcess = proc => proc.kill() } = {}) {
  const execute = () => new Promise((resolve, reject) => {
    const command = config.command
    if (!Array.isArray(command) || !command.length) return reject(new McpClientError('MCP_CONFIG_ERROR', 'local MCP command is missing'))
    const proc = spawn(command[0], command.slice(1), {
      env: minimalMcpEnvironment(process.env, { COMMAND_CENTER_MCP: '1', COMMAND_CENTER_MCP_SERVER_ID: config.id }),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    proc.commandCenterProcessGroup = process.platform !== 'win32'
    if (run) { run.procs ||= new Set(); run.procs.add(proc) }
    let buffer = '', stderr = '', settled = false, initialized = false, serverInfo = {}
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      run?.procs?.delete(proc); terminateProcess(proc)
      error ? reject(error) : resolve(value)
    }
    const abort = () => finish(new McpClientError('MCP_CANCELLED', 'MCP request was cancelled'))
    const send = value => proc.stdin.write(JSON.stringify(value) + '\n')
    const handle = message => {
      if (!message || message.jsonrpc !== '2.0') return finish(new McpClientError('MCP_MALFORMED_FRAME', 'MCP server returned invalid JSON-RPC'))
      if (message.id === 1 && !initialized) {
        if (message.error) return finish(new McpClientError('MCP_REMOTE_ERROR', safeMessage(message.error.message || 'MCP initialize failed')))
        serverInfo = message.result?.serverInfo || {}
        initialized = true
        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
        send({ jsonrpc: '2.0', id: 2, method, params })
        return
      }
      if (message.id === 2) {
        if (message.error) finish(new McpClientError('MCP_REMOTE_ERROR', safeMessage(message.error.message || 'MCP tool failed')))
        else finish(null, { result: message.result, serverInfo })
      }
    }
    const parseLine = line => { try { handle(JSON.parse(line)) } catch { finish(new McpClientError('MCP_MALFORMED_FRAME', 'MCP server returned malformed JSON-RPC')) } }
    proc.stdout.on('data', chunk => {
      buffer += String(chunk)
      if (buffer.length > 4 * 1024 * 1024) return finish(new McpClientError('MCP_FRAME_TOO_LARGE', 'MCP response exceeded 4 MiB'))
      while (buffer.length && !settled) {
        const header = buffer.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/i)
        if (header) {
          const length = Number(header[1]), start = header[0].length
          if (length > 4 * 1024 * 1024) return finish(new McpClientError('MCP_FRAME_TOO_LARGE', 'MCP response exceeded 4 MiB'))
          if (buffer.length < start + length) break
          const body = buffer.slice(start, start + length); buffer = buffer.slice(start + length); parseLine(body); continue
        }
        const newline = buffer.indexOf('\n'); if (newline < 0) break
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); if (line) parseLine(line)
      }
    })
    proc.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000) })
    proc.on('error', error => finish(new McpClientError('MCP_SPAWN_ERROR', 'MCP local transport could not start', error)))
    proc.on('exit', code => { if (!settled) finish(new McpClientError('MCP_PROCESS_EXIT', stderr.trim() ? 'MCP local server exited with an error' : `MCP local server exited with code ${code}`)) })
    const timer = setTimeout(() => finish(new McpClientError('MCP_TIMEOUT', `MCP request timed out after ${timeoutMs}ms`)), timeoutMs); timer.unref()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-command-center', version: '1.0.0' } } })
  })
  return run?.resourceCoordinator ? run.resourceCoordinator.withResource('subprocess', { nodeId, limit: subprocessLimit }, execute) : execute()
}

export function normalizeMcpError(error) {
  if (error instanceof McpClientError) return error
  if (error?.name === 'AbortError') return new McpClientError('MCP_CANCELLED', 'MCP request was cancelled', error)
  return new McpClientError('MCP_ERROR', 'MCP request failed', error)
}
