export const RESULT_STATUSES = Object.freeze(['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED_SAFELY'])
export const RECOMMENDED_ACTIONS = Object.freeze(['INTEGRATE', 'REQUEST_CHANGES', 'DISCARD', 'NEEDS_HUMAN_DECISION'])

const SECRET_KEY = /(authorization|api.?key|token|secret|password|cookie|credential)/i
const SECRET_TEXT_PATTERNS = [
  /\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\bsk-(?:(?:ant|proj|svcacct)-)?[A-Za-z0-9_-]{12,}\b/g,
  /https?:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/g,
]
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const bounded = (value, max = 8_000) => String(value ?? '').slice(0, max)

export function redactSensitive(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return SECRET_TEXT_PATTERNS.reduce((text, pattern) => text.replace(pattern, match => {
      if (/^sk-/i.test(match)) return 'sk=[REDACTED]'
      if (/^https?:\/\//i.test(match)) return '[REDACTED_URL]'
      if (/^bearer\s/i.test(match)) return 'Bearer=[REDACTED]'
      const label = match.split(/[\s:=]/)[0]
      return `${label}=[REDACTED]`
    }), value)
  }
  if (Array.isArray(value)) return value.map(item => redactSensitive(item, seen))
  if (!plainObject(value)) return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  const result = {}
  for (const [key, item] of Object.entries(value)) result[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, seen)
  return result
}

export function classifyClaudeFailure(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(redactSensitive(input || {}))
  if (/not logged in|auth(?:entication)? (?:required|failed)|please (?:run )?claude auth login|unauthorized|invalid api key/i.test(text)) return 'AUTH_REQUIRED'
  if (/rate.?limit|too many requests|429|overloaded/i.test(text)) return 'RATE_LIMITED'
  if (/usage limit|quota (?:exceeded|reached)|credit balance|out of credits/i.test(text)) return 'USAGE_LIMIT_REACHED'
  if (/model .*?(?:unavailable|not found|not available)|unknown model|invalid model/i.test(text)) return 'MODEL_UNAVAILABLE'
  if (/permission denied|not permitted|tool .*?denied|approval required/i.test(text)) return 'PERMISSION_ERROR'
  if (/service unavailable|503|temporarily unavailable|connection (?:refused|failed)/i.test(text)) return 'SERVICE_UNAVAILABLE'
  return 'WORKER_FAILED'
}

export function parseClaudeStreamJson(raw) {
  if (typeof raw !== 'string') throw new Error('Claude event stream must be text')
  const events = [], malformed = []
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (!plainObject(event)) throw new Error('event is not an object')
      events.push(redactSensitive(event))
    } catch (error) {
      malformed.push({ line: index + 1, text: bounded(redactSensitive(line), 500), error: bounded(error.message, 160) })
    }
  }
  return { events, malformed, valid: malformed.length === 0, failureClass: classifyClaudeFailure(raw) }
}

const MODEL_KEY = /^(model|model_name|modelName|model_id|modelId)$/
const MODEL_VALUE = /^(?:claude[-_])?(?:fable(?:[-_][\w.-]+)?|sonnet(?:[-_][\w.-]+)?|opus(?:[-_][\w.-]+)?|haiku(?:[-_][\w.-]+)?)$/i

export function extractClaudeModelProvenance(events) {
  const reportedModels = new Set()
  const visit = (value, depth = 0) => {
    if (depth > 8 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 1_000)) visit(item, depth + 1)
      return
    }
    if (!plainObject(value)) return
    for (const [key, item] of Object.entries(value)) {
      if (MODEL_KEY.test(key) && typeof item === 'string' && MODEL_VALUE.test(item.trim())) reportedModels.add(item.trim())
      visit(item, depth + 1)
    }
  }
  visit(events)
  const models = [...reportedModels]
  return {
    reportedModels: models,
    actualModel: models.length === 1 ? models[0] : null,
    ambiguous: models.length > 1,
  }
}

export function assertClaudeModelPolicy({ requestedModel, fallbackModel = null, events, requirePrimary = fallbackModel == null }) {
  const provenance = extractClaudeModelProvenance(events)
  if (provenance.reportedModels.length === 0) {
    const error = new Error('Claude event stream did not report actual model provenance')
    error.code = 'MODEL_PROVENANCE_MISSING'
    error.provenance = provenance
    throw error
  }
  const normalize = value => String(value || '').toLowerCase().replace(/^claude[-_]/, '').split(/[-_]/)[0]
  const requested = normalize(requestedModel)
  const fallback = normalize(fallbackModel)
  const used = provenance.reportedModels.map(normalize)
  if (requirePrimary && used.some(model => model !== requested)) {
    const error = new Error(`Claude used a model outside the required primary policy: ${provenance.reportedModels.join(', ')}`)
    error.code = 'MODEL_FALLBACK_REJECTED'
    error.provenance = provenance
    throw error
  }
  if (used.some(model => model !== requested && model !== fallback)) {
    const error = new Error(`Claude reported an unapproved model: ${provenance.reportedModels.join(', ')}`)
    error.code = 'MODEL_PROVENANCE_UNAPPROVED'
    error.provenance = provenance
    throw error
  }
  return { ...provenance, requestedModel, fallbackModel, fallbackUsed: used.some(model => model !== requested) }
}

function textArray(value, label, max = 200) {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be an array of strings`)
  return value.map(item => bounded(item, 2_000))
}

export function normalizeClaudeResult(input, { requiresCommit = false } = {}) {
  if (!plainObject(input)) throw new Error('structured Claude result must be an object')
  if (!RESULT_STATUSES.includes(input.status)) throw new Error('structured result has invalid status')
  if (typeof input.summary !== 'string' || !input.summary.trim()) throw new Error('structured result requires a summary')
  if (!RECOMMENDED_ACTIONS.includes(input.recommendedAction)) throw new Error('structured result has invalid recommendedAction')
  if (input.commitSha != null && !/^[a-f0-9]{7,64}$/i.test(input.commitSha)) throw new Error('structured result has invalid commitSha')
  if (requiresCommit && input.status === 'COMPLETED' && !input.commitSha) throw new Error('completed modifying task is missing commitSha')
  const filesChanged = textArray(input.filesChanged, 'filesChanged')
  const risks = textArray(input.risks, 'risks')
  const assumptions = input.assumptions == null ? [] : textArray(input.assumptions, 'assumptions')
  if (!Array.isArray(input.tests) || input.tests.length > 100) throw new Error('tests must be an array')
  const tests = input.tests.map((test, index) => {
    if (!plainObject(test) || typeof test.command !== 'string' || !['PASSED', 'FAILED', 'NOT_RUN'].includes(test.status)) throw new Error(`tests[${index}] is invalid`)
    return { command: bounded(test.command, 1_000), status: test.status, details: bounded(test.details, 4_000) }
  })
  if (input.status === 'COMPLETED' && tests.some(test => test.status === 'FAILED')) throw new Error('completed result cannot contain failed tests')
  if (input.status === 'COMPLETED' && input.recommendedAction !== 'INTEGRATE') throw new Error('completed result must recommend integration')
  if (input.status !== 'COMPLETED' && input.recommendedAction === 'INTEGRATE') throw new Error('incomplete result cannot recommend integration')
  return redactSensitive({ status: input.status, summary: bounded(input.summary), commitSha: input.commitSha || null, filesChanged, tests, risks, assumptions, recommendedAction: input.recommendedAction })
}

function candidateFromEvent(event) {
  for (const candidate of [event?.structured_output, event?.structuredOutput, event?.result, event?.message?.structured_output]) {
    if (plainObject(candidate) && typeof candidate.status === 'string') return candidate
    if (typeof candidate === 'string') {
      try { const parsed = JSON.parse(candidate); if (plainObject(parsed) && parsed.status) return parsed } catch {}
    }
  }
  return null
}

export function extractNormalizedResult(raw, options) {
  const parsed = parseClaudeStreamJson(raw)
  for (let index = parsed.events.length - 1; index >= 0; index--) {
    const candidate = candidateFromEvent(parsed.events[index])
    if (candidate) return { ...parsed, result: normalizeClaudeResult(candidate, options) }
  }
  const error = new Error('Claude event stream did not contain a structured result')
  error.code = parsed.malformed.length ? 'MALFORMED_WORKER_OUTPUT' : classifyClaudeFailure(raw)
  error.parsed = parsed
  throw error
}

export const parseStreamJson = parseClaudeStreamJson
