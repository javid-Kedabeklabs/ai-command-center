const SENSITIVE_KEYS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'apikey', 'api-key', 'api_key',
  'password', 'passphrase', 'privatekey', 'private-key', 'private_key', 'clientsecret', 'client-secret',
  'client_secret', 'accesstoken', 'access-token', 'access_token', 'refreshtoken', 'refresh-token',
  'refresh_token', 'secretvalue', 'secret-value', 'secret_value',
])
const REDACTED = '[REDACTED]'

function redactString(input, secrets) {
  let value = String(input)
  for (const secret of secrets) if (secret.length >= 4) value = value.split(secret).join(REDACTED)
  value = value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, `$1 ${REDACTED}`)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, REDACTED)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
  return value
}

function secretVariants(secret) {
  const raw = String(secret)
  const variants = new Set([raw])
  try { variants.add(encodeURIComponent(raw)) } catch {}
  variants.add(JSON.stringify(raw).slice(1, -1))
  variants.add(Buffer.from(raw, 'utf8').toString('base64'))
  variants.add(Buffer.from(raw, 'utf8').toString('base64url'))
  variants.add(Buffer.from(raw, 'utf8').toString('hex'))
  return [...variants].filter(value => value.length >= 4)
}

export function createRedactor({ secretValues = new Set() } = {}) {
  const secrets = () => [...new Set([...secretValues].flatMap(secretVariants))].sort((a, b) => b.length - a.length)
  function redact(input) {
    const known = secrets(), seen = new WeakMap(), active = new WeakSet()
    const visit = value => {
      if (typeof value === 'string') return redactString(value, known)
      if (value == null || typeof value !== 'object') return value
      if (Buffer.isBuffer(value)) return REDACTED
      if (active.has(value)) return '[CIRCULAR]'
      if (seen.has(value)) return seen.get(value)
      const output = Array.isArray(value) ? [] : {}
      seen.set(value, output)
      active.add(value)
      if (Array.isArray(value)) for (const item of value) output.push(visit(item))
      else for (const [key, item] of Object.entries(value)) output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : visit(item)
      active.delete(value)
      return output
    }
    return visit(input)
  }
  return { redact, redactedValue: REDACTED }
}
