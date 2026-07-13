import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createLocalModelFactory } from '../server/local-factory/index.js'
import { createLocalFactoryRouter } from '../server/local-factory/router.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-local-factory-api-'))
const fakeFetch = async () => ({
  ok: true,
  headers: { get: () => null },
  text: async () => JSON.stringify({
    model: 'qwen-coder-factory',
    choices: [{ message: { content: JSON.stringify({ status: 'COMPLETED', summary: 'fixture completed', findings: [], proposedChanges: [], tests: [], risks: [], recommendedAction: 'USE_AS_ADVICE' }) } }],
  }),
})
const factory = createLocalModelFactory({ repositoryRoot: root, storeRoot: path.join(root, 'state/local-factory'), fetchImpl: fakeFetch, concurrency: 2 })
const audit = []
const app = express(); app.use(express.json()); app.use('/api/local-factory', createLocalFactoryRouter({ factory, appendAudit: (action, detail) => audit.push({ action, detail }) }))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/local-factory`
const packet = { schemaVersion: 1, taskId: 'api-fixture-task', status: 'QUEUED', taskType: 'CODE_REVIEW', workerRole: 'REVIEWER', title: 'Review fixture', objective: 'Review the bounded fixture without editing.', background: 'Fixture only.', contextFiles: [], acceptanceCriteria: ['Return structured advice.'], priority: 50, timeoutSeconds: 30, maxInputBytes: 10_000, maxOutputTokens: 512, temperature: 0.1, model: 'qwen-coder-factory' }

try {
  const status = await fetch(`${base}/status`).then(response => response.json())
  assert.equal(status.enabled, true); assert.equal(status.concurrency, 2)
  const acceptedResponse = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) })
  assert.equal(acceptedResponse.status, 202)
  assert.equal((await acceptedResponse.json()).taskId, packet.taskId)
  let completed
  for (let attempt = 0; attempt < 20; attempt++) {
    completed = await fetch(`${base}/tasks/${packet.taskId}`).then(response => response.json())
    if (completed.status === 'COMPLETED') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(completed.status, 'COMPLETED')
  assert.equal(completed.result.result.summary, 'fixture completed')
  assert.equal((await fetch(`${base}/tasks`).then(response => response.json())).length, 1)
  assert.equal(audit[0].action, 'local_factory_task_queued')
  const duplicate = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) })
  assert.equal(duplicate.status, 400)
  console.log('ok 1 - local factory API status, durable dispatch, result retrieval, audit, and duplicate rejection')
  console.log('1..1')
} finally {
  factory.shutdown('fixture complete')
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
}
