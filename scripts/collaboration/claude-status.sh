#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"

node - "$ROOT" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const stateRoot = path.join(root, 'state', 'collaboration')
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,99}$/i.test(value) ? value : null
const safeEnum = (value, allowed) => allowed.includes(value) ? value : 'UNKNOWN'
const safeInteger = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null
function readState(name) {
  const file = path.join(stateRoot, name)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error('unsafe state file')
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) throw new Error('invalid state schema')
    return { value, available: true }
  } catch {
    return { value: {}, available: false }
  }
}
const index = readState('task-index.json')
const workersState = readState('worker-status.json')
const capacityState = readState('capacity-status.json')
const taskStatuses = ['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED']
const workerStatuses = ['STARTING', 'RUNNING', 'STOP_REQUESTED', 'STOPPED', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED']
const capacityStatuses = ['AVAILABLE', 'RATE_LIMITED', 'USAGE_LIMIT_REACHED', 'AUTH_REQUIRED', 'SERVICE_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'DISABLED']
const rawTasks = index.value.tasks && typeof index.value.tasks === 'object' && !Array.isArray(index.value.tasks) ? index.value.tasks : {}
const tasks = Object.entries(rawTasks).slice(0, 1000).map(([key, task]) => ({
  taskId: safeId(task?.taskId) || safeId(key) || 'INVALID',
  status: safeEnum(task?.status, taskStatuses),
  worker: ['claude-fable', 'claude-sonnet', 'codex'].includes(task?.assignedWorker) ? task.assignedWorker : 'unknown',
})).sort((a, b) => a.taskId.localeCompare(b.taskId))
const rawWorkers = workersState.value.workers && typeof workersState.value.workers === 'object' && !Array.isArray(workersState.value.workers) ? workersState.value.workers : {}
const workers = Object.entries(rawWorkers).slice(0, 100).map(([key, worker]) => ({
  taskId: safeId(worker?.taskId) || safeId(key) || 'INVALID',
  status: safeEnum(worker?.status, workerStatuses),
  pid: safeInteger(worker?.pid),
  modelRequested: ['fable', 'sonnet'].includes(worker?.modelRequested) ? worker.modelRequested : null,
  modelActual: ['fable', 'sonnet'].includes(worker?.modelActual) ? worker.modelActual : null,
})).sort((a, b) => a.taskId.localeCompare(b.taskId))
const capacity = Object.fromEntries(['codex', 'claude'].map(provider => [provider, {
  status: safeEnum(capacityState.value?.[provider]?.status, capacityStatuses),
  attempts: safeInteger(capacityState.value?.[provider]?.attempts),
  retryAt: typeof capacityState.value?.[provider]?.retryAt === 'number' ? capacityState.value[provider].retryAt : null,
}]))
const counts = Object.fromEntries(taskStatuses.map(status => [status, tasks.filter(task => task.status === status).length]))
console.log(JSON.stringify({ schemaVersion: 1, stateAvailable: { taskIndex: index.available, workers: workersState.available, capacity: capacityState.available }, counts, tasks, workers, capacity }, null, 2))
NODE
