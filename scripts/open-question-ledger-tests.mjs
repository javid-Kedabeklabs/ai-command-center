import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseOpenQuestionLedger } from '../server/collaboration/open-question-ledger.js'

const source = fs.readFileSync(new URL('../docs/OPEN_QUESTIONS.md', import.meta.url), 'utf8')
const parsed = parseOpenQuestionLedger(source)
const entries = source.split(/^## /m).slice(1).map(section => {
  const [heading, ...lines] = section.split('\n'), match = heading.match(/^(Q-\d{4}) — (.+)$/)
  assert(match, `invalid question heading: ${heading}`)
  return [section, match[1], match[2], lines.join('\n')]
})
assert(entries.length > 0, 'ledger must contain at least one stable question')
assert.equal(new Set(entries.map(match => match[1])).size, entries.length, 'question IDs must be unique')

const allowed = new Set(['OPEN', 'ANSWERED', 'CLOSED', 'SUPERSEDED'])
for (const [, id, title, body] of entries) {
  assert(title.trim(), `${id} needs a title`)
  const field = name => body.match(new RegExp(`^- ${name}: (.+)$`, 'm'))?.[1]?.trim()
  const state = field('Status')
  assert(allowed.has(state), `${id} has an unsupported state`)
  for (const required of ['Opened', 'Last reviewed', 'Owner', 'Question', 'Why it matters', 'Current evidence', 'Next evidence needed', 'Resolution evidence']) assert(field(required), `${id} is missing ${required}`)
  if (state === 'OPEN') assert.match(field('Resolution evidence'), /^Pending(?:\.|\s)/, `${id} cannot claim resolution evidence while open`)
  if (state === 'ANSWERED' || state === 'CLOSED') assert.doesNotMatch(field('Resolution evidence'), /^Pending(?:\.|\s)/, `${id} requires resolution evidence`)
  if (state === 'SUPERSEDED') assert.match(field('Resolution evidence'), /Q-\d{4}|decision/i, `${id} must identify its replacement or decision`)
}

console.log(`open-question ledger tests: ${entries.length}/${entries.length} entries valid`)
assert.equal(parsed.questions.length, entries.length)
assert.equal(parsed.counts.OPEN, parsed.questions.filter(item => item.status === 'OPEN').length)
assert.throws(() => parseOpenQuestionLedger(source.replace('- Status: CLOSED', '- Status: UNKNOWN')), error => error.code === 'OPEN_QUESTION_LEDGER_INVALID')
assert.throws(() => parseOpenQuestionLedger(source.replace('## Q-0002', '## Q-0001')), error => error.code === 'OPEN_QUESTION_LEDGER_INVALID')
console.log('open-question parser rejects invalid state and duplicate identity')
