import { normalizeSecretReferenceId } from './keychain.js'

const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i
const CREDENTIAL_QUERY = /^(access[-_]?token|api[-_]?key|auth|authorization|credential|password|secret|token)$/i

export function validateCredentialSafeHttpUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP node needs an http(s) URL')
  if (url.username || url.password) throw Object.assign(new Error('inline HTTP URL credentials are not allowed; use authRef'), { code: 'INLINE_CREDENTIAL_DENIED' })
  for (const [key, value] of url.searchParams) if (CREDENTIAL_QUERY.test(key) && value) throw Object.assign(new Error(`inline HTTP query credential "${key}" is not allowed; use authRef`), { code: 'INLINE_CREDENTIAL_DENIED' })
  return url.toString()
}

export function resolveBearerReference(rawReference, registry) {
  if (!registry) throw new Error('secret reference resolver is unavailable')
  const id = normalizeSecretReferenceId(rawReference)
  const value = registry.resolve(id)
  if (/\r|\n/.test(value)) throw Object.assign(new Error(`secret reference "${id}" contains invalid header characters`), { code: 'SECRET_REFERENCE_INVALID_VALUE' })
  return { id, value }
}

export function authorizedHttpHeaders(data, registry) {
  const source = data?.headers && typeof data.headers === 'object' && !Array.isArray(data.headers) ? data.headers : {}
  const headers = {}
  for (const [key, value] of Object.entries(source)) {
    if (CREDENTIAL_HEADER.test(key) && value != null && value !== '') throw Object.assign(new Error(`inline HTTP credential header "${key}" is not allowed; use authRef`), { code: 'INLINE_CREDENTIAL_DENIED' })
    headers[key] = String(value)
  }
  if (data?.authRef != null && data.authRef !== '') {
    if (data.authMode != null && data.authMode !== 'bearer') throw new Error('HTTP authMode must be bearer')
    const { value } = resolveBearerReference(data.authRef, registry)
    headers.authorization = `Bearer ${value}`
  }
  return headers
}

export function remoteMcpAuthOptions(config, registry) {
  if (!config?.authRef) return {}
  if (config.authMode != null && config.authMode !== 'bearer') throw new Error('remote MCP authMode must be bearer')
  return { bearerToken: resolveBearerReference(config.authRef, registry).value }
}
