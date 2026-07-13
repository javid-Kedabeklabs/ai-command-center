import { normalizeSecretReferenceId } from '../secrets/keychain.js'

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i
const TOOL_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,159}$/i
const SECRET_KEY = /(authorization|cookie|token|secret|password|api[-_]?key|credential)/i
const VALUE_FIELDS = new Set(['default', 'example', 'examples', 'const'])

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const redactText = value => String(value || '')
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/ig, '$1 [redacted]')
  .replace(/\b(token|secret|password|api[-_]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]')

export function safeMcpId(value) {
  const id = String(value || '').trim()
  if (!ID_PATTERN.test(id)) throw new Error('MCP server id must use 1-80 letters, numbers, dots, underscores, or hyphens')
  return id
}

export function normalizeMcpCommand(value) {
  const parts = Array.isArray(value) ? value : String(value || '').trim().split(/\s+/)
  const command = parts.map(part => String(part)).filter(Boolean)
  if (!command.length || command.length > 64) throw new Error('local MCP command must contain 1-64 arguments')
  for (const part of command) {
    if (part.length > 2048 || /[\0\r\n]/.test(part)) throw new Error('local MCP command contains an invalid argument')
  }
  return command
}

export function normalizeMcpUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { throw new Error('remote MCP URL must be a valid http(s) URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('remote MCP URL must be http(s) and must not contain credentials')
  return url.toString()
}

function normalizeScopes(value) {
  if (!plain(value)) return {}
  const normalizeList = (list, label) => {
    if (!Array.isArray(list)) return undefined
    const result = [...new Set(list.map(String).map(item => item.trim()).filter(Boolean))].sort()
    if (result.some(item => !TOOL_PATTERN.test(item))) throw new Error(`${label} contains an invalid tool name`)
    return result.slice(0, 500)
  }
  return {
    ...value,
    ...(normalizeList(value.allowTools, 'allowTools') ? { allowTools: normalizeList(value.allowTools, 'allowTools') } : {}),
    ...(normalizeList(value.denyTools, 'denyTools') ? { denyTools: normalizeList(value.denyTools, 'denyTools') } : {}),
  }
}

export function normalizeMcpServer(idValue, value, { existing = false } = {}) {
  const id = safeMcpId(idValue)
  if (!plain(value)) throw new Error(`MCP server "${id}" must be an object`)
  const type = value.type === 'remote' || value.url ? 'remote' : value.type === 'local' || value.command ? 'local' : ''
  if (!type) throw new Error(`MCP server "${id}" must use local or remote transport`)
  const normalized = {
    ...value,
    id,
    type,
    ...(type === 'remote' ? { url: normalizeMcpUrl(value.url) } : { command: normalizeMcpCommand(value.command) }),
    scopes: normalizeScopes(value.scopes),
  }
  if (value.authRef != null && value.authRef !== '') {
    if (type !== 'remote') throw new Error('authRef is supported only for remote MCP servers')
    normalized.authRef = normalizeSecretReferenceId(value.authRef)
    normalized.authMode = value.authMode == null || value.authMode === 'bearer' ? 'bearer' : (() => { throw new Error('remote MCP authMode must be bearer') })()
  } else { delete normalized.authRef; delete normalized.authMode }
  if (type === 'remote') delete normalized.command
  else delete normalized.url
  if (existing) {
    normalized.enabled = value.enabled !== false
    normalized.trustStatus = value.trustStatus || (type === 'local' ? 'trusted-legacy' : 'configured')
    normalized.review = plain(value.review) ? value.review : { status: type === 'local' ? 'legacy' : 'not-required' }
  } else if (type === 'local') {
    normalized.enabled = false
    normalized.trustStatus = 'untrusted'
    normalized.review = { status: 'required' }
  } else {
    normalized.enabled = value.enabled !== false
    normalized.trustStatus = 'configured'
    normalized.review = { status: 'not-required' }
  }
  return normalized
}

export function migrateMcpRegistry(rawMcp) {
  if (!plain(rawMcp)) return { registry: {}, changed: rawMcp != null }
  const registry = {}
  let changed = false
  for (const [key, value] of Object.entries(rawMcp)) {
    assertNoInlineMcpCredentials(value)
    const normalized = normalizeMcpServer(key, value, { existing: true })
    registry[key] = normalized
    if (JSON.stringify(normalized) !== JSON.stringify(value)) changed = true
  }
  return { registry, changed }
}

export function assertNoInlineMcpCredentials(input) {
  const inspect = (value, path = '', depth = 0) => {
    if (depth > 16 || value == null) return
    if (Array.isArray(value)) return value.forEach((item, index) => inspect(item, `${path}[${index}]`, depth + 1))
    if (!plain(value)) return
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key
      if (['discoveredTools', 'discovery', 'review'].includes(key)) continue
      if ((key === 'env' && plain(child) && Object.keys(child).length) || (SECRET_KEY.test(key) && key !== 'authRef' && child != null && child !== '')) {
        throw new Error(`inline credentials or environment values are not allowed in MCP config (${nextPath}); use an opaque auth reference`)
      }
      inspect(child, nextPath, depth + 1)
    }
  }
  inspect(input)
  return true
}

export function createMcpServer(id, input) {
  assertNoInlineMcpCredentials(input)
  return normalizeMcpServer(id, input, { existing: false })
}

export function reviewMcpServer(server, { approved = false } = {}) {
  const normalized = normalizeMcpServer(server.id, server, { existing: true })
  if (normalized.type !== 'local') return normalized
  return {
    ...normalized,
    enabled: approved,
    trustStatus: approved ? 'trusted-local' : 'untrusted',
    review: { status: approved ? 'approved' : 'rejected', reviewedAt: Date.now() },
  }
}

export function assertMcpExecutable(server) {
  if (!server || server.enabled === false) throw new Error('MCP server is disabled')
  if (server.type === 'local' && !['trusted-local', 'trusted-legacy'].includes(server.trustStatus)) throw new Error('local MCP server requires explicit trust review before execution')
}

function list(value) { return Array.isArray(value) ? value.map(String) : null }
function policyDenies(policy, serverId, tool) {
  if (!plain(policy)) return false
  if (policy.tools === false || policy.mcp === false) return true
  if (list(policy.denyMcpServers)?.includes(serverId)) return true
  if (list(policy.denyMcpTools)?.some(item => item === tool || item === `${serverId}/${tool}`)) return true
  const servers = list(policy.mcpServers)
  if (servers && !servers.includes(serverId)) return true
  const tools = list(policy.mcpTools)
  if (tools && !tools.some(item => item === tool || item === `${serverId}/${tool}`)) return true
  return false
}

export function assertMcpToolAllowed(server, toolValue, policies = []) {
  const tool = String(toolValue || '').trim()
  if (!TOOL_PATTERN.test(tool)) throw new Error('MCP tool name is invalid')
  const allow = server.scopes?.allowTools
  const deny = server.scopes?.denyTools || []
  if (Array.isArray(allow) && !allow.includes(tool)) throw new Error(`MCP tool "${tool}" is outside the server allow scope`)
  if (deny.includes(tool) || policies.some(policy => policyDenies(policy, server.id, tool))) throw new Error(`MCP tool "${tool}" is denied by the effective permission scope`)
  const discovered = Array.isArray(server.discoveredTools) ? server.discoveredTools.find(item => item.name === tool) : null
  if (discovered?.enabled === false) throw new Error(`MCP tool "${tool}" is disabled`)
  return tool
}

function redactSchemaValue(value, key = '', secretContext = false, depth = 0) {
  if (depth > 16) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redactSchemaValue(item, key, secretContext, depth + 1))
  if (!plain(value)) {
    if (typeof value === 'string') return redactText(value).slice(0, 4000)
    return value
  }
  const result = {}
  for (const [childKey, childValue] of Object.entries(value).slice(0, 500)) {
    if (['__proto__', 'prototype', 'constructor'].includes(childKey)) continue
    const childSecret = secretContext || SECRET_KEY.test(key) || SECRET_KEY.test(childKey)
    if (childSecret && VALUE_FIELDS.has(childKey)) { result[childKey] = '[redacted]'; continue }
    result[childKey] = redactSchemaValue(childValue, childKey, childSecret, depth + 1)
  }
  return result
}

export function redactDiscoveredTools(tools, metadata = {}) {
  if (!Array.isArray(tools)) throw new Error('MCP tools/list returned no tools array')
  return tools.slice(0, 500).map(tool => {
    const name = String(tool?.name || '').trim()
    if (!TOOL_PATTERN.test(name)) throw new Error('MCP tools/list returned an invalid tool name')
    return {
      name,
      description: redactText(tool.description).slice(0, 2000),
      inputSchema: redactSchemaValue(plain(tool.inputSchema) ? tool.inputSchema : { type: 'object' }),
      enabled: tool.enabled !== false,
      provenance: {
        serverId: String(metadata.serverId || ''),
        serverName: String(metadata.serverName || '').slice(0, 200),
        serverVersion: String(metadata.serverVersion || '').slice(0, 100),
        transport: metadata.transport === 'remote' ? 'remote' : 'local',
        discoveredAt: Number(metadata.discoveredAt) || Date.now(),
      },
    }
  })
}

export function publicMcpServer(server) {
  return {
    id: server.id,
    key: server.id,
    name: server.name || server.id,
    desc: server.type === 'remote' ? server.url : server.command.join(' '),
    status: server.enabled === false ? (server.review?.status === 'required' ? 'review required' : 'disabled') : 'configured',
    mcp: true,
    type: server.type,
    trustStatus: server.trustStatus,
    reviewStatus: server.review?.status || null,
    scopes: server.scopes || {},
    discoveredTools: server.discoveredTools || [],
    authReference: server.authRef ? { id: server.authRef, mode: server.authMode || 'bearer' } : null,
  }
}

export function mcpEvidence({ serverId, tool, status, error, startedAt = Date.now(), endedAt = Date.now() }) {
  return {
    serverId: String(serverId).slice(0, 80),
    tool: String(tool).slice(0, 160),
    status: ['done', 'failed', 'cancelled', 'timed-out', 'denied'].includes(status) ? status : 'failed',
    ...(error ? { error: { code: String(error.code || 'MCP_ERROR').slice(0, 80), message: redactText(error.message || error).slice(0, 500) } } : {}),
    startedAt,
    endedAt,
  }
}
