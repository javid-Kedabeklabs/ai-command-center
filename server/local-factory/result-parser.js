import { redactSensitive } from '../collaboration/result-parser.js'
import { normalizeLocalFinding, verifyAndDeduplicateFindings } from './finding-verifier.js'

const STATUSES = new Set(['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED_SAFELY'])
const ACTIONS = new Set(['USE_AS_ADVICE', 'REQUEST_REVIEW', 'DISCARD', 'NEEDS_HUMAN_DECISION'])
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const stringArray = (value, label) => {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be an array of strings`)
  return value.map(item => item.slice(0, 4_000))
}

function extractJson(text) {
  const trimmed = String(text || '').trim()
  try { return JSON.parse(trimmed) } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return JSON.parse(fenced[1])
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
  throw new Error('local worker output did not contain JSON')
}

export function normalizeLocalFactoryResult(value) {
  if (!plainObject(value)) throw new Error('local factory result must be an object')
  const allowed = new Set(['status', 'summary', 'findings', 'proposedChanges', 'tests', 'risks', 'recommendedAction'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`unsupported local factory result field: ${key}`)
  if (!STATUSES.has(value.status)) throw new Error('local factory result status is invalid')
  if (typeof value.summary !== 'string' || !value.summary.trim()) throw new Error('local factory result requires a summary')
  if (!ACTIONS.has(value.recommendedAction)) throw new Error('local factory recommendedAction is invalid')
  if (!Array.isArray(value.findings) || value.findings.length > 100) throw new Error('findings must be an array of structured finding objects')
  const findings = value.findings.map(normalizeLocalFinding)
  const proposedChanges = stringArray(value.proposedChanges, 'proposedChanges')
  const tests = stringArray(value.tests, 'tests')
  const risks = stringArray(value.risks, 'risks')
  return {
    status: value.status,
    summary: value.summary.slice(0, 8_000),
    findings,
    proposedChanges,
    tests,
    risks,
    recommendedAction: value.recommendedAction,
  }
}

export function parseLocalFactoryResult(text, context = { documents: [] }) {
  const normalized = normalizeLocalFactoryResult(extractJson(text))
  const verified = verifyAndDeduplicateFindings(normalized.findings, context)
  return redactSensitive({ ...normalized, findings: verified.findings, findingVerification: verified.telemetry })
}
