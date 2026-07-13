import crypto from 'node:crypto'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function parseAuthority(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw || /[\s/@\\]/.test(raw)) return null
  try {
    const url = new URL(`http://${raw}`)
    if (!LOOPBACK_NAMES.has(url.hostname) || (url.username || url.password)) return null
    return { hostname: url.hostname, port: url.port }
  } catch { return null }
}

function parseCookies(value) {
  return Object.fromEntries(String(value || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const index = item.indexOf('=')
    return index < 0 ? [item, ''] : [item.slice(0, index), item.slice(index + 1)]
  }))
}

function deny(res, code, message) {
  res.status(403).set('Cache-Control', 'no-store').json({ error: message, code })
}

export function createLocalRequestGuard({ port = 1717, allowedOrigins = [], sessionToken = crypto.randomBytes(32).toString('base64url') } = {}) {
  const expectedPort = String(port)
  const additionalOrigins = allowedOrigins.map(value => {
    const raw = String(value).replace(/\/$/, '')
    let parsed
    try { parsed = new URL(raw) } catch { throw new Error('additional local origin is invalid') }
    if (parsed.protocol !== 'http:' || !LOOPBACK_NAMES.has(parsed.hostname) || !parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('additional origins must be explicit loopback HTTP origins with a port')
    return parsed.origin
  })
  const origins = new Set([
    `http://localhost:${expectedPort}`,
    `http://127.0.0.1:${expectedPort}`,
    `http://[::1]:${expectedPort}`,
    ...additionalOrigins,
  ])
  const cookieName = 'acc_local_session'

  return function localRequestGuard(req, res, next) {
    const authority = parseAuthority(req.get('host'))
    if (!authority || authority.port !== expectedPort) return deny(res, 'LOCAL_HOST_REJECTED', 'request Host is not the configured loopback service')

    const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase()
    if (fetchSite === 'cross-site') return deny(res, 'CROSS_SITE_REQUEST_REJECTED', 'cross-site browser requests are not allowed')

    const origin = String(req.get('origin') || '').replace(/\/$/, '')
    if (origin && !origins.has(origin)) return deny(res, 'LOCAL_ORIGIN_REJECTED', 'request Origin is not an allowed local application origin')

    if (req.method === 'GET' || req.method === 'HEAD') {
      res.append('Set-Cookie', `${cookieName}=${sessionToken}; Path=/; HttpOnly; SameSite=Strict`)
    } else if (MUTATION_METHODS.has(req.method) && origin) {
      const cookies = parseCookies(req.get('cookie'))
      const supplied = Buffer.from(String(cookies[cookieName] || ''))
      const expected = Buffer.from(sessionToken)
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return deny(res, 'LOCAL_SESSION_REQUIRED', 'local browser session is missing or stale')
    }
    next()
  }
}

export function requireMutationIntent(expected) {
  return function mutationIntent(req, res, next) {
    if (String(req.get('x-command-center-intent') || '') !== expected) return res.status(400).set('Cache-Control', 'no-store').json({ error: `${expected} intent is required`, code: 'MUTATION_INTENT_REQUIRED' })
    next()
  }
}
