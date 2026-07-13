export const CAPACITY_STATES = Object.freeze([
  'AVAILABLE', 'RATE_LIMITED', 'USAGE_LIMIT_REACHED', 'AUTH_REQUIRED',
  'SERVICE_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'DISABLED',
])
export const FALLBACK_ACTIONS = Object.freeze(['WAIT_FOR_PRIMARY', 'FALL_BACK', 'RETURN_TO_CODEX', 'MARK_BLOCKED'])

const boundedMessage = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500)

export function classifyCapacityError(error) {
  const message = `${error?.code || ''} ${error?.message || error || ''}`
  if (/auth_required|not logged in|authentication required|unauthorized|invalid api key|claude auth login/i.test(message)) return 'AUTH_REQUIRED'
  if (/usage_limit|quota exceeded|quota reached|usage limit|credit balance|out of credits/i.test(message)) return 'USAGE_LIMIT_REACHED'
  if (/rate_limit|too many requests|\b429\b|overloaded/i.test(message)) return 'RATE_LIMITED'
  if (/model_unavailable|model .*?(?:unavailable|not found|not available)|unknown model/i.test(message)) return 'MODEL_UNAVAILABLE'
  if (/service_unavailable|\b503\b|temporarily unavailable|connection (?:refused|failed)|network/i.test(message)) return 'SERVICE_UNAVAILABLE'
  return null
}

export function boundedBackoffMs(attempt, { baseMs = 5_000, maxMs = 300_000, jitterRatio = 0, random = Math.random } = {}) {
  const safeAttempt = Math.max(1, Math.min(20, Number.isInteger(attempt) ? attempt : 1))
  const boundedBase = Math.max(100, Math.min(60_000, Number(baseMs) || 5_000))
  const boundedMax = Math.max(boundedBase, Math.min(3_600_000, Number(maxMs) || 300_000))
  const delay = Math.min(boundedMax, boundedBase * (2 ** (safeAttempt - 1)))
  const ratio = Math.max(0, Math.min(0.5, Number(jitterRatio) || 0))
  return Math.round(Math.min(boundedMax, delay * (1 + ((random() * 2 - 1) * ratio))))
}

export function createCapacityState(now = Date.now()) {
  return {
    codex: { status: 'AVAILABLE', attempts: 0, retryAt: null, updatedAt: now, lastError: null },
    claude: { status: 'AVAILABLE', attempts: 0, retryAt: null, updatedAt: now, lastError: null },
  }
}

export function updateCapacityState(state, provider, error, { now = Date.now(), backoff = {} } = {}) {
  if (!['codex', 'claude'].includes(provider)) throw new Error('capacity provider must be codex or claude')
  const current = state?.[provider] || createCapacityState(now)[provider]
  const status = error == null ? 'AVAILABLE' : classifyCapacityError(error)
  if (error != null && !status) return { ...state, [provider]: { ...current, updatedAt: now, lastError: boundedMessage(error?.message || error) } }
  const attempts = status === 'AVAILABLE' ? 0 : Math.min(20, (Number(current.attempts) || 0) + 1)
  const retryable = ['RATE_LIMITED', 'SERVICE_UNAVAILABLE'].includes(status)
  return {
    ...state,
    [provider]: {
      status, attempts, updatedAt: now,
      retryAt: retryable ? now + boundedBackoffMs(attempts, backoff) : null,
      lastError: status === 'AVAILABLE' ? null : boundedMessage(error?.message || error),
    },
  }
}

export function resolveModelPolicy({ requestedModel, fallbackModel = null, capacityStatus, fallbackPolicy = 'WAIT_FOR_PRIMARY', attempts = 0, retryAt = null }) {
  if (!CAPACITY_STATES.includes(capacityStatus)) throw new Error('unknown capacity status')
  if (!FALLBACK_ACTIONS.includes(fallbackPolicy)) throw new Error('unknown fallback policy')
  let action = fallbackPolicy
  let actualModel = null
  if (capacityStatus === 'AVAILABLE') { action = 'USE_PRIMARY'; actualModel = requestedModel }
  else if (fallbackPolicy === 'FALL_BACK' && fallbackModel && ['MODEL_UNAVAILABLE', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'].includes(capacityStatus)) actualModel = fallbackModel
  else if (fallbackPolicy === 'FALL_BACK') action = 'MARK_BLOCKED'
  return {
    requestedModel, actualModel, capacityStatus, action,
    fallbackUsed: actualModel != null && actualModel !== requestedModel,
    fallbackReason: actualModel && actualModel !== requestedModel ? capacityStatus : null,
    attempts: Math.max(0, Number(attempts) || 0), retryAt,
  }
}

export const nextBackoffMs = boundedBackoffMs
