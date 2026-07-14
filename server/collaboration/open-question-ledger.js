import fs from 'node:fs'

export const OPEN_QUESTION_STATES = Object.freeze(['OPEN', 'ANSWERED', 'CLOSED', 'SUPERSEDED'])
const REQUIRED_FIELDS = Object.freeze(['Status', 'Opened', 'Last reviewed', 'Owner', 'Question', 'Why it matters', 'Current evidence', 'Next evidence needed', 'Resolution evidence'])
const allowedStates = new Set(OPEN_QUESTION_STATES)

const fail = message => Object.assign(new Error(`open-question ledger is invalid: ${message}`), { code: 'OPEN_QUESTION_LEDGER_INVALID' })

export function parseOpenQuestionLedger(source) {
  if (typeof source !== 'string' || source.length > 1_000_000) throw fail('source must be bounded text')
  const sections = source.split(/^## /m).slice(1)
  if (!sections.length) throw fail('at least one question is required')
  const ids = new Set()
  const questions = sections.map(section => {
    const [heading, ...lines] = section.split('\n'), match = heading.match(/^(Q-\d{4}) — (.{1,200})$/)
    if (!match) throw fail(`invalid question heading: ${heading.slice(0, 200)}`)
    const [, id, title] = match
    if (ids.has(id)) throw fail(`duplicate question id: ${id}`)
    ids.add(id)
    const body = lines.join('\n')
    const field = name => body.match(new RegExp(`^- ${name}: (.+)$`, 'm'))?.[1]?.trim()
    const values = Object.fromEntries(REQUIRED_FIELDS.map(name => [name, field(name)]))
    for (const name of REQUIRED_FIELDS) if (!values[name] || values[name].length > 4_000) throw fail(`${id} is missing or exceeds ${name}`)
    if (!allowedStates.has(values.Status)) throw fail(`${id} has an unsupported state`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.Opened) || !/^\d{4}-\d{2}-\d{2}$/.test(values['Last reviewed'])) throw fail(`${id} has an invalid review date`)
    if (values.Status === 'OPEN' && !/^Pending(?:\.|\s)/.test(values['Resolution evidence'])) throw fail(`${id} cannot claim resolution while open`)
    if ((values.Status === 'ANSWERED' || values.Status === 'CLOSED') && /^Pending(?:\.|\s)/.test(values['Resolution evidence'])) throw fail(`${id} requires resolution evidence`)
    if (values.Status === 'SUPERSEDED' && !/Q-\d{4}|decision/i.test(values['Resolution evidence'])) throw fail(`${id} must identify its replacement or decision`)
    return Object.freeze({ id, title, status: values.Status, opened: values.Opened, lastReviewed: values['Last reviewed'], owner: values.Owner, question: values.Question, whyItMatters: values['Why it matters'], currentEvidence: values['Current evidence'], nextEvidenceNeeded: values['Next evidence needed'], resolutionEvidence: values['Resolution evidence'] })
  })
  const counts = Object.fromEntries(OPEN_QUESTION_STATES.map(state => [state, questions.filter(item => item.status === state).length]))
  return Object.freeze({ schemaVersion: 1, counts: Object.freeze(counts), questions: Object.freeze(questions) })
}

export function readOpenQuestionLedger(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail('ledger path must be a regular non-symlink file')
  return parseOpenQuestionLedger(fs.readFileSync(file, 'utf8'))
}
