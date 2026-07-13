import crypto from 'node:crypto'

export const SCHEDULE_STATE_VERSION = 1
export const MAX_CATCH_UP = 100
const FIELD_SPECS = [
  ['minute', 0, 59], ['hour', 0, 23], ['day-of-month', 1, 31],
  ['month', 1, 12], ['day-of-week', 0, 6],
]

const integer = value => /^\d+$/.test(String(value)) ? Number(value) : NaN

function parseAtom(text, min, max, label) {
  const value = integer(text)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} value must be ${min}-${max}`)
  return value
}

function parseField(text, label, min, max) {
  if (!text || /[^0-9*,\/-]/.test(text)) throw new Error(`${label} contains unsupported syntax`)
  const values = new Set()
  for (const item of text.split(',')) {
    if (!item) throw new Error(`${label} contains an empty list item`)
    const pieces = item.split('/')
    if (pieces.length > 2) throw new Error(`${label} has an invalid step`)
    const step = pieces.length === 2 ? integer(pieces[1]) : 1
    if (!Number.isInteger(step) || step <= 0 || step > max - min + 1) throw new Error(`${label} step must be 1-${max - min + 1}`)
    const base = pieces[0]
    let start, end
    if (base === '*') { start = min; end = max }
    else if (base.includes('-')) {
      const range = base.split('-')
      if (range.length !== 2) throw new Error(`${label} has an invalid range`)
      start = parseAtom(range[0], min, max, label); end = parseAtom(range[1], min, max, label)
      if (start > end) throw new Error(`${label} range start must not exceed its end`)
    } else {
      start = parseAtom(base, min, max, label)
      end = pieces.length === 2 ? max : start
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return { values, wildcard: text === '*' || text.startsWith('*/'), source: text }
}

export function parseCron(expression) {
  const source = String(expression || '').trim()
  const parts = source.split(/\s+/)
  if (parts.length !== 5) throw new Error('cron must contain exactly five fields: minute hour day-of-month month day-of-week')
  return { source, fields: parts.map((part, index) => parseField(part, ...FIELD_SPECS[index])) }
}

export function validateTimezone(timezone) {
  const value = String(timezone || 'UTC')
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
    if (!resolved) throw new Error('timezone unavailable')
    return value
  } catch { throw new Error(`timezone must be a valid IANA timezone name: ${value}`) }
}

const formatterCache = new Map()
function formatter(timezone) {
  if (!formatterCache.has(timezone)) formatterCache.set(timezone, new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }))
  return formatterCache.get(timezone)
}

function localParts(instant, timezone) {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { minute: Number(parts.minute), hour: Number(parts.hour), day: Number(parts.day), month: Number(parts.month), weekday: weekdays[parts.weekday] }
}

export function cronMatches(parsedOrExpression, instant, timezone = 'UTC') {
  const parsed = typeof parsedOrExpression === 'string' ? parseCron(parsedOrExpression) : parsedOrExpression
  const zone = validateTimezone(timezone), local = localParts(instant instanceof Date ? instant.getTime() : Number(instant), zone)
  const [minute, hour, day, month, weekday] = parsed.fields
  const dayMatches = day.values.has(local.day), weekdayMatches = weekday.values.has(local.weekday)
  const calendarDayMatches = day.wildcard && weekday.wildcard ? true : day.wildcard ? weekdayMatches : weekday.wildcard ? dayMatches : dayMatches || weekdayMatches
  return minute.values.has(local.minute) && hour.values.has(local.hour) && month.values.has(local.month) && calendarDayMatches
}

export function normalizeScheduleConfig(trigger, { strict = true } = {}) {
  if (!['interval', 'cron'].includes(trigger?.type)) return { ...(trigger?.config || {}) }
  const config = { ...(trigger.config || {}) }
  config.timezone = validateTimezone(config.timezone || 'UTC')
  config.misfirePolicy = config.misfirePolicy || 'skip'
  config.overlapPolicy = config.overlapPolicy || 'skip'
  config.maxCatchUp = config.maxCatchUp == null ? 1 : Number(config.maxCatchUp)
  if (!['skip', 'fire-once'].includes(config.misfirePolicy)) throw new Error('misfirePolicy must be skip or fire-once')
  if (!['skip', 'queue-one', 'allow'].includes(config.overlapPolicy)) throw new Error('overlapPolicy must be skip, queue-one, or allow')
  if (!Number.isInteger(config.maxCatchUp) || config.maxCatchUp < 1 || config.maxCatchUp > MAX_CATCH_UP) throw new Error(`maxCatchUp must be an integer from 1-${MAX_CATCH_UP}`)
  if (trigger.type === 'interval') {
    config.intervalMs = Number(config.intervalMs == null ? 60000 : config.intervalMs)
    if (!Number.isInteger(config.intervalMs) || config.intervalMs < 1000 || config.intervalMs > 86400000) throw new Error('intervalMs must be an integer from 1000-86400000')
  } else parseCron(config.cron)
  return config
}

export function scheduleDefinitionHash(trigger) {
  const config = normalizeScheduleConfig(trigger)
  const canonical = trigger.type === 'interval'
    ? { type: trigger.type, intervalMs: config.intervalMs, timezone: config.timezone, misfirePolicy: config.misfirePolicy, overlapPolicy: config.overlapPolicy, maxCatchUp: config.maxCatchUp }
    : { type: trigger.type, cron: parseCron(config.cron).source, timezone: config.timezone, misfirePolicy: config.misfirePolicy, overlapPolicy: config.overlapPolicy, maxCatchUp: config.maxCatchUp }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function scheduleDeliveryKey(triggerId, definitionHash, intendedAt) {
  return crypto.createHash('sha256').update(`${triggerId}\0${definitionHash}\0${Number(intendedAt)}`).digest('hex')
}

export function nextScheduledInstant(trigger, after) {
  const config = normalizeScheduleConfig(trigger), cursor = Number(after)
  if (trigger.type === 'interval') {
    const anchor = Number(trigger.createdAt) || 0
    return anchor + (Math.floor((Math.max(cursor, anchor) - anchor) / config.intervalMs) + 1) * config.intervalMs
  }
  const parsed = parseCron(config.cron), start = Math.floor(cursor / 60000) * 60000 + 60000
  const limit = start + 2 * 366 * 24 * 60 * 60000
  for (let instant = start; instant <= limit; instant += 60000) if (cronMatches(parsed, instant, config.timezone)) return instant
  throw new Error('cron has no firing instant within the next two years')
}

export function previousScheduledInstant(trigger, atOrBefore) {
  const config = normalizeScheduleConfig(trigger), cursor = Number(atOrBefore)
  if (trigger.type === 'interval') {
    const anchor = Number(trigger.createdAt) || 0
    if (cursor < anchor) return null
    return anchor + Math.floor((cursor - anchor) / config.intervalMs) * config.intervalMs
  }
  const parsed = parseCron(config.cron), start = Math.floor(cursor / 60000) * 60000, limit = start - 2 * 366 * 24 * 60 * 60000
  for (let instant = start; instant >= limit; instant -= 60000) if (cronMatches(parsed, instant, config.timezone)) return instant
  return null
}

export function initialScheduleState(trigger, now) {
  const definitionHash = scheduleDefinitionHash(trigger)
  return { version: SCHEDULE_STATE_VERSION, scheduleDefinitionHash: definitionHash, lastEvaluatedAt: Number(now), lastScheduledFor: null, nextFireAt: nextScheduledInstant(trigger, Number(now)), queuedAt: null, lastSuppressionReason: null }
}

export function normalizeScheduleState(value, trigger, now) {
  const expectedHash = scheduleDefinitionHash(trigger)
  if (!value || value.version !== SCHEDULE_STATE_VERSION || value.scheduleDefinitionHash !== expectedHash) return initialScheduleState(trigger, now)
  const numeric = key => value[key] == null ? null : Number(value[key])
  const state = { version: SCHEDULE_STATE_VERSION, scheduleDefinitionHash: expectedHash, lastEvaluatedAt: numeric('lastEvaluatedAt'), lastScheduledFor: numeric('lastScheduledFor'), nextFireAt: numeric('nextFireAt'), queuedAt: numeric('queuedAt'), lastSuppressionReason: value.lastSuppressionReason == null ? null : String(value.lastSuppressionReason).slice(0, 120) }
  if (!Number.isFinite(state.lastEvaluatedAt) || !Number.isFinite(state.nextFireAt) || (state.lastScheduledFor != null && !Number.isFinite(state.lastScheduledFor)) || (state.queuedAt != null && !Number.isFinite(state.queuedAt))) throw Object.assign(new Error('schedule cursor is corrupt'), { code: 'TRIGGER_STORE_CORRUPT' })
  return state
}

export function evaluateSchedule(trigger, priorState, now) {
  const config = normalizeScheduleConfig(trigger), state = normalizeScheduleState(priorState, trigger, now), due = []
  let cursor = state.nextFireAt
  while (cursor <= now && due.length <= config.maxCatchUp) { due.push(cursor); cursor = nextScheduledInstant(trigger, cursor) }
  const overflow = due.length > config.maxCatchUp
  let bounded = due.slice(0, config.maxCatchUp)
  if (overflow) {
    const latest = previousScheduledInstant(trigger, now)
    if (latest != null && !bounded.includes(latest)) bounded = [...bounded.slice(0, Math.max(0, config.maxCatchUp - 1)), latest]
    cursor = nextScheduledInstant(trigger, now)
  }
  let eligible = bounded, suppressed = []
  if (due.length > 1 || overflow) {
    if (config.misfirePolicy === 'skip') { suppressed = bounded; eligible = [] }
    else { eligible = bounded.length ? [bounded[bounded.length - 1]] : []; suppressed = bounded.slice(0, -1) }
  }
  return {
    state: { ...state, lastEvaluatedAt: Number(now), lastScheduledFor: bounded.length ? bounded[bounded.length - 1] : state.lastScheduledFor, nextFireAt: cursor, lastSuppressionReason: suppressed.length || overflow ? `misfire-${config.misfirePolicy}${overflow ? '-bounded' : ''}` : null },
    eligible, suppressed, overflow,
  }
}

export const scheduleSemantics = Object.freeze({
  timezoneDefault: 'UTC',
  dayRule: 'When both day-of-month and day-of-week are restricted, either field may match.',
  dstRule: 'Nonexistent local minutes do not fire; repeated local minutes fire once per distinct UTC instant.',
})
