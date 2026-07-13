#!/usr/bin/env node

let prompt = ''
for await (const chunk of process.stdin) prompt += chunk

const taskId = /"taskId":\s*"([^"]+)"/.exec(prompt)?.[1] || ''

if (taskId === 'runner-timeout') {
  setInterval(() => {}, 1_000)
} else if (taskId === 'runner-timeout-ignore') {
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 1_000)
} else if (taskId === 'runner-malformed') {
  process.stdout.write('{malformed-json\n')
} else if (taskId === 'runner-auth') {
  process.stderr.write('Please run claude auth login\n')
  process.exitCode = 1
} else if (taskId === 'runner-capacity') {
  process.stderr.write('429 rate limit exceeded\n')
  process.exitCode = 1
} else {
  if (taskId === 'runner-bounded') process.stdout.write(`${'x'.repeat(20_000)}\n`)
  const model = taskId === 'runner-unapproved-model' ? 'claude-opus-4-6' : 'claude-fable-5'
  process.stdout.write(`${JSON.stringify({ type: 'system', model, session_id: `fixture-${taskId}` })}\n`)
  process.stdout.write(`${JSON.stringify({ type: 'result', result: { status: 'COMPLETED', summary: 'fixture completed', commitSha: null, filesChanged: [], tests: [{ command: 'fixture', status: 'PASSED', details: '' }], risks: [], assumptions: [], recommendedAction: 'INTEGRATE' } })}\n`)
}
