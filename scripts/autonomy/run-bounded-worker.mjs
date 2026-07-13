import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const timeoutIndex = args.indexOf('--timeout-seconds')
const graceIndex = args.indexOf('--grace-seconds')
const separator = args.indexOf('--')
if (timeoutIndex < 0 || graceIndex < 0 || separator < 0 || separator + 1 >= args.length) {
  console.error('usage: run-bounded-worker --timeout-seconds N --grace-seconds N -- /absolute/worker [args...]')
  process.exit(64)
}
const timeoutSeconds = Number(args[timeoutIndex + 1]), graceSeconds = Number(args[graceIndex + 1])
const minimumTimeout = process.env.AUTONOMY_TEST_MODE === '1' ? 1 : 60
if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < minimumTimeout || timeoutSeconds > 14_400) throw new Error(`worker timeout must be between ${minimumTimeout} and 14400 seconds`)
if (!Number.isInteger(graceSeconds) || graceSeconds < 1 || graceSeconds > 60) throw new Error('worker grace must be between 1 and 60 seconds')
const command = args[separator + 1], commandArgs = args.slice(separator + 2)
if (!path.isAbsolute(command)) throw new Error('worker executable must be absolute')
const executable = fs.realpathSync(command)
const root = fs.realpathSync(process.env.COMMAND_CENTER_ROOT || process.cwd())
const configuredWorker = process.env.AUTONOMY_WORKER ? fs.realpathSync(process.env.AUTONOMY_WORKER) : null
if (executable !== path.join(root, 'scripts/autonomy/codex-worker.sh') && executable !== configuredWorker) throw new Error('worker executable is not allowlisted')

const child = spawn(executable, commandArgs, { cwd: root, env: process.env, stdio: 'inherit', detached: true, shell: false })
let terminating = false, timedOut = false
const signalGroup = signal => {
  if (!child.pid) return
  try { process.kill(-child.pid, signal) } catch {}
}
const terminate = reason => {
  if (terminating) return
  terminating = true
  timedOut = reason === 'timeout'
  signalGroup('SIGTERM')
  setTimeout(() => signalGroup('SIGKILL'), graceSeconds * 1_000).unref()
}
const timeout = setTimeout(() => terminate('timeout'), timeoutSeconds * 1_000)
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => terminate('signal'))
child.once('error', error => { clearTimeout(timeout); console.error(error.message); process.exit(71) })
child.once('close', (code, signal) => {
  clearTimeout(timeout)
  if (timedOut) { console.error('bounded autonomy worker timed out'); process.exit(124) }
  if (terminating) process.exit(143)
  if (signal) process.exit(128)
  process.exit(Number.isInteger(code) ? code : 1)
})
