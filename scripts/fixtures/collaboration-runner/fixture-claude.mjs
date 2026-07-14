#!/usr/bin/env node

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

if (process.argv.includes('--version')) { process.stdout.write('2.1.207 (fixture)\n'); process.exit(0) }
if (process.argv.includes('--help')) { process.stdout.write('--print --model fable --fallback-model --effort --permission-mode --output-format stream-json --verbose --json-schema --allowedTools --disallowedTools --setting-sources --strict-mcp-config --mcp-config\n'); process.exit(0) }

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
  let commitSha = null, filesChanged = []
  if (taskId === 'dispatcher-implementation') {
    fs.mkdirSync('web/src/components/Pilot', { recursive: true })
    fs.writeFileSync('web/src/components/Pilot/fixture.txt', 'verified Fable fixture\n')
    execFileSync('git', ['add', '--', 'web/src/components/Pilot/fixture.txt'])
    execFileSync('git', ['commit', '-qm', 'fixture Fable implementation'])
    commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    filesChanged = ['web/src/components/Pilot/fixture.txt']
  }
  if (taskId === 'runner-bounded') process.stdout.write(`${'x'.repeat(20_000)}\n`)
  const model = taskId === 'runner-unapproved-model' ? 'claude-opus-4-6' : 'claude-fable-5'
  process.stdout.write(`${JSON.stringify({ type: 'system', model, session_id: `fixture-${taskId}` })}\n`)
  process.stdout.write(`${JSON.stringify({ type: 'result', result: { status: 'COMPLETED', summary: 'fixture completed', commitSha, filesChanged, tests: [{ command: 'fixture', status: 'PASSED', details: '' }], risks: [], assumptions: [], recommendedAction: 'INTEGRATE' } })}\n`)
}
