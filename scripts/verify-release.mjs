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
  ['disk-full, soak, and performance hardening', process.execPath, ['scripts/hardening-reliability-tests.mjs']],
  ['authoritative backup and restore', process.execPath, ['scripts/backup-restore-tests.mjs']],
  ['installed data-root isolation', process.execPath, ['scripts/data-root-tests.mjs']],
  ['sanitized package and SBOM', process.execPath, ['scripts/package-artifact-tests.mjs']],
  ['clean packaged installation', process.execPath, ['scripts/clean-package-install-tests.mjs']],
  ['dependency licenses and vulnerabilities', process.execPath, ['scripts/verify-supply-chain.mjs']],
  ['versioned install, upgrade, and rollback', process.execPath, ['scripts/release-lifecycle-tests.mjs']],
  ['product LaunchAgent lifecycle', process.execPath, ['scripts/product-launch-agent-tests.mjs']],
  ['organization authoring', process.execPath, ['scripts/organization-tests.mjs']],
  ['portable plugin packages', process.execPath, ['scripts/plugin-package-tests.mjs']],
  ['evaluation gates and baselines', process.execPath, ['scripts/evaluation-gate-tests.mjs']],
  ['versioned evaluation datasets', process.execPath, ['scripts/evaluation-dataset-tests.mjs']],
  ['controlled learning proposals', process.execPath, ['scripts/learning-proposal-tests.mjs']],
  ['controlled learning live journey', process.execPath, ['scripts/learning-live-tests.mjs']],
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
