import crypto from 'node:crypto'
import { validateLocalFactoryPath } from './task-schema.js'

const CATEGORIES = new Set(['CORRECTNESS', 'SECURITY', 'RELIABILITY', 'PERFORMANCE', 'TESTING', 'MAINTAINABILITY', 'DOCUMENTATION', 'ARCHITECTURE'])
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const bounded = (value, label, min, max) => {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`${label} must contain between ${min} and ${max} characters`)
  return value
}

export function normalizeLocalFinding(input) {
  if (!plain(input)) throw new Error('finding must be an object')
  const allowed = new Set(['category', 'severity', 'confidence', 'file', 'startLine', 'endLine', 'symbol', 'quote', 'claim', 'validation'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`unsupported finding field: ${key}`)
  if (!CATEGORIES.has(input.category)) throw new Error('finding category is invalid')
  if (!SEVERITIES.has(input.severity)) throw new Error('finding severity is invalid')
  if (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) throw new Error('finding confidence must be between 0 and 1')
  const file = validateLocalFactoryPath(input.file, 'finding file')
  if (!Number.isInteger(input.startLine) || !Number.isInteger(input.endLine) || input.startLine < 1 || input.endLine < input.startLine || input.endLine - input.startLine > 20) throw new Error('finding line range is invalid')
  if (input.symbol !== null && input.symbol !== undefined && (typeof input.symbol !== 'string' || input.symbol.length > 300)) throw new Error('finding symbol is invalid')
  return Object.freeze({ category: input.category, severity: input.severity, confidence: input.confidence, file, startLine: input.startLine, endLine: input.endLine, symbol: input.symbol || null, quote: bounded(input.quote, 'finding quote', 3, 2_000), claim: bounded(input.claim, 'finding claim', 1, 4_000), validation: bounded(input.validation, 'finding validation', 1, 2_000) })
}

export function verifyAndDeduplicateFindings(findings, context) {
  const documents = new Map((context?.documents || []).map(document => [document.path, document]))
  const accepted = new Map(), rejected = [], reasons = {}
  for (const [index, raw] of findings.entries()) {
    const finding = normalizeLocalFinding(raw), document = documents.get(finding.file)
    let reason = null
    if (!document) reason = 'FILE_NOT_IN_CONTEXT'
    else {
      const lines = String(document.content).replace(/\r\n/g, '\n').split('\n')
      if (finding.endLine > lines.length) reason = 'RANGE_INVALID'
      else if (!lines.slice(finding.startLine - 1, finding.endLine).join('\n').includes(finding.quote.replace(/\r\n/g, '\n'))) reason = 'QUOTE_NOT_FOUND_IN_RANGE'
    }
    if (reason) {
      reasons[reason] = Number(reasons[reason] || 0) + 1
      rejected.push({ index, reason })
      continue
    }
    const fingerprint = crypto.createHash('sha256').update([finding.category, finding.file, finding.startLine, finding.endLine, finding.quote].join('\0')).digest('hex')
    const previous = accepted.get(fingerprint)
    const candidate = { ...finding, fingerprint, duplicateCount: Number(previous?.duplicateCount || 0) + 1 }
    if (!previous || finding.confidence > previous.confidence) accepted.set(fingerprint, candidate)
    else accepted.set(fingerprint, { ...previous, duplicateCount: candidate.duplicateCount })
  }
  return { findings: [...accepted.values()], telemetry: { submitted: findings.length, accepted: accepted.size, rejected: rejected.length, duplicates: findings.length - rejected.length - accepted.size, rejectionReasons: reasons } }
}

export const LOCAL_FINDING_CATEGORIES = Object.freeze([...CATEGORIES])
export const LOCAL_FINDING_SEVERITIES = Object.freeze([...SEVERITIES])
