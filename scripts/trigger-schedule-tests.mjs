import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTriggerService } from '../server/triggers/service.js'
import { createTriggerStore } from '../server/triggers/store.js'
import { evaluateSchedule, initialScheduleState, nextScheduledInstant, normalizeScheduleConfig, parseCron, scheduleDefinitionHash, scheduleDeliveryKey, scheduleSemantics, validateTimezone } from '../server/triggers/schedule.js'
import { normalizeTriggerDefinition } from '../server/triggers/schema.js'

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.stack || error.message}`); failed++ } }
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trigger-schedule-'))
const baseTrigger = (overrides = {}) => ({ id: 'trigger-schedule01', workflowId: 'workflow-one', type: 'interval', enabled: true, createdAt: 1000, updatedAt: 1000, config: { intervalMs: 1000, timezone: 'UTC', misfirePolicy: 'skip', overlapPolicy: 'skip', maxCatchUp: 3 }, ...overrides })

console.log('== strict persistent trigger schedules ==')

await test('strict cron accepts lists/ranges/steps and rejects malformed fields', () => {
  parseCron('*/15 1-5 1,15 * 1-5')
  for (const value of ['* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 7', '*/0 * * * *', '5-2 * * * *', '1,,2 * * * *']) {
    try { parseCron(value); throw new Error(`accepted ${value}`) } catch (error) { if (/accepted/.test(error.message)) throw error }
  }
})

await test('IANA timezone validation is explicit and never falls back locally', () => {
  if (validateTimezone('America/Los_Angeles') !== 'America/Los_Angeles') throw new Error('valid timezone changed')
  try { validateTimezone('Local/Magic'); throw new Error('invalid timezone accepted') } catch (error) { if (/accepted/.test(error.message)) throw error }
})

await test('DST nonexistent minutes skip and repeated minutes produce distinct UTC instants', () => {
  const spring = { ...baseTrigger(), type: 'cron', config: { cron: '30 2 * * *', timezone: 'America/Los_Angeles', misfirePolicy: 'skip', overlapPolicy: 'skip', maxCatchUp: 2 } }
  const beforeSpring = Date.parse('2026-03-08T09:59:00Z'), springNext = nextScheduledInstant(spring, beforeSpring)
  if (new Date(springNext).toISOString() !== '2026-03-09T09:30:00.000Z') throw new Error(`nonexistent local minute fired: ${new Date(springNext).toISOString()}`)
  const fall = { ...spring, config: { ...spring.config, cron: '30 1 * * *' } }, first = nextScheduledInstant(fall, Date.parse('2026-11-01T07:59:00Z')), second = nextScheduledInstant(fall, first)
  if (second - first !== 3600000 || scheduleDeliveryKey(fall.id, scheduleDefinitionHash(fall), first) === scheduleDeliveryKey(fall.id, scheduleDefinitionHash(fall), second)) throw new Error('repeated local minute was not represented by two stable instants')
  if (!/either/.test(scheduleSemantics.dayRule) || !/distinct UTC/.test(scheduleSemantics.dstRule)) throw new Error('schedule semantics are undocumented')
})

await test('persisted interval cursor uses intended instants and bounded skip misfires', () => {
  const trigger = baseTrigger(), initial = initialScheduleState(trigger, 1000)
  const onTime = evaluateSchedule(trigger, initial, 2000)
  if (onTime.eligible[0] !== 2000 || onTime.state.nextFireAt !== 3000) throw new Error('on-time cursor mismatch')
  const delayed = evaluateSchedule(trigger, onTime.state, 9000)
  if (delayed.eligible.length || delayed.suppressed.length > 3 || delayed.state.nextFireAt !== 10000 || !delayed.overflow) throw new Error('skip catch-up was not bounded and advanced')
})

await test('fire-once misfire selects only the latest bounded eligible instant', () => {
  const trigger = baseTrigger({ config: { ...baseTrigger().config, misfirePolicy: 'fire-once', maxCatchUp: 2 } }), result = evaluateSchedule(trigger, initialScheduleState(trigger, 1000), 9000)
  if (result.eligible.length !== 1 || result.eligible[0] !== 9000 || result.state.nextFireAt !== 10000) throw new Error(JSON.stringify(result))
})

await test('schedule edits invalidate cursor without changing prior delivery identity', () => {
  const old = baseTrigger(), state = initialScheduleState(old, 1000), edited = baseTrigger({ config: { ...old.config, intervalMs: 2000 } })
  const result = evaluateSchedule(edited, state, 1500)
  if (result.state.scheduleDefinitionHash === state.scheduleDefinitionHash || result.state.nextFireAt !== 3000) throw new Error('edited definition retained stale cursor')
  if (scheduleDeliveryKey(old.id, scheduleDefinitionHash(old), 2000) === scheduleDeliveryKey(edited.id, scheduleDefinitionHash(edited), 2000)) throw new Error('schedule edit reused delivery identity')
})

await test('cursor advancement and intended-instant reservations commit atomically across restart', async () => {
  const dir = fixture(), files = { storeFile: path.join(dir, 'store.json'), legacyHistoryFile: path.join(dir, 'history.json') }, trigger = baseTrigger()
  let store = createTriggerStore(files); await store.initialize()
  const state = evaluateSchedule(trigger, initialScheduleState(trigger, 1000), 2000).state, key = scheduleDeliveryKey(trigger.id, state.scheduleDefinitionHash, 2000)
  await store.applySchedulePlan({ trigger, scheduleState: state, workflowVersion: 'v1', reservations: [{ deliveryKey: key, source: 'interval', scheduledAt: 2000, evidence: { intendedAt: 2000, scheduleHash: state.scheduleDefinitionHash, policyResult: 'scheduled' } }] })
  store = createTriggerStore(files); await store.initialize()
  const replay = await store.applySchedulePlan({ trigger, scheduleState: state, workflowVersion: 'v1', reservations: [{ deliveryKey: key, source: 'interval', scheduledAt: 2000 }] })
  const history = await store.list({ triggerId: trigger.id, limit: 10 })
  if (!replay[0].duplicate || history.total !== 1 || (await store.getSchedule(trigger.id)).nextFireAt !== 3000) throw new Error('restart replay diverged')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('corrupt persisted cursor fails closed without replacing the store', async () => {
  const dir = fixture(), file = path.join(dir, 'store.json'), raw = { schemaVersion: 1, retention: {}, secrets: {}, identities: {}, deliveries: [], schedules: { 'trigger-schedule01': { version: 1, nextFireAt: 'not-a-time' } } }
  fs.writeFileSync(file, JSON.stringify(raw)); const before = fs.readFileSync(file, 'utf8'), store = createTriggerStore({ storeFile: file, legacyHistoryFile: path.join(dir, 'history.json') })
  await store.initialize().then(() => { throw new Error('corrupt cursor accepted') }, () => {})
  if (store.status().enabled || fs.readFileSync(file, 'utf8') !== before) throw new Error('corrupt cursor did not fail safely')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('disable/delete cleanup removes persisted queued future work', async () => {
  const dir = fixture(), store = createTriggerStore({ storeFile: path.join(dir, 'store.json'), legacyHistoryFile: path.join(dir, 'history.json') }), trigger = baseTrigger()
  await store.initialize(); const state = { ...initialScheduleState(trigger, 1000), queuedAt: 2000 }
  await store.applySchedulePlan({ trigger, scheduleState: state })
  if ((await store.getSchedule(trigger.id))?.queuedAt !== 2000) throw new Error('fixture queue did not persist')
  await store.clearSchedule(trigger.id)
  if (await store.getSchedule(trigger.id)) throw new Error('queued future work survived cleanup')
  fs.rmSync(dir, { recursive: true, force: true })
})

function serviceFixture(overlapPolicy) {
  const dir = fixture(), routes = {}, app = {}
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (route, handler) => { routes[`${method}:${route}`] = handler }
  let now = 1000
  const runs = new Map(), launches = []
  const trigger = normalizeTriggerDefinition(baseTrigger({ config: { ...baseTrigger().config, overlapPolicy } }))
  const service = createTriggerService({ app, triggersFile: path.join(dir, 'store.json'), historyFile: path.join(dir, 'history.json'), rootDir: dir, workflowTriggers: () => [trigger], mutateWorkflowTrigger: async (_action, value) => value, migrateLegacyTriggers: async () => {}, currentWorkflowVersion: async () => 'v1', clock: () => now, setTimer: () => ({ unref() {} }), clearTimer: () => {}, getRun: async id => runs.get(id), runWorkflow: async () => { const id = `run-${launches.length + 1}`; launches.push(id); runs.set(id, { id, status: 'running' }); return { runId: id } } })
  return { dir, service, trigger, runs, launches, setNow: value => { now = value } }
}

for (const policy of ['skip', 'queue-one', 'allow']) await test(`${policy} overlap policy follows actual linked run state`, async () => {
  const fixtureState = serviceFixture(policy), { service, trigger, runs, launches } = fixtureState
  await service.store.initialize(); await service.tickSchedule(trigger)
  fixtureState.setNow(2000); await service.tickSchedule(trigger)
  fixtureState.setNow(3000); await service.tickSchedule(trigger)
  if (policy === 'allow' && launches.length !== 2) throw new Error('allow did not launch concurrent intended instant')
  if (policy !== 'allow' && launches.length !== 1) throw new Error(`${policy} launched overlapping work`)
  if (policy === 'skip') { const history = await service.store.list({ triggerId: trigger.id, limit: 10 }); if (!history.items.some(item => item.state === 'suppressed' && item.evidence.policyResult === 'overlap-skip')) throw new Error('skip evidence missing') }
  if (policy === 'queue-one') {
    const persisted = await service.store.getSchedule(trigger.id); if (persisted.queuedAt !== 3000) throw new Error('queue-one instant was not persisted')
    runs.get(launches[0]).status = 'done'; fixtureState.setNow(3100); await service.tickSchedule(trigger)
    if (launches.length !== 2 || (await service.store.getSchedule(trigger.id)).queuedAt != null) throw new Error('queued instant did not release after terminal run')
  }
  await service.stop(); fs.rmSync(fixtureState.dir, { recursive: true, force: true })
})

await test('invalid legacy schedules persist disabled for review while strict mutations reject them', () => {
  const legacy = normalizeTriggerDefinition({ ...baseTrigger(), type: 'cron', enabled: true, config: { cron: '99 * * * *', timezone: 'UTC' } })
  if (legacy.enabled || legacy.scheduleStatus !== 'needs-review' || !legacy.scheduleValidationReason) throw new Error('invalid legacy definition was not retained for review')
  try { normalizeScheduleConfig({ ...legacy, config: { cron: '99 * * * *', timezone: 'UTC' } }); throw new Error('invalid mutation accepted') } catch (error) { if (/accepted/.test(error.message)) throw error }
})

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
