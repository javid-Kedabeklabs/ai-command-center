import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeTriggerDefinition } from '../server/triggers/schema.js'
import { createTriggerService } from '../server/triggers/service.js'

let passed = 0, failed = 0
async function test(name, operation) {
  try { await operation(); console.log(`  PASS  ${name}`); passed++ }
  catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ }
}
const waitFor = async (predicate, message, attempts = 100) => {
  for (let index = 0; index < attempts; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error(message)
}
const expectCode = (operation, code) => {
  try { operation(); throw new Error(`expected ${code}`) }
  catch (error) { if (error.code !== code) throw error }
}

function fixture({ concurrency = 2, runWorkflow } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-folder-service-')), watched = path.join(root, 'watched')
  fs.mkdirSync(watched)
  const definitions = [], workflow = { id: 'workflow-folder', permissions: {}, version: 'v1' }, launches = [], audits = []
  const app = express(); app.use(express.json())
  const service = createTriggerService({
    app,
    rootDir: root,
    folderApprovedRoots: [root],
    folderLaunchConcurrency: concurrency,
    triggersFile: path.join(root, 'store.json'),
    historyFile: path.join(root, 'history.json'),
    workflowTriggers: workflowId => definitions.filter(item => !workflowId || item.workflowId === workflowId),
    mutateWorkflowTrigger: async (_action, trigger) => structuredClone(trigger),
    migrateLegacyTriggers: async () => {},
    currentWorkflowVersion: async () => workflow.version,
    authorizeFolderTrigger: trigger => {
      if (trigger.workflowId !== workflow.id) throw new Error('workflow not found')
      if (workflow.permissions['read-files'] === false) throw Object.assign(new Error('workflow permission read-files denies folder triggers'), { code: 'FOLDER_PERMISSION_DENIED' })
    },
    getRun: async () => null,
    runWorkflow: runWorkflow || (async (_workflowId, input, context) => { launches.push({ input, context }); return { runId: `run-${launches.length}` } }),
    appendAudit: (action, detail) => audits.push({ action, detail }),
  })
  const makeTrigger = (id = 'trigger-folder01') => {
    const raw = normalizeTriggerDefinition({ id, workflowId: workflow.id, type: 'folder', enabled: true, config: { path: watched, pollMs: 1000, settleMs: 0, debounceMs: 0, extensions: ['txt'] }, createdAt: 1, updatedAt: 1 })
    return { ...raw, config: service.validateFolderTrigger(raw) }
  }
  return { root, watched, definitions, workflow, launches, audits, service, makeTrigger }
}

console.log('== durable folder trigger service ==')

await test('create, modify, rename, duplicate suppression, restart, denial, redaction, and cleanup', async () => {
  const state = fixture()
  try {
    const trigger = state.makeTrigger(); state.definitions.push(trigger)
    await state.service.start(); await state.service.pollFolder(trigger)

    const first = path.join(state.watched, 'customer.txt')
    fs.writeFileSync(first, 'one')
    await state.service.pollFolder(trigger); await waitFor(() => state.launches.length === 1, 'create did not launch')
    fs.writeFileSync(first, 'two-two')
    await state.service.pollFolder(trigger); await waitFor(() => state.launches.length === 2, 'modify did not launch')
    fs.renameSync(first, path.join(state.watched, 'renamed.txt'))
    await state.service.pollFolder(trigger); await waitFor(() => state.launches.length === 3, 'rename did not launch')
    await state.service.pollFolder(trigger)
    if (state.launches.length !== 3) throw new Error('unchanged snapshot launched a duplicate')

    const history = (await state.service.store.list({ triggerId: trigger.id, limit: 20 })).items
    const serialized = JSON.stringify({ history, launches: state.launches })
    if (history.length !== 3 || serialized.includes('customer.txt') || serialized.includes('renamed.txt') || serialized.includes(state.watched)) throw new Error(`folder evidence leaked a path: ${serialized}`)
    if (!history.every(item => /^[a-f0-9]{64}$/.test(item.evidence.relativePathHash || '') && ['created', 'modified', 'renamed'].includes(item.evidence.event))) throw new Error(JSON.stringify(history))

    await state.service.stop()
    fs.writeFileSync(path.join(state.watched, 'after-restart.txt'), 'restart')
    const restarted = fixtureFromState(state)
    await restarted.start(); await restarted.pollFolder(trigger); await waitFor(() => state.launches.length === 4, 'restart did not recover snapshot identity')
    await restarted.pollFolder(trigger); if (state.launches.length !== 4) throw new Error('restart emitted a duplicate')

    state.workflow.permissions['read-files'] = false
    expectCode(() => restarted.validateFolderTrigger({ ...trigger, config: { ...trigger.config, permissions: { 'read-files': true } } }), 'FOLDER_PERMISSION_DENIED')
    state.workflow.permissions = {}
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-folder-outside-')), link = path.join(state.root, 'escape')
    fs.symlinkSync(outside, link)
    expectCode(() => restarted.validateFolderTrigger({ ...trigger, config: { ...trigger.config, path: link } }), 'FOLDER_SYMLINK_REJECTED')
    fs.rmSync(outside, { recursive: true, force: true })

    const other = { ...trigger, id: 'trigger-folder99' }
    await restarted.pollFolder(other)
    await restarted.store.clearFolderState(trigger.id)
    const persisted = JSON.parse(fs.readFileSync(path.join(state.root, 'store.json'), 'utf8'))
    if (persisted.folders?.[trigger.id] || !persisted.folders?.[other.id]) throw new Error('cleanup cleared the wrong operational folder state')
    await restarted.store.clearFolderState(other.id)
    await restarted.stop()
  } finally {
    await state.service.stop().catch(() => {})
    fs.rmSync(state.root, { recursive: true, force: true })
  }
})

function fixtureFromState(state) {
  const app = express(); app.use(express.json())
  return createTriggerService({
    app, rootDir: state.root, folderApprovedRoots: [state.root], triggersFile: path.join(state.root, 'store.json'), historyFile: path.join(state.root, 'history.json'),
    workflowTriggers: () => state.definitions, mutateWorkflowTrigger: async (_action, trigger) => trigger, migrateLegacyTriggers: async () => {}, currentWorkflowVersion: async () => 'v1',
    authorizeFolderTrigger: () => { if (state.workflow.permissions['read-files'] === false) throw Object.assign(new Error('workflow permission read-files denies folder triggers'), { code: 'FOLDER_PERMISSION_DENIED' }) },
    getRun: async () => null, runWorkflow: async (_workflowId, input, context) => { state.launches.push({ input, context }); return { runId: `run-${state.launches.length}` } },
  })
}

await test('folder delivery launch concurrency is bounded and shutdown leaves queued reservations recoverable', async () => {
  let active = 0, maximum = 0
  const releases = []
  const state = fixture({ concurrency: 2, runWorkflow: async () => {
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => releases.push(resolve))
    active--
    return { runId: `run-bounded-${releases.length}` }
  } })
  try {
    const trigger = state.makeTrigger('trigger-folder02'); state.definitions.push(trigger)
    await state.service.start(); await state.service.pollFolder(trigger)
    for (let index = 0; index < 6; index++) fs.writeFileSync(path.join(state.watched, `file-${index}.txt`), String(index))
    await state.service.pollFolder(trigger); await waitFor(() => active === 2, 'bounded launches did not start')
    if (maximum !== 2) throw new Error(`expected concurrency 2, observed ${maximum}`)
    const stopping = state.service.stop()
    while (releases.length) releases.shift()()
    await stopping
    const pending = await state.service.store.pending()
    if (pending.length !== 4) throw new Error(`expected four queued durable reservations, found ${pending.length}`)
  } finally {
    while (releases.length) releases.shift()()
    await state.service.stop().catch(() => {})
    fs.rmSync(state.root, { recursive: true, force: true })
  }
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
