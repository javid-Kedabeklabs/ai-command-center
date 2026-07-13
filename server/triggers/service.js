import crypto from 'node:crypto'
import { createTriggerStore } from './store.js'
import { normalizeError, normalizeTriggerDefinition, publicTrigger, redactedDeliveryKey, TRIGGER_TYPES } from './schema.js'
import { evaluateSchedule, normalizeScheduleConfig, scheduleDefinitionHash, scheduleDeliveryKey } from './schedule.js'
import { advanceFolderCandidates, diffFolderSnapshots, folderDeliveryIdentity, FOLDER_OPERATIONAL_VERSION, normalizeFolderConfig, normalizeFolderOperationalState, publicFolderEvidence, scanFolderSnapshot } from './folder.js'

const tokenHash = token => crypto.createHash('sha256').update(String(token)).digest('hex')
export function createTriggerService({ app, triggersFile, historyFile, rootDir, folderApprovedRoots = [rootDir], folderLaunchConcurrency = 4, authorizeFolderTrigger = () => true, authorizeWebhookTrigger = () => true, runWorkflow, getRun, workflowTriggers, mutateWorkflowTrigger, migrateLegacyTriggers, currentWorkflowVersion, appendAudit = () => {}, clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const timers = new Map(), runWatchers = new Map(), folderPolls = new Set(), folderPollTasks = new Set(), folderLaunches = new Set(), folderQueue = []
  const folderLimit = Math.max(1, Math.min(16, Number(folderLaunchConcurrency) || 4))
  let activeFolderLaunches = 0
  let stopping = false, reconciliation = null
  const store = createTriggerStore({ storeFile: triggersFile, legacyHistoryFile: historyFile, migrateConfigurations: migrateLegacyTriggers })
  const webhookMutations = new Map()
  const serializeWebhookMutation = (id, operation) => {
    const prior = webhookMutations.get(id) || Promise.resolve()
    const current = prior.catch(() => {}).then(operation)
    webhookMutations.set(id, current)
    return current.finally(() => { if (webhookMutations.get(id) === current) webhookMutations.delete(id) })
  }
  const operationKeyHash = value => crypto.createHash('sha256').update(String(value)).digest('hex')
  const requireCredentialIntent = req => {
    if (!String(req.get('content-type') || '').toLowerCase().startsWith('application/json') || req.get('x-command-center-intent') !== 'webhook-credential-change') throw Object.assign(new Error('webhook credential intent is required'), { code: 'WEBHOOK_INTENT_REQUIRED' })
  }
  const folderConfig = trigger => {
    authorizeFolderTrigger(trigger)
    return normalizeFolderConfig(trigger.config, { approvedRoots: folderApprovedRoots })
  }
  const canonicalFolderTriggerConfig = trigger => {
    const normalized = folderConfig(trigger)
    return {
      ...(trigger.config || {}),
      path: normalized.path,
      recursive: normalized.recursive,
      extensions: normalized.extensions,
      pollMs: normalized.pollMs,
      settleMs: normalized.settleMs,
      debounceMs: normalized.debounceMs,
      maxFiles: normalized.maxFiles,
      maxDepth: normalized.maxDepth,
      scanTimeoutMs: normalized.scanTimeoutMs,
      emitDeleted: normalized.emitDeleted,
    }
  }
  const load = (workflowId = null) => workflowTriggers(workflowId).map(item => normalizeTriggerDefinition(item)).map(trigger => {
    if (trigger.type !== 'folder') return trigger
    try { folderConfig(trigger); return { ...trigger, folderStatus: 'ready', folderValidationReason: null } }
    catch (error) { return { ...trigger, enabled: false, folderStatus: 'needs-review', folderValidationReason: normalizeError(error).message } }
  })
  const find = id => load().find(trigger => trigger.id === id)

  async function watchRun(delivery) {
    if (!delivery.runId || runWatchers.has(delivery.id) || stopping) return
    const inspect = async () => {
      if (stopping) return
      const run = await getRun(delivery.runId)
      if (!run || ['running', 'paused'].includes(run.status)) return
      clearInterval(runWatchers.get(delivery.id)); runWatchers.delete(delivery.id)
      await store.transition(delivery.id, delivery.state, { evidence: { runStatus: run.status } }).catch(() => {})
      const trigger = find(delivery.triggerId)
      if (trigger && ['interval', 'cron'].includes(trigger.type)) tickSchedule(trigger).catch(() => {})
    }
    const timer = setInterval(() => inspect().catch(() => {}), 500); timer.unref(); runWatchers.set(delivery.id, timer)
    await inspect()
  }

  async function launch(trigger, delivery, input, recovering = false) {
    await store.transition(delivery.id, recovering ? 'recovering' : 'starting', { attempt: recovering ? delivery.attempt + 1 : delivery.attempt, evidence: { recovered: recovering } })
    try {
      const result = await runWorkflow(trigger.workflowId, input ?? trigger.config?.input ?? '', {
        deliveryId: delivery.id,
        deliveryKey: delivery.deliveryKey,
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
        workflowVersion: delivery.workflowVersion,
        source: delivery.source,
      })
      const started = await store.transition(delivery.id, 'started', { runId: result.runId, evidence: { duplicate: !!result.duplicate, recovered: recovering } })
      appendAudit('workflow_trigger_fired', { triggerId: trigger.id, workflowId: trigger.workflowId, type: trigger.type, runId: result.runId, deliveryId: delivery.id })
      watchRun(started).catch(() => {})
      return { runId: result.runId, ...(result.duplicate ? { duplicate: true } : {}) }
    } catch (error) {
      await store.transition(delivery.id, 'failed', { evidence: { error } }).catch(() => {})
      throw error
    }
  }

  async function fire(trigger, input, source, rawDeliveryKey = '', options = {}) {
    if (!trigger?.enabled && !options.manual) throw new Error('trigger is disabled')
    const deliveryKey = redactedDeliveryKey(rawDeliveryKey || `${source}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`)
    const workflowVersion = await currentWorkflowVersion(trigger.workflowId)
    const reservation = await store.reserve({ trigger, deliveryKey, source, scheduledAt: options.scheduledAt, workflowVersion, manual: !!options.manual })
    if (reservation.duplicate) { await store.noteDuplicate(reservation.delivery.id); return { duplicate: true, runId: reservation.delivery.runId || null, deliveryId: reservation.delivery.id } }
    const result = await launch(trigger, reservation.delivery, input)
    return { ...result, deliveryId: reservation.delivery.id }
  }

  async function fireWebhook(trigger, token, input, rawDeliveryKey) {
    if (!trigger?.enabled || trigger.type !== 'webhook') return null
    try { authorizeWebhookTrigger(trigger, { operation: 'delivery' }) } catch { return null }
    const workflowVersion = await currentWorkflowVersion(trigger.workflowId)
    const reservation = await store.reserveWebhook({ trigger, suppliedTokenHash: tokenHash(token), deliveryKey: rawDeliveryKey, workflowVersion })
    if (!reservation.authenticated) return null
    if (reservation.duplicate) { await store.noteDuplicate(reservation.delivery.id); return { duplicate: true, runId: reservation.delivery.runId || null, deliveryId: reservation.delivery.id } }
    const result = await launch(trigger, reservation.delivery, input)
    return { ...result, deliveryId: reservation.delivery.id }
  }

  const unschedule = id => { const timer = timers.get(id); if (timer?.kind === 'timeout') clearTimer(timer.value); else if (timer?.value) clearInterval(timer.value); else if (timer) clearInterval(timer); timers.delete(id) }

  function pumpFolderQueue() {
    while (!stopping && activeFolderLaunches < folderLimit && folderQueue.length) {
      const item = folderQueue.shift()
      activeFolderLaunches++
      const task = launch(item.trigger, item.delivery, item.input, item.recovering)
        .then(item.resolve, error => { appendAudit('workflow_trigger_folder_launch_failed', { triggerId: item.trigger.id, error: normalizeError(error) }); item.reject(error) })
        .finally(() => { activeFolderLaunches--; folderLaunches.delete(task); pumpFolderQueue() })
      folderLaunches.add(task)
    }
  }

  function enqueueFolderLaunch(trigger, delivery, input, recovering = false) {
    if (stopping) return Promise.reject(Object.assign(new Error('trigger service is stopping'), { code: 'TRIGGER_SERVICE_STOPPING' }))
    const result = new Promise((resolve, reject) => folderQueue.push({ trigger, delivery, input, recovering, resolve, reject }))
    pumpFolderQueue()
    return result
  }

  async function pollFolder(trigger) {
    if (stopping || folderPolls.has(trigger.id)) return
    folderPolls.add(trigger.id)
    try {
      const config = folderConfig(trigger), now = Number(clock()), prior = await store.getFolderState(trigger.id)
      const current = scanFolderSnapshot(config, { clock })
      const compatible = prior?.rootHash === config.rootHash && prior?.snapshot?.rootHash === config.rootHash
      const events = compatible ? diffFolderSnapshots(prior.snapshot, current, { emitDeleted: config.emitDeleted }) : []
      const advanced = advanceFolderCandidates(compatible ? prior.candidates : null, events, { now, settleMs: config.settleMs, debounceMs: config.debounceMs, maxCandidates: config.maxFiles })
      const operational = normalizeFolderOperationalState({ version: FOLDER_OPERATIONAL_VERSION, rootHash: config.rootHash, snapshot: current, candidates: advanced.state, updatedAt: now }, { maxFiles: config.maxFiles })
      const reservations = advanced.ready.map(event => {
        const evidence = publicFolderEvidence(event)
        return { deliveryKey: folderDeliveryIdentity(trigger.id, config.rootHash, event), scheduledAt: now, evidence, input: trigger.config?.input ?? evidence }
      })
      const workflowVersion = reservations.length ? await currentWorkflowVersion(trigger.workflowId) : null
      const results = await store.applyFolderPlan({ trigger: { ...trigger, config }, folderState: operational, reservations, workflowVersion })
      for (const result of results) if (!result.duplicate) enqueueFolderLaunch(trigger, result.delivery, result.input).catch(() => {})
    } catch (error) {
      appendAudit('workflow_trigger_scan_failed', { triggerId: trigger.id, error: normalizeError(error) })
    } finally { folderPolls.delete(trigger.id) }
  }

  function requestFolderPoll(trigger) {
    const task = pollFolder(trigger).finally(() => folderPollTasks.delete(task))
    folderPollTasks.add(task)
    return task
  }

  async function hasActiveRun(triggerId) {
    const deliveries = (await store.list({ triggerId, limit: 200 })).items
    for (const delivery of deliveries) {
      if (!delivery.runId || delivery.state !== 'started') continue
      const run = await getRun(delivery.runId)
      if (run && ['running', 'paused'].includes(run.status)) return true
    }
    return false
  }

  function armSchedule(trigger, state) {
    if (stopping || !trigger.enabled) return
    const delay = Math.max(10, Math.min(60000, Number(state.nextFireAt) - clock()))
    const value = setTimer(() => { timers.delete(trigger.id); tickSchedule(find(trigger.id) || trigger).catch(error => appendAudit('workflow_trigger_schedule_failed', { triggerId: trigger.id, error: normalizeError(error) })) }, delay)
    value?.unref?.(); timers.set(trigger.id, { kind: 'timeout', value })
  }

  async function tickSchedule(trigger) {
    if (stopping || !trigger?.enabled || !['interval', 'cron'].includes(trigger.type)) return
    unschedule(trigger.id)
    const now = clock(), prior = await store.getSchedule(trigger.id)
    let evaluation = evaluateSchedule(trigger, prior, now)
    const config = normalizeScheduleConfig(trigger), hash = scheduleDefinitionHash(trigger), reservations = []
    for (const intendedAt of evaluation.suppressed) reservations.push({ deliveryKey: scheduleDeliveryKey(trigger.id, hash, intendedAt), source: trigger.type, scheduledAt: intendedAt, state: 'suppressed', evidence: { intendedAt, scheduleHash: hash, policyResult: `misfire-${config.misfirePolicy}`, reason: `misfire policy ${config.misfirePolicy}` } })
    let eligible = [...evaluation.eligible]
    const active = await hasActiveRun(trigger.id)
    if (!active && evaluation.state.queuedAt != null) { eligible.unshift(evaluation.state.queuedAt); evaluation.state.queuedAt = null }
    if (!active && config.overlapPolicy === 'queue-one' && eligible.length > 1) {
      const latest = eligible[eligible.length - 1]
      for (const intendedAt of eligible.slice(0, -1)) reservations.push({ deliveryKey: scheduleDeliveryKey(trigger.id, hash, intendedAt), source: trigger.type, scheduledAt: intendedAt, state: 'suppressed', evidence: { intendedAt, scheduleHash: hash, policyResult: 'overlap-queue-coalesced', reason: 'queue-one retained the latest intended instant' } })
      eligible = [latest]
    }
    if (active && eligible.length) {
      if (config.overlapPolicy === 'skip') {
        for (const intendedAt of eligible) reservations.push({ deliveryKey: scheduleDeliveryKey(trigger.id, hash, intendedAt), source: trigger.type, scheduledAt: intendedAt, state: 'suppressed', evidence: { intendedAt, scheduleHash: hash, policyResult: 'overlap-skip', reason: 'active trigger run; overlap policy skip' } })
        evaluation.state.lastSuppressionReason = 'overlap-skip'; eligible = []
      } else if (config.overlapPolicy === 'queue-one') {
        const latest = eligible[eligible.length - 1]
        const replaced = [...eligible.slice(0, -1), ...(evaluation.state.queuedAt != null && evaluation.state.queuedAt !== latest ? [evaluation.state.queuedAt] : [])]
        for (const intendedAt of replaced) reservations.push({ deliveryKey: scheduleDeliveryKey(trigger.id, hash, intendedAt), source: trigger.type, scheduledAt: intendedAt, state: 'suppressed', evidence: { intendedAt, scheduleHash: hash, policyResult: 'overlap-queue-coalesced', reason: 'queue-one retained the latest intended instant' } })
        evaluation.state.queuedAt = latest; evaluation.state.lastSuppressionReason = 'overlap-queue-one'; eligible = []
      }
    }
    for (const intendedAt of eligible) reservations.push({ deliveryKey: scheduleDeliveryKey(trigger.id, hash, intendedAt), source: trigger.type, scheduledAt: intendedAt, state: 'reserved', evidence: { intendedAt, scheduleHash: hash, policyResult: active ? 'overlap-allow' : evaluation.state.queuedAt === intendedAt ? 'queued-release' : 'scheduled' } })
    const workflowVersion = reservations.length ? await currentWorkflowVersion(trigger.workflowId) : null
    const results = await store.applySchedulePlan({ trigger, scheduleState: evaluation.state, reservations, workflowVersion })
    await Promise.all(results.filter(item => !item.duplicate && item.delivery.state === 'reserved').map(item => launch(trigger, item.delivery, trigger.config?.input).catch(() => {})))
    armSchedule(trigger, evaluation.state)
  }

  function schedule(trigger) {
    unschedule(trigger.id)
    if (!trigger.enabled || !['interval', 'cron', 'folder'].includes(trigger.type)) return
    if (trigger.type === 'interval' || trigger.type === 'cron') {
      tickSchedule(trigger).catch(error => appendAudit('workflow_trigger_schedule_failed', { triggerId: trigger.id, error: normalizeError(error) }))
    } else {
      let config
      try { config = folderConfig(trigger) } catch (error) { appendAudit('workflow_trigger_scan_failed', { triggerId: trigger.id, error: normalizeError(error) }); return }
      requestFolderPoll(trigger).catch(() => {})
      const timer = setInterval(() => requestFolderPoll(find(trigger.id) || trigger).catch(() => {}), config.pollMs)
      timer.unref(); timers.set(trigger.id, { kind: 'interval', value: timer })
    }
  }

  async function reload() {
    stopping = false
    await store.initialize()
    await store.reconcileSecrets(load().filter(trigger => trigger.type === 'webhook').map(trigger => trigger.id))
    for (const id of timers.keys()) unschedule(id)
    for (const trigger of load()) schedule(trigger)
    reconciliation = (async () => {
      for (const delivery of await store.pending()) {
        if (stopping) break
        const trigger = find(delivery.triggerId)
        if (!trigger || trigger.workflowId !== delivery.workflowId) { await store.transition(delivery.id, 'failed', { evidence: { reason: 'canonical trigger definition is unavailable' } }); continue }
        if (trigger.type === 'folder') await enqueueFolderLaunch(trigger, delivery, trigger.config?.input ?? delivery.evidence, true).catch(() => {})
        else await launch(trigger, delivery, trigger.config?.input, true).catch(() => {})
      }
    })()
    await reconciliation
  }

  const route = handler => async (req, res) => { try { await store.initialize(); await handler(req, res) } catch (error) { res.status(error.code === 'TRIGGER_STORE_CORRUPT' || error.code === 'TRIGGER_STORE_DISABLED' ? 503 : 400).json({ error: normalizeError(error).message }) } }
  app.get('/api/triggers', route(async (req, res) => {
    const triggers = load(req.query.workflowId || null)
    res.json(await Promise.all(triggers.map(async trigger => ({ ...publicTrigger(trigger), ...(trigger.type === 'webhook' ? { webhookCredentialStatus: await store.getSecret(trigger.id) ? 'active' : 'revoked' } : {}) }))))
  }))
  app.get('/api/triggers/history', route(async (req, res) => {
    const result = await store.list({ triggerId: req.query.triggerId, workflowId: req.query.workflowId, state: req.query.state || req.query.status, runId: req.query.runId, cursor: req.query.cursor, limit: req.query.limit })
    const items = result.items.map(item => ({ ...item, status: item.state }))
    if (req.query.cursor != null || req.query.limit != null || req.query.workflowId || req.query.state || req.query.runId) return res.json({ ...result, items })
    res.json(items)
  }))
  app.post('/api/workflows/:workflowId/triggers', route(async (req, res) => {
    const type = String(req.body.type || 'interval')
    if (!TRIGGER_TYPES.has(type)) return res.status(400).json({ error: 'trigger type must be interval, cron, webhook, or folder' })
    const token = type === 'webhook' ? crypto.randomBytes(24).toString('base64url') : ''
    if (['interval', 'cron'].includes(type)) normalizeScheduleConfig({ type, config: req.body.config || {} })
    let trigger = normalizeTriggerDefinition({ id: `trigger-${crypto.randomBytes(8).toString('hex')}`, workflowId: req.params.workflowId, type, enabled: req.body.enabled !== false, config: req.body.config || {}, createdAt: Date.now(), updatedAt: Date.now() })
    if (type === 'webhook') authorizeWebhookTrigger(trigger, { operation: 'create' })
    if (type === 'folder') trigger = { ...trigger, config: canonicalFolderTriggerConfig(trigger), folderStatus: 'ready', folderValidationReason: null }
    const saved = await mutateWorkflowTrigger('create', trigger)
    if (token) {
      try { await store.setSecret(saved.id, { tokenHash: tokenHash(token), revision: saved.secretRevision || 1, rotatedAt: Date.now() }) }
      catch (error) { await mutateWorkflowTrigger('delete', saved).catch(() => {}); throw error }
    }
    // Establish the folder baseline before the API acknowledges creation. If
    // the response wins this race, a caller can create a file immediately and
    // the first poll incorrectly absorbs it into the baseline instead of
    // emitting a create delivery.
    if (saved.type === 'folder' && saved.enabled) await requestFolderPoll(saved)
    schedule(saved); appendAudit('workflow_trigger_created', { triggerId: saved.id, workflowId: saved.workflowId, type })
    if (token) res.set('Cache-Control', 'no-store')
    res.status(201).json({ ...publicTrigger(saved), ...(token ? { webhookToken: token, webhookEndpoint: `/api/triggers/webhook/${saved.id}`, webhookCredentialStatus: 'active' } : {}) })
  }))
  app.put('/api/triggers/:id', route(async (req, res) => {
    const current = find(req.params.id)
    if (!current) return res.status(404).json({ error: 'trigger not found' })
    const candidate = { ...current, ...(req.body.enabled == null ? {} : { enabled: !!req.body.enabled }), ...(req.body.config ? { config: { ...current.config, ...req.body.config } } : {}), updatedAt: Date.now() }
    if (['interval', 'cron'].includes(candidate.type)) normalizeScheduleConfig(candidate)
    if (candidate.type === 'folder') candidate.config = canonicalFolderTriggerConfig(candidate)
    if (candidate.type === 'webhook' && candidate.enabled) authorizeWebhookTrigger(candidate, { operation: 'enable' })
    const next = normalizeTriggerDefinition(candidate)
    const saved = await mutateWorkflowTrigger('update', next); if (!saved.enabled && ['interval', 'cron'].includes(saved.type)) await store.clearSchedule(saved.id); if (!saved.enabled && saved.type === 'folder') await store.clearFolderState(saved.id); schedule(saved); appendAudit('workflow_trigger_updated', { triggerId: saved.id, enabled: saved.enabled }); res.json(publicTrigger(saved))
  }))
  app.delete('/api/triggers/:id', route(async (req, res) => {
    const current = find(req.params.id)
    if (!current) return res.status(404).json({ error: 'trigger not found' })
    await mutateWorkflowTrigger('delete', current); await store.removeSecret(current.id); await store.clearSchedule(current.id); await store.clearFolderState(current.id); unschedule(current.id); appendAudit('workflow_trigger_deleted', { triggerId: current.id }); res.json({ ok: true })
  }))
  app.post('/api/triggers/:id/webhook-secret/rotate', route(async (req, res) => {
    requireCredentialIntent(req)
    const key = String(req.get('idempotency-key') || '').trim()
    if (!key || key.length > 200) return res.status(400).json({ error: 'a bounded idempotency-key is required' })
    const result = await serializeWebhookMutation(req.params.id, async () => {
      const current = find(req.params.id)
      if (!current) return { status: 404, body: { error: 'trigger not found' } }
      if (current.type !== 'webhook') return { status: 400, body: { error: 'trigger is not a webhook' } }
      authorizeWebhookTrigger(current, { operation: 'rotate' })
      const prior = await store.getSecret(current.id), keyHash = operationKeyHash(key)
      if (prior?.operationKeyHash === keyHash) return { status: 200, body: { triggerId: current.id, webhookCredentialStatus: 'active', secretRevision: current.secretRevision, duplicate: true } }
      const expectedRevision = Math.max(1, Math.floor(Number(req.body?.expectedRevision) || 0))
      if (!expectedRevision || expectedRevision !== current.secretRevision) return { status: 409, body: { error: 'webhook credential revision changed', secretRevision: current.secretRevision } }
      const token = crypto.randomBytes(24).toString('base64url'), revision = current.secretRevision + 1
      const saved = await mutateWorkflowTrigger('update', normalizeTriggerDefinition({ ...current, secretRevision: revision, updatedAt: Date.now() }))
      await store.setSecret(saved.id, { tokenHash: tokenHash(token), revision, operationKeyHash: keyHash, rotatedAt: Date.now() })
      appendAudit('workflow_webhook_secret_rotated', { triggerId: saved.id, workflowId: saved.workflowId, secretRevision: revision })
      return { status: 200, body: { triggerId: saved.id, webhookCredentialStatus: 'active', secretRevision: revision, webhookToken: token, webhookEndpoint: `/api/triggers/webhook/${saved.id}` } }
    })
    res.set('Cache-Control', 'no-store').status(result.status).json(result.body)
  }))
  app.post('/api/triggers/:id/webhook-secret/revoke', route(async (req, res) => {
    requireCredentialIntent(req)
    const result = await serializeWebhookMutation(req.params.id, async () => {
      const current = find(req.params.id)
      if (!current) return { status: 404, body: { error: 'trigger not found' } }
      if (current.type !== 'webhook') return { status: 400, body: { error: 'trigger is not a webhook' } }
      authorizeWebhookTrigger(current, { operation: 'revoke' })
      const prior = await store.getSecret(current.id)
      if (!prior) return { status: 200, body: { triggerId: current.id, webhookCredentialStatus: 'revoked', secretRevision: current.secretRevision, duplicate: true } }
      const expectedRevision = Math.max(1, Math.floor(Number(req.body?.expectedRevision) || 0))
      if (!expectedRevision || expectedRevision !== current.secretRevision) return { status: 409, body: { error: 'webhook credential revision changed', secretRevision: current.secretRevision } }
      const revision = current.secretRevision + 1
      const saved = await mutateWorkflowTrigger('update', normalizeTriggerDefinition({ ...current, secretRevision: revision, updatedAt: Date.now() }))
      await store.removeSecret(saved.id)
      appendAudit('workflow_webhook_secret_revoked', { triggerId: saved.id, workflowId: saved.workflowId, secretRevision: revision })
      return { status: 200, body: { triggerId: saved.id, webhookCredentialStatus: 'revoked', secretRevision: revision } }
    })
    res.set('Cache-Control', 'no-store').status(result.status).json(result.body)
  }))
  app.post('/api/triggers/:id/test', route(async (req, res) => { const trigger = find(req.params.id); if (!trigger) return res.status(404).json({ error: 'trigger not found' }); res.json(await fire(trigger, req.body.input, 'manual-test', `manual:${crypto.randomUUID()}`, { manual: true })) }))
  app.post('/api/triggers/webhook/:id', route(async (req, res) => {
    const trigger = find(req.params.id)
    const authorization = String(req.get('authorization') || ''), match = /^Bearer ([A-Za-z0-9_-]{32})$/.exec(authorization)
    const rawKey = String(req.get('idempotency-key') || '').trim()
    if (!trigger || !match || !rawKey || rawKey.length > 200) return res.status(404).json({ error: 'webhook not found' })
    const result = await fireWebhook(trigger, match[1], req.body, rawKey)
    if (!result) return res.status(404).json({ error: 'webhook not found' })
    res.status(202).json(result)
  }))
  app.post('/api/triggers/webhook/:id/:token', route(async (req, res) => {
    const trigger = find(req.params.id), rawKey = String(req.get('idempotency-key') || '').trim()
    if (!trigger || !/^[A-Za-z0-9_-]{32}$/.test(req.params.token) || !rawKey || rawKey.length > 200) return res.status(404).json({ error: 'webhook not found' })
    const result = await fireWebhook(trigger, req.params.token, req.body, rawKey)
    if (!result) return res.status(404).json({ error: 'webhook not found' })
    res.set('Deprecation', 'true').status(202).json(result)
  }))

  return {
    start: reload,
    stop: async () => { stopping = true; for (const id of [...timers.keys()]) unschedule(id); for (const timer of runWatchers.values()) clearInterval(timer); runWatchers.clear(); for (const item of folderQueue.splice(0)) item.reject(Object.assign(new Error('trigger service stopped before launch'), { code: 'TRIGGER_SERVICE_STOPPING' })); await Promise.allSettled([...folderPollTasks]); await reconciliation?.catch(() => {}); await Promise.allSettled([...folderLaunches]) },
    fire,
    tickSchedule,
    pollFolder,
    validateFolderTrigger: canonicalFolderTriggerConfig,
    store,
  }
}
