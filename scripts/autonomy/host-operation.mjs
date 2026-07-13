#!/usr/bin/env node
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHostController } from '../../server/autonomy/host-controller.js'
import { createHostOperationStore } from '../../server/autonomy/host-operation-store.js'

const root = process.env.COMMAND_CENTER_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const store = createHostOperationStore({ root })
const command = process.argv[2]
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null }

if (command === 'enqueue') {
  const taskId = argument('--task'), operation = argument('--operation'), resource = argument('--resource'), rawParams = argument('--params') || '{}'
  const params = JSON.parse(rawParams), createdAt = Date.now()
  const requestId = argument('--request-id') || `host-${crypto.randomBytes(8).toString('hex')}`
  const idempotencyKey = crypto.createHash('sha256').update(JSON.stringify({ taskId, operation, resource, params })).digest('hex')
  console.log(JSON.stringify(store.enqueue({ schemaVersion: 1, requestId, taskId, operation, resource, params, idempotencyKey, createdAt, expiresAt: createdAt + 86_400_000 }), null, 2))
} else if (command === 'process-once') {
  const controller = createHostController({ root })
  for (const pending of store.list('PENDING')) {
    let request
    try {
      request = store.claim(pending.requestId)
      const receipt = await controller.execute(request)
      store.finish(request.requestId, { ok: true, receipt })
    } catch (error) {
      if (request) store.finish(request.requestId, { ok: false, error: error.message, receipt: { requestId: request.requestId, failedAt: Date.now() } })
    }
  }
  console.log(JSON.stringify(store.list(), null, 2))
} else if (command === 'list') {
  console.log(JSON.stringify(store.list(), null, 2))
} else if (command === 'supersede') {
  console.log(JSON.stringify(store.supersede(argument('--request-id'), argument('--replacement'), argument('--reason') || undefined), null, 2))
} else {
  console.error('Usage: host-operation.mjs enqueue|process-once|list|supersede')
  process.exitCode = 64
}
