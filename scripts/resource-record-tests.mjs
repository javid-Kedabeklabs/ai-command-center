import assert from 'node:assert/strict'
import fs from 'node:fs'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node scripts/resource-record-tests.mjs <run-record.json> [...]')
  process.exit(2)
}

const resourceEventPattern = /(?:waiting for (?:model|subprocess|http|mcp) capacity|acquired (?:model|subprocess|http|mcp) capacity|released (?:model|subprocess|http|mcp) capacity|resource wait cancelled)/
const allowedEventKeys = new Set(['t', 'type', 'text', 'nodeId'])
const forbiddenResourceEventText = /authorization|bearer|api[-_ ]?key|secret|token|password|header|argument|payload/i

let passed = 0
console.log('== persisted resource records ==')

for (const file of files) {
  const run = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(!['running', 'paused'].includes(run.status), `${file}: run is not terminal`)

  for (const [kind, count] of Object.entries(run.resources?.active || {})) {
    assert.equal(count, 0, `${file}: active ${kind} leases remain`)
  }
  for (const [kind, count] of Object.entries(run.resources?.queued || {})) {
    assert.equal(count, 0, `${file}: queued ${kind} leases remain`)
  }
  assert.deepEqual(run.checkpoint?.activeLeases || [], [], `${file}: checkpoint retains active leases`)

  const resourceEvents = (run.events || []).filter(event => resourceEventPattern.test(String(event.text || '')))
  assert.ok(resourceEvents.length, `${file}: no resource events found`)
  for (const event of resourceEvents) {
    assert.deepEqual(Object.keys(event).filter(key => !allowedEventKeys.has(key)), [], `${file}: resource event contains an unexpected field`)
    assert.doesNotMatch(String(event.text || ''), forbiddenResourceEventText, `${file}: resource event text may contain secret-bearing data`)
  }

  passed++
  console.log(`PASS ${run.workflowId || run.id}: terminal leases and redacted events`)
}

console.log(`${passed}/${files.length} resource record tests passed`)
