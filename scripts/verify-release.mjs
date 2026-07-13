import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

const startedAt = Date.now()
const gates = [
  ['checkpoint transitions', process.execPath, ['scripts/checkpoint-state-tests.mjs']],
  ['run control transitions', process.execPath, ['scripts/run-control-tests.mjs']],
  ['subworkflow receipt identity', process.execPath, ['scripts/subworkflow-receipt-tests.mjs']],
  ['redaction transforms', process.execPath, ['scripts/redaction-tests.mjs']],
  ['trigger store and delivery identity', process.execPath, ['scripts/trigger-store-tests.mjs']],
  ['workflow multi-crash recovery', process.execPath, ['scripts/checkpoint-recovery-live-tests.mjs']],
  ['subworkflow post-accept recovery', process.execPath, ['scripts/subworkflow-recovery-live-tests.mjs']],
  ['trigger receipt recovery', process.execPath, ['scripts/trigger-receipt-recovery-tests.mjs']],
  ['safe evidence canary', process.execPath, ['scripts/evidence-redaction-live-tests.mjs']],
  ['TypeScript', 'npx', ['tsc', '--noEmit']],
  ['production build', 'npm', ['run', 'build']],
  ['browser contract', 'npm', ['run', 'test:browser']],
]

const receipts = []
for (const [name, command, args] of gates) {
  const gateStartedAt = Date.now()
  process.stdout.write(`\n== ${name} ==\n`)
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit', env: process.env })
  const receipt = { name, status: result.status === 0 ? 'passed' : 'failed', durationMs: Date.now() - gateStartedAt }
  receipts.push(receipt)
  if (result.status !== 0) {
    process.stderr.write(`\nRelease verification stopped at ${name}.\n`)
    process.exit(result.status || 1)
  }
}

const manifest = { schemaVersion: 1, status: 'passed', startedAt, finishedAt: Date.now(), gates: receipts }
manifest.receiptSha256 = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
process.stdout.write(`\n== RELEASE VERIFICATION PASSED ==\n${JSON.stringify(manifest, null, 2)}\n`)
