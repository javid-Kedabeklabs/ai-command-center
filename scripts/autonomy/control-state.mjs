#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AUTONOMY_HOST_BLOCKER, createAutonomyControlPlane } from '../../server/autonomy/control-plane.js'
import { createHostOperationStore } from '../../server/autonomy/host-operation-store.js'

const root = process.env.COMMAND_CENTER_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const command = process.argv[2]
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null }
const read = file => { try { return fs.readFileSync(path.join(root, file), 'utf8') } catch { return '' } }
const head = () => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const taskText = () => read('state/next-task.md')
const taskId = () => {
  const match = taskText().match(/Phase\s+([0-9A-Za-z-]+)(?:,\s*slice\s+([0-9A-Za-z-]+))?/i)
  return match ? `phase-${match[1]}${match[2] ? `-${match[2]}` : ''}`.toLowerCase() : 'autonomy-next-task'
}
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex')
const meaningfulMaterial = () => {
  const diff = execFileSync('git', ['-C', root, 'diff', '--binary', 'HEAD', '--', '.', ':(exclude)state/**', ':(exclude)data/**', ':(exclude)logs/**', ':(exclude)docs/IMPLEMENTATION_STATUS.md', ':(exclude)HANDOFF.md'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const untracked = execFileSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter(file => !/^(state|data|logs)\//.test(file)).sort()
  return { diffSha256: digest(diff), untracked }
}

const control = createAutonomyControlPlane({ root })
const hostStore = createHostOperationStore({ root })

if (command === 'before-iteration') {
  const status = taskText().match(/^Status:\s*(\S+)/m)?.[1] || 'READY'
  if (['WAITING_FOR_HOST', 'WAITING_HOST_OPERATION'].includes(status)) {
    const requests = hostStore.list().filter(item => item.taskId === taskId())
    const failed = requests.find(item => item.status === 'FAILED')
    const pending = requests.filter(item => ['PENDING', 'RUNNING'].includes(item.status))
    const completed = requests.filter(item => item.status === 'COMPLETED')
    // Host receipts are evidence, not authority to rewrite the task. A trusted
    // controller/lead must explicitly move next-task.md out of WAITING after it
    // verifies that every task-specific postcondition is satisfied.
    const action = failed ? 'HALT_HOST_OPERATION_FAILED' : 'WAITING_HOST_OPERATION'
    console.log(JSON.stringify({ action, taskId: taskId(), status, requests: requests.map(item => ({ requestId: item.requestId, operation: item.operation, status: item.status })) }))
  } else {
    console.log(JSON.stringify({ action: 'CONTINUE', taskId: taskId(), status }))
  }
} else if (command === 'after-iteration') {
  const iterationId = argument('--iteration-id')
  const status = taskText().match(/^Status:\s*(\S+)/m)?.[1] || 'READY'
  const waiting = ['WAITING_FOR_HOST', 'WAITING_HOST_OPERATION'].includes(status)
  console.log(JSON.stringify(control.evaluate({
    iterationId,
    taskId: taskId(),
    baseSha: head(),
    progressMaterial: meaningfulMaterial(),
    blocker: waiting ? { blockerClass: AUTONOMY_HOST_BLOCKER, operation: 'host-verification', resource: 'command-center', normalizedError: 'task requires allowlisted host operations', environment: 'managed-codex-worker' } : null,
  })))
} else if (command === 'status') {
  console.log(JSON.stringify({ control: control.inspect(), hostOperations: hostStore.list() }, null, 2))
} else {
  console.error('Usage: control-state.mjs before-iteration|after-iteration|status')
  process.exitCode = 64
}
