// AI Command Center — local backend
// Proxies LM Studio + drives OpenCode; serves the dashboard UI.
import express from 'express'
import os from 'os'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn, execFile, execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { mergeWorkflowDocuments, migrateWorkflowDocument } from './workflows/schema.js'
import { disabledWorkflowNodeIds, groupValidationErrors } from './workflows/groups.js'
import { commentValidationErrors } from './workflows/comments.js'
import { PORT_TYPES, coerceValue, contractForNode, portCatalog, portsCompatible, suggestedConverter, validateSchema } from './workflows/ports.js'
import { listWorkflowVersions, resolvePinnedWorkflowVersion, saveWorkflowVersion, workflowContentHash } from './workflows/versions.js'
import { archiveReusableComponent, renameReusableComponent, reusableComponentCatalog } from './workflows/components.js'
import { exportComponentManifest, installComponentManifest, validateComponentManifest } from './workflows/component-manifests.js'
import { runDependencyGraph } from './runtime/scheduler.js'
import { claimNode, completeNode, confirmEffect, createCheckpoint, failNode, markEffectInflight, migrateLegacyCheckpoint, prepareEffect, recoverCheckpoint, resetCheckpointNodes, resumeWaitingNode, validateCheckpoint, waitNode } from './runtime/checkpoint-state.js'
import { createRunControl, decideApproval, pendingApprovalForNode, requestApproval, setManualPause } from './runtime/run-control.js'
import { ResourceCoordinator, nodeResourceLimit, normalizeResourcePolicy, resourcePolicyErrors } from './runtime/resources.js'
import { GlobalModelCoordinator, explicitModelBytes, globalModelPolicyFromEnv } from './runtime/global-model-resources.js'
import { childExecutionContext, effectiveExecutionContext, executionContextFromEvidence, executionPolicyEvidence, MAX_SUBWORKFLOW_DEPTH, parseInheritedExecutionContext, WORKFLOW_CAPABILITIES } from './runtime/subworkflow-context.js'
import { findSubworkflowRun, normalizeParentOperation } from './runtime/subworkflow-receipts.js'
import { createTriggerService } from './triggers/service.js'
import { findTriggerRun, normalizeTriggerContext } from './triggers/run-idempotency.js'
import { createWorkflowTriggerAdapter } from './triggers/workflow-adapter.js'
import { assertMcpExecutable, assertMcpToolAllowed, createMcpServer, mcpEvidence, migrateMcpRegistry, normalizeMcpServer, publicMcpServer, redactDiscoveredTools, reviewMcpServer, safeMcpId } from './mcp/registry.js'
import { normalizeMcpError, requestLocalMcp, requestRemoteMcp } from './mcp/client.js'
import { createLocalModelFactory } from './local-factory/index.js'
import { createLocalFactoryRouter } from './local-factory/router.js'
import { createMacKeychainSecretStore, createSecretReferenceRegistry, normalizeSecretReferenceId } from './secrets/keychain.js'
import { createSecretReferenceRouter } from './secrets/router.js'
import { authorizedHttpHeaders, remoteMcpAuthOptions, validateCredentialSafeHttpUrl } from './secrets/runtime.js'
import { minimalProviderEnvironment } from './secrets/provider-env.js'
import { atomicWriteJsonSync } from './storage/atomic-json.js'
import { governanceAuditDetail, governanceErrorResponse } from './governance/audit.js'
import { assertOrdinaryWorkflowSave, assertWorkflowDelete, assertWorkflowImport, assertWorkflowRestore, createDevelopmentWorkflowCandidate, preserveWorkflowLifecycle } from './governance/mutations.js'
import { createCandidateRecord, createCandidateStore, workflowOperationalEvidence } from './governance/candidates.js'
import { assertExactEvaluationEvidence, createEvaluationRecord, normalizeEvaluationSuite } from './governance/evaluations.js'
import { applyLifecycleTransition, createLifecycleStore, migrateGovernanceLifecycle } from './governance/lifecycle.js'
import { createLocalRequestGuard, requireMutationIntent } from './security/local-request-guard.js'
import { createRedactor } from './security/redaction.js'
import { readFileBeneath, resolvePathBeneath, unlinkFileBeneath, writeFileBeneath } from './security/safe-files.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const requestedData = process.env.ACC_DATA_DIR ? path.resolve(ROOT, process.env.ACC_DATA_DIR) : path.join(ROOT, 'data')
if (requestedData !== ROOT && !requestedData.startsWith(`${ROOT}${path.sep}`)) throw new Error('ACC_DATA_DIR must resolve inside the repository worktree')
const DATA = requestedData
const RUNS_DIR = path.join(DATA, 'runs')
fs.mkdirSync(RUNS_DIR, { recursive: true })
const CUSTOM_NODES_FILE = path.join(DATA, 'custom-nodes.json')
const TRIGGERS_FILE = path.join(DATA, 'workflow-triggers.json')
const TRIGGER_HISTORY_FILE = path.join(DATA, 'workflow-trigger-history.json')
const TRIGGER_INTERNAL_SECRET = crypto.randomBytes(32).toString('hex')
const PLUGINS_FILE = path.join(DATA, 'plugins.json')
const EVALUATIONS_FILE = path.join(DATA, 'evaluations.json')
const GOVERNANCE_CANDIDATES_FILE = path.join(DATA, 'governance-candidates.json')
const GOVERNANCE_LIFECYCLE_FILE = path.join(DATA, 'governance-lifecycle.json')
const LEARNING_FILE = path.join(DATA, 'learning-proposals.json')
const WORKFLOW_CACHE_FILE = path.join(DATA, 'workflow-cache.json')
const IMPORT_PROPOSALS_FILE = path.join(DATA, 'import-proposals.json')
const COMPONENT_IMPORT_PROPOSALS_FILE = path.join(DATA, 'component-import-proposals.json')
const SECRET_REFERENCES_FILE = path.join(DATA, 'secret-references.json')
const governanceCandidates = createCandidateStore({ file: GOVERNANCE_CANDIDATES_FILE })
const governanceLifecycle = createLifecycleStore({ file: GOVERNANCE_LIFECYCLE_FILE })

const HOME = os.homedir()
const requestedBrain = process.env.ACC_BRAIN_DIR ? path.resolve(ROOT, process.env.ACC_BRAIN_DIR) : path.join(HOME, 'AgentBrain')
if (process.env.ACC_BRAIN_DIR && requestedBrain !== ROOT && !requestedBrain.startsWith(`${ROOT}${path.sep}`)) throw new Error('ACC_BRAIN_DIR must resolve inside the repository worktree')
const BRAIN_DIR = requestedBrain
const LMS = path.join(HOME, '.lmstudio', 'bin', 'lms')
const OPENCODE = '/opt/homebrew/bin/opencode'
const LMSTUDIO = 'http://localhost:1234'
const PORT = Number(process.env.PORT) || 1717
const ENV = { ...process.env, PATH: `/opt/homebrew/bin:${path.join(HOME, '.lmstudio', 'bin')}:${process.env.PATH || ''}` }
const KEYCHAIN_ACCOUNT = 'ai-command-center'
const redactionSecretValues = new Set()
if (process.env.NODE_ENV === 'test' && String(process.env.ACC_TEST_REDACTION_CANARY || '').length >= 12) redactionSecretValues.add(String(process.env.ACC_TEST_REDACTION_CANARY))
const { redact: redactReleaseValue } = createRedactor({ secretValues: redactionSecretValues })
const rawSecretReferenceRegistry = createSecretReferenceRegistry({ file: SECRET_REFERENCES_FILE, keychain: createMacKeychainSecretStore({ account: KEYCHAIN_ACCOUNT }) })
const secretReferenceRegistry = {
  ...rawSecretReferenceRegistry,
  put(input) { const saved = rawSecretReferenceRegistry.put(input); redactionSecretValues.add(String(input.value)); return saved },
  resolve(id) { const value = rawSecretReferenceRegistry.resolve(id); redactionSecretValues.add(value); return value },
}
const modelMetadata = new Map()
const globalModelCoordinator = new GlobalModelCoordinator(globalModelPolicyFromEnv(), {
  onWait: (request, snapshot) => updateGlobalRunResources(request, snapshot, 'waiting'),
  onAcquire: (lease, snapshot) => updateGlobalRunResources(lease, snapshot, 'acquired'),
  onRelease: (lease, snapshot) => updateGlobalRunResources(lease, snapshot, 'released'),
  onCancel: (request, snapshot) => updateGlobalRunResources(request, snapshot, 'cancelled'),
})
const providerSecretName = provider => `ai-command-center-provider-${provider}`
function readProviderSecret(provider) { try { const value = execFileSync('/usr/bin/security', ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', providerSecretName(provider), '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (value) redactionSecretValues.add(value); return value } catch { return '' } }
function storeProviderSecret(provider, value) { execFileSync('/usr/bin/security', ['add-generic-password', '-U', '-a', KEYCHAIN_ACCOUNT, '-s', providerSecretName(provider), '-w', String(value)], { stdio: 'ignore' }); redactionSecretValues.add(String(value)); if (readProviderSecret(provider) !== String(value)) throw new Error('Keychain verification failed') }
function deleteProviderSecret(provider) { try { execFileSync('/usr/bin/security', ['delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', providerSecretName(provider)], { stdio: 'ignore' }) } catch {} }
function providerExecutionEnv() {
  return minimalProviderEnvironment(ENV, { openai: readProviderSecret('openai'), anthropic: readProviderSecret('anthropic') })
}

const app = express()
const additionalOrigins = String(process.env.ACC_ALLOWED_LOCAL_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
app.use(createLocalRequestGuard({ port: PORT, allowedOrigins: additionalOrigins }))
app.use(express.json({ limit: '10mb' }))
app.use((_req, res, next) => { const sendJson = res.json.bind(res); res.json = value => sendJson(redactReleaseValue(value)); next() })

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
function writeJson(file, value) { atomicWriteJsonSync(file, value) }
function safeSlug(value, fallback = 'item') { return String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback }

// ---------- agents store ----------
const AGENTS_FILE = path.join(DATA, 'agents.json')
const WORKSPACE = path.join(HOME, 'agents-workspace')

function seedAgents() {
  const seed = [
    { id: 'coder', avatar: '🛠', name: 'Coder', model: 'lmstudio/qwen/qwen3-coder-30b',
      prompt: 'You are an expert software engineer. Write clean, working code. Test what you build.',
      folder: path.join(WORKSPACE, 'coder'), permissions: 'standard', role: 'Software Engineer', department: 'Engineering' },
    { id: 'reasoner', avatar: '🧠', name: 'Reasoner', model: 'lmstudio/openai/gpt-oss-20b',
      prompt: 'You are a careful analyst. Think step by step, verify claims, point out flaws.',
      folder: path.join(WORKSPACE, 'reasoner'), permissions: 'standard', role: 'Strategic Analyst', department: 'Research' },
    { id: 'quick', avatar: '⚡', name: 'Quick', model: 'lmstudio/qwen/qwen3-30b-a3b-2507',
      prompt: 'You are a fast general assistant. Be concise and get things done.',
      folder: path.join(WORKSPACE, 'quick'), permissions: 'standard', role: 'General Assistant', department: 'General Operations' },
  ]
  atomicWriteJsonSync(AGENTS_FILE, seed)
  return seed
}
function loadAgents() {
  try { return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')) } catch { return seedAgents() }
}
function saveAgents(list) { atomicWriteJsonSync(AGENTS_FILE, list) }

// mirror each Command Center agent as a native OpenCode agent file.
// Unspecified agents receive the scoped standard preset; unrestricted access must be explicit.
const OC_AGENT_DIR = path.join(HOME, '.config', 'opencode', 'agent')
const SKIP_AGENT_MIRROR = process.env.ACC_SKIP_AGENT_MIRROR === '1'
if (!SKIP_AGENT_MIRROR) fs.mkdirSync(OC_AGENT_DIR, { recursive: true })
function ocAgentName(agent) { return 'cc-' + agent.id }
// permission presets — plain-language safety levels
const PERM_PRESETS = {
  full: { edit: 'allow', bash: 'allow', webfetch: 'allow', external_directory: 'allow' },
  standard: { edit: 'allow', bash: 'allow', webfetch: 'allow', external_directory: 'deny' },
  readonly: { edit: 'deny', bash: 'deny', webfetch: 'allow', external_directory: 'deny' },
}
const PERM_SUMMARY = {
  full: 'Full access — can read/write/delete anywhere and run any command. (Owner default on this machine.)',
  standard: 'Works only inside its own project folder. Can run commands and browse, but cannot touch other folders.',
  readonly: 'Can read and look things up, but cannot change files or run commands. Safest.',
}
function writeOcAgent(agent) {
  const p = PERM_PRESETS[agent.permissions] || PERM_PRESETS.standard
  const permBlock = Object.entries(p).map(([k, v]) => `  ${k}: ${v}`).join('\n')
  // inject any attached skill playbooks into the system prompt
  let skillsBlock = ''
  if (Array.isArray(agent.skills) && agent.skills.length) {
    const parts = []
    for (const rel of agent.skills) { try { parts.push(readFileBeneath(BRAIN_DIR, rel, 'utf8')) } catch {} }
    if (parts.length) skillsBlock = '\n\n## Skills you have (follow these playbooks when relevant)\n\n' + parts.join('\n\n---\n\n')
  }
  const md = `---
description: ${agent.name} (AI Command Center)
mode: primary
model: ${agent.model}
permission:
${permBlock}
---
${agent.prompt || 'You are a helpful agent.'}

Your name is ${agent.name}. Your shared brain is ~/AgentBrain/ — follow 00-Rules, use 10-Skills playbooks when one matches, and append reusable learnings to 30-Memory/${agent.id}.md.${skillsBlock}
`
  fs.writeFileSync(path.join(OC_AGENT_DIR, ocAgentName(agent) + '.md'), md)
}
// ---- audit log ----
const AUDIT_LOG = path.join(DATA, 'audit.log')
function appendAudit(action, detail) {
  try { fs.appendFileSync(AUDIT_LOG, JSON.stringify(redactReleaseValue({ t: Date.now(), action, detail })) + '\n') }
  catch { process.stderr.write('[audit] durable audit write failed\n') }
}
function removeOcAgent(id) {
  try { fs.unlinkSync(path.join(OC_AGENT_DIR, 'cc-' + id + '.md')) } catch {}
}
// sync all on boot
if (!SKIP_AGENT_MIRROR) for (const a of loadAgents()) writeOcAgent(a)

// durability: on startup, any run left 'running'/'paused' from a prior crash/restart
// can't be resumed mid-step (the opencode process is gone) — mark it interrupted, honestly.
const interruptedWorkflowRuns = []
;(function reconcileStaleRuns() {
  try {
    for (const f of fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json'))) {
      const p = path.join(RUNS_DIR, f)
      try {
        const r = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (r.status === 'running' || r.status === 'paused') { r.status = 'interrupted'; r.ended = r.ended || Date.now(); r.globalModelLeases = []; if (r.globalModelScheduling) r.globalModelScheduling = { ...r.globalModelScheduling, active: 0, queued: 0, activeEstimatedBytes: 0, queuedEstimatedBytes: 0, activeUnknownEstimates: 0, queuedUnknownEstimates: 0 }; if (r.type === 'workflow' && r.workflowId) interruptedWorkflowRuns.push(r.id || f.replace(/\.json$/, '')); atomicWriteJsonSync(p, r) }
      } catch {}
    }
  } catch {}
})()

// ---------- system info ----------
function df() {
  return new Promise(resolve => {
    execFile('df', ['-k', '/'], (e, out) => {
      if (e) return resolve({ totalGB: 0, freeGB: 0 })
      const parts = out.trim().split('\n').pop().split(/\s+/)
      resolve({ totalGB: Math.round(+parts[1] / 1048576), freeGB: Math.round(+parts[3] / 1048576) })
    })
  })
}
async function lmstudioModels() {
  const r = await fetch(`${LMSTUDIO}/api/v0/models`, { signal: AbortSignal.timeout(2000) })
  const d = await r.json()
  const models = (d.data || []).filter(m => m.type === 'llm')
  for (const model of models) modelMetadata.set(model.id, model)
  return models
}
async function systemInfo() {
  const totalRam = os.totalmem()
  const freeRam = os.freemem()
  const disk = await df()
  let lmstudio = false, models = []
  try { models = await lmstudioModels(); lmstudio = true } catch {}
  let opencode = false
  try { opencode = fs.existsSync(OPENCODE) } catch {}
  let comfy = false
  try { comfy = await comfyUp() } catch {}
  return {
    ram: { totalGB: Math.round(totalRam / 1073741824), usedGB: Math.round((totalRam - freeRam) / 1073741824) },
    disk,
    services: { lmstudio, opencode, comfy },
    loaded: models.filter(m => m.state === 'loaded').map(m => ({ id: m.id, context: m.loaded_context_length || m.max_context_length, estimatedBytes: explicitModelBytes(m) })),
    modelScheduling: {
      ...globalModelCoordinator.snapshot(),
      loadedKnownEstimatedBytes: models.filter(m => m.state === 'loaded').reduce((sum, model) => sum + (explicitModelBytes(model) || 0), 0),
      loadedUnknownEstimates: models.filter(m => m.state === 'loaded' && !explicitModelBytes(m)).length,
    },
    modelCount: models.length,
    activeRuns: [...runs.values()].filter(r => r.status === 'running').length,
    downloads: Object.fromEntries(Object.entries(downloads).map(([k, v]) => [k, { status: v.status, pct: v.pct }])),
  }
}

app.get('/api/system', async (_req, res) => res.json(await systemInfo()))

// SSE: live system ticks
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  let alive = true
  const tick = async () => {
    if (!alive) return
    try { res.write(`data: ${JSON.stringify(await systemInfo())}\n\n`) } catch {}
  }
  tick()
  const iv = setInterval(tick, 2500)
  req.on('close', () => { alive = false; clearInterval(iv) })
})

// ---------- models ----------
app.get('/api/models', async (_req, res) => {
  try {
    const models = await lmstudioModels()
    res.json(models.map(m => ({
      id: m.id, state: m.state, arch: m.arch, quant: m.quantization,
      maxContext: m.max_context_length, loadedContext: m.loaded_context_length || null,
      estimatedBytes: explicitModelBytes(m),
      downloading: downloads[m.id]?.status === 'downloading',
    })))
  } catch { res.status(502).json({ error: 'LM Studio not reachable on ' + LMSTUDIO }) }
})

function runLms(args, cb) {
  execFile(LMS, args, { env: ENV, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, cb)
}
app.post('/api/models/load', (req, res) => {
  const { id, context } = req.body
  const args = ['load', id, '--gpu', 'max', '--yes']
  if (context) args.push('--context-length', String(context))
  runLms(args, (e, _o, err) => e ? res.status(500).json({ error: String(err || e) }) : res.json({ ok: true }))
})
app.post('/api/models/unload', (req, res) => {
  runLms(['unload', req.body.id], (e, _o, err) => e ? res.status(500).json({ error: String(err || e) }) : res.json({ ok: true }))
})

// downloads: name -> {status, pct, proc}
const downloads = {}
app.post('/api/models/download', (req, res) => {
  const name = (req.body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })
  if (downloads[name]?.status === 'downloading') return res.json({ ok: true, already: true })
  const proc = spawn(LMS, ['get', name, '--yes', '--mlx'], { env: ENV })
  downloads[name] = { status: 'downloading', pct: 0, proc }
  const onData = c => {
    const m = String(c).match(/(\d+(?:\.\d+)?)%/g)
    if (m) downloads[name].pct = parseFloat(m[m.length - 1])
  }
  proc.stdout.on('data', onData); proc.stderr.on('data', onData)
  proc.on('exit', code => { downloads[name].status = code === 0 ? 'done' : 'failed'; downloads[name].pct = code === 0 ? 100 : downloads[name].pct })
  res.json({ ok: true })
})

// ---------- chat (streaming proxy) ----------
app.post('/api/chat', async (req, res) => {
  const signal = modelRequestSignal(req, res)
  try {
    await withGlobalModel(null, req.body.model, 'chat', async () => {
      const r = await fetch(`${LMSTUDIO}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ model: req.body.model, messages: req.body.messages, stream: true, temperature: 0.7 }),
      })
      if (!r.ok) throw new Error(await r.text())
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content
            if (delta) res.write(delta)
          } catch {}
        }
      }
      res.end()
    }, signal)
  } catch (e) { if (!res.headersSent) res.status(502).send('Chat failed: ' + e.message); else res.end() }
})

// ---------- agents ----------
app.get('/api/agents', (_req, res) => res.json(loadAgents()))
app.post('/api/agents', (req, res) => {
  const list = loadAgents()
  const a = req.body
  if (!a.name || !a.model) return res.status(400).json({ error: 'name and model required' })
  a.id = a.id || a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  a.folder = a.folder || path.join(WORKSPACE, a.id)
  const i = list.findIndex(x => x.id === a.id)
  if (i >= 0) list[i] = a; else list.push(a)
  saveAgents(list)
  writeOcAgent(a)
  res.json(a)
})
app.delete('/api/agents/:id', (req, res) => {
  saveAgents(loadAgents().filter(a => a.id !== req.params.id))
  removeOcAgent(req.params.id)
  res.json({ ok: true })
})

// ---------- agent runs ----------
const runs = new Map() // runId -> {agentId, task, status, events:[], listeners:Set, started}

function terminateProcess(proc, signal = 'SIGTERM') {
  if (!proc) return
  try { if (proc.commandCenterProcessGroup && proc.pid) process.kill(-proc.pid, signal); else proc.kill(signal) } catch {}
}

function pushEvent(run, type, text, nodeId) {
  const ev = redactReleaseValue({ t: Date.now(), type, text })
  if (nodeId) ev.nodeId = nodeId
  run.events.push(ev)
  for (const l of run.listeners) { try { l.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {} }
  if (run.type === 'workflow' && run.id && nodeId && (type === 'done' || type === 'error')) { try { persistRun(run.id, run) } catch {} }
}
function modelEstimate(modelRef) {
  return explicitModelBytes(modelMetadata.get(String(modelRef || '').replace(/^lmstudio\//, '')))
}
function updateGlobalRunResources(request, snapshot, action) {
  const run = request.runId ? runs.get(request.runId) : null
  if (!run) return
  run.globalModelScheduling = snapshot
  run.globalModelLeases ||= []
  if (action === 'acquired') run.globalModelLeases.push({ id: request.id, nodeId: request.nodeId || null, estimatedBytes: request.estimatedBytes || null, acquiredAt: request.acquiredAt })
  if (action === 'released') run.globalModelLeases = run.globalModelLeases.filter(lease => lease.id !== request.id)
  pushEvent(run, 'info', `${action === 'waiting' ? '⌛' : action === 'acquired' ? '◆' : action === 'released' ? '◇' : '⏹'} ${request.nodeId || 'run'} global model capacity ${action}`, request.nodeId)
  try { persistRun(request.runId, run) } catch {}
}
function withGlobalModel(run, modelRef, nodeId, operation, signal = run?.modelAbortController?.signal) {
  return globalModelCoordinator.withModel({
    modelId: String(modelRef || '').replace(/^lmstudio\//, '') || null,
    runId: run?.id || null,
    nodeId,
    estimatedBytes: modelEstimate(modelRef),
    signal,
  }, operation)
}
function modelRequestSignal(req, res) {
  const controller = new AbortController()
  req.once('aborted', () => controller.abort(new Error('client disconnected')))
  res.once('close', () => { if (!res.writableEnded) controller.abort(new Error('client disconnected')) })
  return controller.signal
}
function persistRun(runId, run) {
  const { listeners, proc, procs, controllers, resourceCoordinator, modelAbortController, ...rest } = run
  atomicWriteJsonSync(path.join(RUNS_DIR, runId + '.json'), redactReleaseValue({ id: runId, ...rest }))
}

function cancelActiveRun(run, reason = 'run stopped', seen = new Set()) {
  if (!run || seen.has(run.id)) return
  seen.add(run.id)
  run.cancelled = true; run.paused = false
  terminateProcess(run.proc)
  for (const proc of run.procs || []) terminateProcess(proc)
  for (const controller of run.controllers || []) { try { controller.abort(new Error(reason)) } catch {} }
  try { run.modelAbortController?.abort(new Error(reason)) } catch {}
  run.resourceCoordinator?.cancelAll(reason)
  for (const childRunId of run.childRunIds || []) cancelActiveRun(runs.get(childRunId), reason, seen)
}

function pauseActiveRun(run, paused, seen = new Set()) {
  if (!run || seen.has(run.id) || run.status !== 'running' || run.type !== 'workflow') return
  seen.add(run.id)
  run.paused = !!paused
  run.resourceCoordinator?.setPaused(paused)
  for (const childRunId of run.childRunIds || []) pauseActiveRun(runs.get(childRunId), paused, seen)
}

// agents need a big context window — OpenCode's system prompt alone overflows small ones
const MIN_AGENT_CONTEXT = 65536
async function ensureModelReady(run, ocModel) {
  const id = ocModel.replace(/^lmstudio\//, '')
  try {
    const models = await lmstudioModels()
    const m = models.find(x => x.id === id)
    if (!m) return // unknown to LM Studio — let opencode handle it
    const ctx = m.loaded_context_length || 0
    if (m.state === 'loaded' && ctx >= MIN_AGENT_CONTEXT) return
    pushEvent(run, 'info', `⏳ Preparing model ${id} (loading with ${MIN_AGENT_CONTEXT.toLocaleString()} context)…`)
    if (m.state === 'loaded') await new Promise(r => runLms(['unload', id], () => r()))
    const target = Math.min(MIN_AGENT_CONTEXT * 2, m.max_context_length || MIN_AGENT_CONTEXT)
    await new Promise((resolve, reject) => runLms(['load', id, '--gpu', 'max', '--yes', '--context-length', String(target)],
      e => e ? reject(e) : resolve()))
    pushEvent(run, 'info', `✓ Model ready (context ${target.toLocaleString()})`)
  } catch (e) {
    pushEvent(run, 'info', `⚠ Model prepare warning: ${e?.message || e} — continuing anyway`)
  }
}

app.post('/api/agents/:id/run', async (req, res) => {
  const agent = loadAgents().find(a => a.id === req.params.id)
  if (!agent) return res.status(404).json({ error: 'no such agent' })
  const task = (req.body.task || '').trim()
  if (!task) return res.status(400).json({ error: 'task required' })

  fs.mkdirSync(agent.folder, { recursive: true })
  writeOcAgent(agent) // keep the native agent file in sync
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex')
  const run = { id: runId, type: 'agent', agentId: agent.id, agentName: agent.name, avatar: agent.avatar, task, status: 'running', dir: agent.folder, events: [], listeners: new Set(), modelAbortController: new AbortController(), started: Date.now() }
  runs.set(runId, run)
  persistRun(runId, run) // persist at start (durability)
  pushEvent(run, 'info', `▶ ${agent.avatar} ${agent.name} started — model ${agent.model} — folder ${agent.folder}`)
  res.json({ runId }) // respond immediately; model prep streams into the feed

  let releaseGlobalModel
  try {
    await lmstudioModels().catch(() => [])
    releaseGlobalModel = await globalModelCoordinator.acquire({ modelId: agent.model.replace(/^lmstudio\//, ''), runId, nodeId: 'agent', estimatedBytes: modelEstimate(agent.model), signal: run.modelAbortController.signal })
    await ensureModelReady(run, agent.model)
    if (run.cancelled || run.modelAbortController.signal.aborted) throw new DOMException('run stopped', 'AbortError')
  } catch (error) {
    releaseGlobalModel?.()
    run.status = run.cancelled || error?.name === 'AbortError' ? 'cancelled' : 'failed'
    run.ended = Date.now()
    pushEvent(run, run.status === 'failed' ? 'error' : 'info', run.status === 'failed' ? `✘ Model scheduling failed: ${error.message}` : '⏹ Cancelled before model execution')
    persistRun(runId, run)
    for (const listener of run.listeners) { try { listener.end() } catch {} }
    return
  }
  // task goes through the native agent (role prompt in system slot, permissions allowed);
  // stdin must be closed ('ignore') — with an open pipe, opencode waits on it forever
  // env.PWD must match cwd — opencode trusts $PWD for its project root
  const proc = spawn(OPENCODE, ['run', task, '--agent', ocAgentName(agent)], { cwd: agent.folder, env: { ...providerExecutionEnv(), PWD: agent.folder }, stdio: ['ignore', 'pipe', 'pipe'] })
  run.proc = proc
  let buf = ''
  const onData = chunk => {
    buf += String(chunk)
    const lines = buf.split('\n'); buf = lines.pop()
    for (const raw of lines) {
      const line = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trimEnd() // strip ANSI
      if (line.trim()) pushEvent(run, 'log', line)
    }
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  proc.on('exit', code => {
    releaseGlobalModel?.()
    run.status = run.cancelled ? 'cancelled' : code === 0 ? 'done' : 'failed'
    run.ended = Date.now()
    pushEvent(run, run.status === 'done' ? 'done' : run.status === 'cancelled' ? 'info' : 'error', run.status === 'done' ? '✔ Task complete' : run.status === 'cancelled' ? '⏹ Task cancelled' : `✘ Exited with code ${code}`)
    persistRun(runId, run)
    for (const l of run.listeners) { try { l.end() } catch {} }
  })
  proc.on('error', error => {
    releaseGlobalModel?.()
    run.status = 'failed'; run.ended = Date.now()
    pushEvent(run, 'error', `✘ Agent could not start: ${error.message}`)
    persistRun(runId, run)
  })
})

app.get('/api/runs/:id/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const run = runs.get(req.params.id)
  if (!run) {
    // finished in a past server life — replay from disk
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, req.params.id + '.json'), 'utf8'))
      for (const ev of saved.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
    } catch {}
    return res.end()
  }
  for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
  if (run.status !== 'running') return res.end()
  run.listeners.add(res)
  req.on('close', () => run.listeners.delete(res))
})

app.post('/api/runs/:id/stop', (req, res) => {
  const run = runs.get(req.params.id)
  if (run && run.status === 'running') {
    cancelActiveRun(run)
    pushEvent(run, 'info', '⏹ Cancelling…')
    if (run.type === 'agent') { run.status = 'cancelled'; run.ended = Date.now() } // agent = single proc; killing ends it
  }
  res.json({ ok: true })
})
app.post('/api/runs/:id/pause', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run || run.status !== 'running' || run.type !== 'workflow') return res.status(404).json({ error: 'active workflow run not found' })
  try {
    const commandId = String(req.body?.commandId || `pause-${run.id}-${run.control?.manualPause?.generation || 0}`)
    const changed = setManualPause(run.control || createRunControl(), { paused: true, commandId, expectedGeneration: req.body?.expectedGeneration })
    run.control = changed.control
    pauseActiveRun(run, true)
    pushEvent(run, 'info', '⏸ Paused — will hold before the next step')
    persistRun(run.id, run)
    res.json({ ok: true, paused: true, receipt: changed.receipt, replay: changed.replay })
  } catch (error) { res.status(error.code === 'STALE_PAUSE_GENERATION' ? 412 : 409).json({ error: error.message, code: error.code || 'PAUSE_FAILED' }) }
})
app.post('/api/runs/:id/resume', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run || run.status !== 'running' || run.type !== 'workflow') return res.status(404).json({ error: 'active workflow run not found' })
  try {
    const commandId = String(req.body?.commandId || `resume-${run.id}-${run.control?.manualPause?.generation || 0}`)
    const changed = setManualPause(run.control || createRunControl(), { paused: false, commandId, expectedGeneration: req.body?.expectedGeneration })
    run.control = changed.control
    pauseActiveRun(run, false)
    pushEvent(run, 'info', '▶ Resumed')
    persistRun(run.id, run)
    res.json({ ok: true, paused: false, receipt: changed.receipt, replay: changed.replay })
  } catch (error) { res.status(error.code === 'STALE_PAUSE_GENERATION' ? 412 : 409).json({ error: error.message, code: error.code || 'RESUME_FAILED' }) }
})
// full detail of one run (transcript + result + artifacts)
app.get('/api/runs/:id/detail', (req, res) => {
  let run = runs.get(req.params.id)
  let rec
  if (run) { const { listeners, proc, ...rest } = run; rec = { id: req.params.id, ...rest } }
  else { try { rec = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, req.params.id + '.json'), 'utf8')) } catch { return res.status(404).json({ error: 'not found' }) } }
  // list artifact files in the run's working dir
  let artifacts = []
  if (rec.dir) { try { artifacts = fs.readdirSync(rec.dir, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink()).map(entry => { const st = fs.lstatSync(path.join(rec.dir, entry.name)); return { name: entry.name, size: st.size, isDir: st.isDirectory() } }) } catch {} }
  res.json({ ...rec, artifacts })
})
function runEvidenceDto(rec, artifacts = []) {
  const nodes = Object.fromEntries(Object.entries(rec.checkpoint?.nodes || {}).map(([nodeId, node]) => [nodeId, {
    state: node.state,
    attemptsStarted: node.attemptsStarted,
    inputHash: node.inputHash || null,
    outputHash: node.outputHash || null,
    effect: node.effect ? { operationKey: node.effect.operationKey, requestHash: node.effect.requestHash, state: node.effect.state, receiptRef: node.effect.receiptRef || null } : null,
    wait: node.wait ? { kind: node.wait.kind, ref: node.wait.ref } : null,
  }]))
  const approvals = Object.values(rec.control?.approvals || {}).map(item => ({ id: item.id, nodeId: item.nodeId, subjectHash: item.subjectHash, revision: item.revision, state: item.state, requestedAtEpochMs: item.requestedAtEpochMs, decidedAtEpochMs: item.decision?.decidedAtEpochMs || null }))
  const evidence = redactReleaseValue({
    schemaVersion: 1,
    run: { id: rec.id, logicalRunId: rec.logicalRunId || rec.id, workflowId: rec.workflowId || null, workflowVersion: rec.workflowVersion || null, workflowVersionHash: rec.checkpoint?.workflowVersionHash || null, status: rec.status, started: rec.started || null, ended: rec.ended || null, resumedFrom: rec.resumedFrom || null, recoveredBy: rec.recoveredBy || null },
    triggerReceipt: rec.checkpoint?.triggerReceipt || null,
    manualPause: rec.control?.manualPause ? { paused: rec.control.manualPause.paused, generation: rec.control.manualPause.generation } : null,
    approvals,
    checkpoint: { schemaVersion: rec.checkpoint?.schemaVersion || null, revision: rec.checkpoint?.revision || null, nodes },
    events: (rec.events || []).map(event => ({ t: event.t, type: event.type, nodeId: event.nodeId || null, text: event.text })),
    artifacts: artifacts.map(item => ({ name: item.name, size: item.size, isDir: !!item.isDir })),
  })
  return { ...evidence, evidenceId: crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex') }
}
app.get('/api/runs/:id/evidence', (req, res) => {
  let rec = runs.get(req.params.id)
  if (rec) { const { listeners, proc, procs, controllers, resourceCoordinator, modelAbortController, ...rest } = rec; rec = { id: req.params.id, ...rest } }
  else { try { rec = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, req.params.id + '.json'), 'utf8')) } catch { return res.status(404).json({ error: 'not found' }) } }
  let artifacts = []
  if (rec.dir) { try { artifacts = fs.readdirSync(rec.dir, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink()).map(entry => { const st = fs.lstatSync(path.join(rec.dir, entry.name)); return { name: entry.name, size: st.size, isDir: st.isDirectory() } }) } catch {} }
  res.set('Cache-Control', 'no-store').json(runEvidenceDto(rec, artifacts))
})
// read a single artifact file's text (path-guarded to run dirs)
app.get('/api/runs/:id/artifact', (req, res) => {
  let rec = runs.get(req.params.id); if (rec) { const { listeners, proc, ...r } = rec; rec = r }
  else { try { rec = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, req.params.id + '.json'), 'utf8')) } catch { return res.status(404).end() } }
  if (!rec.dir) return res.status(404).end()
  try { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.send(redactReleaseValue(readFileBeneath(rec.dir, req.query.name, 'utf8'))) }
  catch (error) { res.status(error?.code === 'UNSAFE_FILESYSTEM_PATH' ? 400 : 404).end() }
})

function runSummary(id, r) {
  return { id, type: r.type || (r.workflowName ? 'workflow' : 'agent'), title: r.workflowName || r.agentName || 'Run',
    agentName: r.agentName, avatar: r.avatar || (r.workflowName ? '⛓' : '🤖'), task: r.task, status: r.status, started: r.started, ended: r.ended,
    workflowId: r.workflowId || null, workflowVersion: r.workflowVersion || null, candidateId: r.candidateId || null, environment: r.environment || null }
}
app.get('/api/runs', (_req, res) => {
  const seen = new Set()
  const hist = []
  for (const [id, r] of runs) if (r.status === 'running' || r.paused) { hist.push(runSummary(id, r)); seen.add(id) } // live first
  const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 80)
  for (const f of files) {
    const id = f.replace(/\.json$/, ''); if (seen.has(id)) continue
    try { hist.push(runSummary(id, JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')))) } catch {}
  }
  res.json(hist)
})
app.get('/api/company-world/state', async (_req, res) => {
  const agents = loadAgents().map(agent => ({ id: agent.id, name: agent.name, avatar: agent.avatar || '🤖', role: agent.role || agent.name, department: agent.department || 'General Operations', model: agent.model, permissions: agent.permissions || 'standard', skills: agent.skills || [] }))
  const activeRuns = [...runs.entries()].filter(([, run]) => run.status === 'running' || run.paused).map(([id, run]) => { const latest = [...(run.events || [])].reverse().find(event => event.nodeId || event.type === 'info' || event.type === 'log'); return { id, type: run.type, workflowId: run.workflowId || null, workflowName: run.workflowName || null, agentId: run.agentId || null, agentName: run.agentName || null, status: run.paused ? 'paused' : run.status, task: run.task, currentNodeId: latest?.nodeId || null, activity: latest?.text || 'Waiting', started: run.started } })
  const workflows = fs.readdirSync(WF_DIR).filter(file => file.endsWith('.json')).map(file => readJson(path.join(WF_DIR, file), null)).filter(Boolean).map(workflow => ({ id: workflow.id, name: workflow.name, project: workflow.project || 'Command Center', environment: workflow.environment || 'development', nodeCount: workflow.nodes?.length || 0 }))
  const departments = [...new Set(agents.map(agent => agent.department))].map((name, index) => ({ id: safeSlug(name), name, color: ['#8b7cf6','#42b9d0','#44b974','#f0a34a'][index % 4], agentIds: agents.filter(agent => agent.department === name).map(agent => agent.id) }))
  const resources = await systemInfo()
  res.json({ generatedAt: Date.now(), agents, departments, activeRuns, workflows, resources: { ram: resources.ram, disk: resources.disk, loadedModels: resources.loaded, modelScheduling: resources.modelScheduling, services: resources.services } })
})

// Artifact Center — files produced by runs, with provenance
app.get('/api/artifacts', (_req, res) => {
  const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 60)
  const arts = []
  for (const f of files) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')) } catch { continue }
    if (!r.dir) continue
    let entries = []
    try { entries = fs.readdirSync(r.dir, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink() && entry.isFile()).map(entry => entry.name) } catch {}
    for (const name of entries) {
      const st = fs.lstatSync(path.join(r.dir, name))
      arts.push({ runId: r.id || f.replace(/\.json$/, ''), name, size: st.size, mtime: st.mtimeMs,
        source: r.workflowName || r.agentName || 'Run', type: r.type || 'run', status: r.status })
    }
  }
  arts.sort((a, b) => b.mtime - a.mtime)
  res.json(arts.slice(0, 120))
})

// ---------- governance: emergency stop, audit, permission info ----------
app.post('/api/killall', requireMutationIntent('emergency-stop'), (_req, res) => {
  let killed = 0
  for (const [, r] of runs) if (r.status === 'running' || r.paused) { r.cancelled = true; r.paused = false; r.resourceCoordinator?.cancelAll('emergency stop'); try { r.modelAbortController?.abort(new Error('emergency stop')) } catch {}; terminateProcess(r.proc, 'SIGKILL'); for (const proc of r.procs || []) terminateProcess(proc, 'SIGKILL'); for (const controller of r.controllers || []) { try { controller.abort() } catch {} } if (r.type === 'agent') { r.status = 'cancelled'; r.ended = Date.now() } killed++ }
  try { execFile('pkill', ['-9', '-f', 'opencode run'], () => {}) } catch {}
  appendAudit('killall', { runs: killed })
  res.json({ ok: true, stopped: killed })
})
app.get('/api/audit', (_req, res) => {
  let lines = []
  try { lines = fs.readFileSync(AUDIT_LOG, 'utf8').trim().split('\n').filter(Boolean).slice(-120).reverse().map(l => JSON.parse(l)) } catch {}
  res.json(lines)
})
app.get('/api/permissions', (_req, res) => res.json(Object.entries(PERM_SUMMARY).map(([key, summary]) => ({ key, summary }))))

// ---------- skills library (backed by AgentBrain/10-Skills) ----------
const SKILLS_REL = '10-Skills'
app.get('/api/skills', (_req, res) => {
  const dir = path.join(HOME, 'AgentBrain', SKILLS_REL)
  let out = []
  try {
    out = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
      const content = fs.readFileSync(path.join(dir, f), 'utf8')
      const firstLine = (content.split('\n').find(l => l.trim()) || f).replace(/^#\s*/, '')
      return { path: `${SKILLS_REL}/${f}`, name: f.replace(/\.md$/, ''), title: firstLine.slice(0, 80), preview: content.replace(/^#.*\n/, '').trim().slice(0, 180) }
    })
  } catch {}
  res.json(out)
})

// ---------- tools & MCP ----------
const BUILTIN_TOOLS = [
  { key: 'filesystem', name: 'Files', desc: 'Read and write files in the working folder', status: 'connected' },
  { key: 'terminal', name: 'Terminal', desc: 'Run shell commands', status: 'connected' },
  { key: 'web', name: 'Web fetch', desc: 'Fetch pages from the internet', status: 'connected' },
]
app.get('/api/tools', (_req, res) => {
  const mcp = Object.values(readMcpRegistry()).map(publicMcpServer)
  res.json({ builtin: BUILTIN_TOOLS, mcp })
})
app.post('/api/tools/mcp', (req, res) => {
  try {
    const id = safeMcpId(req.body.id || req.body.name)
    const cfg = readOcConfig(); const { registry } = migrateMcpRegistry(cfg.mcp)
    if (registry[id]) return res.status(409).json({ error: `MCP server "${id}" already exists; overwrite is not allowed` })
    const server = createMcpServer(id, { ...req.body, ...(req.body.url ? { type: 'remote' } : { type: 'local' }) })
    cfg.mcp = { ...registry, [id]: server }; writeOcConfig(cfg)
    appendAudit('mcp_added', { id, type: server.type, reviewStatus: server.review.status })
    res.status(201).json({ ok: true, server: publicMcpServer(server), reviewRequired: server.review.status === 'required' })
  } catch (error) { res.status(400).json({ error: error.message }) }
})
app.put('/api/tools/mcp/:name', (req, res) => {
  try {
    const id = safeMcpId(req.params.name)
    const cfg = readOcConfig(); const { registry } = migrateMcpRegistry(cfg.mcp); const current = registry[id]
    if (!current) return res.status(404).json({ error: 'MCP server not found' })
    const definitionChanged = req.body.command != null || req.body.url != null || req.body.type != null || req.body.authRef != null || req.body.authMode != null || req.body.headers != null || req.body.env != null
    let next = normalizeMcpServer(id, { ...current, ...req.body }, { existing: !definitionChanged })
    if (definitionChanged) next = createMcpServer(id, next)
    if (req.body.reviewed != null) next = reviewMcpServer(next, { approved: req.body.reviewed === true })
    if (req.body.enabled === true && next.type === 'local' && !['trusted-local', 'trusted-legacy'].includes(next.trustStatus)) throw new Error('local MCP server must be explicitly reviewed before it can be enabled')
    if (req.body.enabled != null && !definitionChanged) next.enabled = !!req.body.enabled
    cfg.mcp = { ...registry, [id]: next }; writeOcConfig(cfg)
    appendAudit('mcp_updated', { id, enabled: next.enabled, trustStatus: next.trustStatus, definitionChanged })
    res.json({ ok: true, server: publicMcpServer(next) })
  } catch (error) { res.status(400).json({ error: error.message }) }
})
app.post('/api/tools/mcp/:name/discover', async (req, res) => {
  try {
    const id = safeMcpId(req.params.name)
    const discovery = await discoverMcp(id, Math.max(1000, Math.min(60000, Number(req.body.timeoutMs || 10000))))
    const cfg = readOcConfig(); const { registry } = migrateMcpRegistry(cfg.mcp); const current = registry[id]
    if (!current) return res.status(404).json({ error: 'MCP server not found' })
    const tools = redactDiscoveredTools(discovery.tools, { serverId: id, serverName: discovery.serverInfo?.name, serverVersion: discovery.serverInfo?.version, transport: current.type })
    cfg.mcp = { ...registry, [id]: { ...current, discoveredTools: tools, discovery: { protocolVersion: '2025-03-26', serverName: String(discovery.serverInfo?.name || '').slice(0, 200), serverVersion: String(discovery.serverInfo?.version || '').slice(0, 100), discoveredAt: Date.now() } } }
    writeOcConfig(cfg); appendAudit('mcp_discovered', { id, toolCount: tools.length })
    res.json({ server: id, tools })
  }
  catch (error) { res.status(502).json({ error: error.message }) }
})
app.delete('/api/tools/mcp/:name', (req, res) => {
  try { const id = safeMcpId(req.params.name); const cfg = readOcConfig(); const { registry } = migrateMcpRegistry(cfg.mcp); if (registry[id]) { delete registry[id]; cfg.mcp = registry; writeOcConfig(cfg); appendAudit('mcp_deleted', { id }) }; res.json({ ok: true }) }
  catch (error) { res.status(400).json({ error: error.message }) }
})

// ---------- studio (ComfyUI image generation) ----------
const COMFY = 'http://localhost:8188'
const COMFY_CKPT = path.join(HOME, 'ComfyUI', 'models', 'checkpoints')
const COMFY_OUT = path.join(HOME, 'ComfyUI', 'output')

function modelType(name) { return /flux/i.test(name) ? 'flux' : 'sdxl' }

async function comfyUp() {
  try { const r = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false }
}

// friendly label + description + tags per model (matched on filename)
function modelMeta(name) {
  const n = name.toLowerCase()
  if (n.includes('schnell')) return { label: 'Flux Schnell', desc: 'Fastest — solid general images in seconds.', tags: ['⚡ Fast', 'General', '✅ Filtered'] }
  if (n.includes('flux1-dev') || n.includes('flux-dev')) return { label: 'Flux Dev', desc: 'High-quality photorealism, slower than Schnell.', tags: ['📷 Photoreal', '★ Quality', '✅ Filtered'] }
  if (n.includes('juggernaut')) return { label: 'Juggernaut XL', desc: 'Photorealistic people & scenes. Uncensored.', tags: ['📷 Photoreal', '🔞 Uncensored'] }
  if (n.includes('autismmix')) return { label: 'AutismMix', desc: 'Semi-real / anime art, very flexible. Uncensored. (Pony-based)', tags: ['🎨 Art/Anime', '🔞 Uncensored', 'Pony'] }
  if (n.includes('pony')) return { label: 'Pony Diffusion V6', desc: 'Any pose/style, massive LoRA ecosystem. Uncensored.', tags: ['🎨 Versatile', '🔞 Uncensored', 'Pony'] }
  if (n.includes('persephone')) return { label: 'Persephone', desc: 'Flux-based photorealism. Uncensored NSFW.', tags: ['📷 Photoreal', '🔞 Uncensored', 'Flux'] }
  if (n.includes('fluxedup') || n.includes('fluxed-up')) return { label: 'Fluxed Up', desc: 'Deep Flux NSFW fine-tune — realistic skin/anatomy, no filters.', tags: ['📷 Photoreal', '🔞 Uncensored', 'Flux'] }
  if (n.includes('chroma')) return { label: 'Chroma', desc: 'Uncensored open base model.', tags: ['🔞 Uncensored'] }
  return { label: name.replace(/\.safetensors$/, ''), desc: 'Custom model.', tags: [] }
}
// robust completeness: a safetensors file is complete when its size >= header + max tensor offset
function isComplete(file) {
  try {
    const fp = path.join(COMFY_CKPT, file)
    const fd = fs.openSync(fp, 'r')
    try {
      const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0)
      const n = Number(b.readBigUInt64LE(0))
      if (n <= 0 || n > 50e6) return false
      const hdr = Buffer.alloc(n); fs.readSync(fd, hdr, 0, n, 8)
      const meta = JSON.parse(hdr.toString('utf8'))
      let maxEnd = 0
      for (const k in meta) { if (k === '__metadata__') continue; const o = meta[k].data_offsets; if (o && o[1] > maxEnd) maxEnd = o[1] }
      return fs.statSync(fp).size >= 8 + n + maxEnd
    } finally { fs.closeSync(fd) }
  } catch { return false }
}
app.get('/api/studio/models', async (_req, res) => {
  // filesystem is the source of truth (models appear the moment they finish downloading)
  let files = []
  try { files = fs.readdirSync(COMFY_CKPT).filter(f => f.endsWith('.safetensors')) } catch {}
  // exclude VIDEO checkpoints and Pony V7 (AuraFlow — not yet wired). Chroma IS wired now.
  files = files.filter(f => !/ltxv|ltx-video|wan|hunyuan|mochi|cosmos|cogvideo|svd|auraflow|pony-?v7|ponyv7/i.test(f))
  res.json(files.map(name => ({ name, type: modelType(name), ...modelMeta(name), ready: isComplete(name) })))
})

// Chroma: UNET-only, T5-only encoder, real CFG + negatives (de-distilled Flux). Uses UNETLoader.
function buildChromaWorkflow({ model, prompt, negative, width, height, steps, seed }) {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: model, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 't5xxl_fp8_e4m3fn.safetensors', type: 'chroma' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'flux-ae.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: negative || 'low quality, blurry, deformed', clip: ['2', 0] } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    '7': { class_type: 'KSampler', inputs: { seed, steps: steps || 26, cfg: 4.5, sampler_name: 'euler', scheduler: 'beta', denoise: 1, model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'cc', images: ['8', 0] } },
  }
}
// build a ComfyUI API-format workflow parameterized for the model family
function buildWorkflow({ model, prompt, negative, width, height, steps, seed }) {
  if (/chroma/i.test(model)) return buildChromaWorkflow({ model, prompt, negative, width, height, steps, seed })
  const flux = modelType(model) === 'flux'
  const pony = /pony/i.test(model) // Pony fine-tunes need score tags + a specific sampler
  let pos = prompt
  let neg = negative || ''
  if (pony) {
    if (!/score_\d/i.test(pos)) pos = 'score_9, score_8_up, score_7_up, ' + pos
    if (!neg.trim()) neg = 'score_4, score_5, score_6, worst quality, low quality, blurry'
  }
  const latentNode = flux
    ? { '5': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } } }
    : { '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } } }
  // Flux: load text encoders (t5xxl + clip_l) AND vae externally — works whether or not the
  // checkpoint bundles them (many Civitai Flux checkpoints ship model-only).
  const fluxExtra = flux ? {
    '10': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 't5xxl_fp8_e4m3fn.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' } },
    '11': { class_type: 'VAELoader', inputs: { vae_name: 'flux-ae.safetensors' } },
  } : {}
  const clipRef = flux ? ['10', 0] : ['4', 1]
  const vaeRef = flux ? ['11', 0] : ['4', 2]
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    ...latentNode,
    ...fluxExtra,
    '6': { class_type: 'CLIPTextEncode', inputs: { text: pos, clip: clipRef } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: flux ? '' : neg, clip: clipRef } },
    '3': { class_type: 'KSampler', inputs: {
      seed, steps, cfg: flux ? 1 : (pony ? 7 : 6.5),
      sampler_name: flux ? 'euler' : (pony ? 'dpmpp_2m_sde' : 'dpmpp_2m'),
      scheduler: flux ? 'simple' : 'karras',
      denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: vaeRef } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'cc', images: ['8', 0] } },
  }
}

app.post('/api/studio/generate', async (req, res) => {
  if (!await comfyUp()) return res.status(502).json({ error: 'ComfyUI not running on :8188' })
  const flux = modelType(req.body.model) === 'flux'
  const params = {
    model: req.body.model,
    prompt: req.body.prompt || '',
    negative: req.body.negative || 'blurry, low quality, watermark, text',
    width: req.body.width || 1024,
    height: req.body.height || 1024,
    steps: req.body.steps || (flux ? (/schnell/i.test(req.body.model) ? 4 : 20) : 28),
    seed: req.body.seed ?? Math.floor(Math.random() * 1e15),
  }
  try {
    const r = await fetch(`${COMFY}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildWorkflow(params) }),
    })
    const d = await r.json()
    if (!r.ok || !d.prompt_id) return res.status(502).json({ error: JSON.stringify(d).slice(0, 400) })
    res.json({ promptId: d.prompt_id, seed: params.seed })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/studio/result/:id', async (req, res) => {
  try {
    const r = await fetch(`${COMFY}/history/${req.params.id}`)
    const hist = await r.json()
    const entry = hist[req.params.id]
    if (!entry) {
      // still queued/running — report live progress if any
      const q = await (await fetch(`${COMFY}/queue`)).json()
      const running = (q.queue_running || []).some(x => x[1] === req.params.id)
      return res.json({ status: running ? 'running' : 'pending' })
    }
    const imgs = []
    for (const nodeOut of Object.values(entry.outputs || {})) {
      for (const img of [...(nodeOut.images || []), ...(nodeOut.gifs || []), ...(nodeOut.videos || [])]) {
        imgs.push(`/api/studio/image?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`)
      }
    }
    res.json({ status: imgs.length ? 'done' : 'failed', images: imgs })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/studio/image', async (req, res) => {
  try {
    const u = new URL(`${COMFY}/view`)
    for (const k of ['filename', 'subfolder', 'type']) if (req.query[k] != null) u.searchParams.set(k, req.query[k])
    const r = await fetch(u)
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png')
    const buf = Buffer.from(await r.arrayBuffer())
    res.send(buf)
  } catch (e) { res.status(502).send(e.message) }
})

// video generation (LTXV via ComfyUI) — availability-gated
function ltxvModel() { try { return fs.readdirSync(COMFY_CKPT).find(f => /ltxv|ltx-video/i.test(f)) } catch { return null } }
function ltxvEncoder() { try { return fs.readdirSync(path.join(HOME, 'ComfyUI', 'models', 'text_encoders')).find(f => /t5xxl/i.test(f)) } catch { return null } }
app.get('/api/studio/video/status', (_req, res) => {
  const model = ltxvModel(), enc = ltxvEncoder()
  let pct = null
  try {
    const log = fs.readFileSync('/private/tmp/claude-501/-Users-kedabektechlabs/341fa395-f9d6-464b-9461-7fc7f76d5e3c/scratchpad/video_dl.log', 'utf8')
    const m = [...log.matchAll(/(\d+(?:\.\d+)?)%/g)]; if (m.length) pct = parseFloat(m[m.length - 1][1])
  } catch {}
  res.json({ ready: !!(model && enc), model, encoder: enc, downloadPct: pct })
})
// LTXV text-to-video workflow (finalized/verified once the model is present)
function buildVideoWorkflow({ model, encoder, prompt, width, height, length }) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: encoder, type: 'ltxv' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: 'worst quality, blurry, distorted', clip: ['2', 0] } },
    '5': { class_type: 'EmptyLTXVLatentVideo', inputs: { width, height, length, batch_size: 1 } },
    '6': { class_type: 'LTXVConditioning', inputs: { positive: ['3', 0], negative: ['4', 0], frame_rate: 24 } },
    '7': { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 1e15), steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['1', 0], positive: ['6', 0], negative: ['6', 1], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } },
    '9': { class_type: 'SaveAnimatedWEBP', inputs: { filename_prefix: 'ccvid', fps: 24, lossless: false, quality: 85, method: 'default', images: ['8', 0] } },
  }
}
app.post('/api/studio/video', async (req, res) => {
  const model = ltxvModel(), encoder = ltxvEncoder()
  if (!model || !encoder) return res.status(409).json({ error: 'Video model still downloading — not ready yet.' })
  if (!await comfyUp()) return res.status(502).json({ error: 'ComfyUI not running' })
  const wf = buildVideoWorkflow({ model, encoder, prompt: req.body.prompt || '', width: req.body.width || 768, height: req.body.height || 512, length: req.body.length || 97 })
  try {
    const r = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf }) })
    const d = await r.json()
    if (!d.prompt_id) return res.status(502).json({ error: JSON.stringify(d).slice(0, 400) })
    res.json({ promptId: d.prompt_id })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/studio/gallery', (_req, res) => {
  let files = []
  try {
    files = fs.readdirSync(COMFY_OUT).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map(f => ({ f, m: fs.statSync(path.join(COMFY_OUT, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m).slice(0, 40)
  } catch {}
  res.json(files.map(x => `/api/studio/image?filename=${encodeURIComponent(x.f)}&subfolder=&type=output`))
})

// ---------- brain (AgentBrain vault) ----------
fs.mkdirSync(BRAIN_DIR, { recursive: true })

// resolve a client-supplied relative path safely inside the vault; .md only
function brainPath(rel, { allowMissing = false } = {}) {
  if (!rel || typeof rel !== 'string' || !rel.endsWith('.md')) return null
  try { return resolvePathBeneath(BRAIN_DIR, rel, { allowMissing }).path } catch { return null }
}
function walkBrain(dir, base = '') {
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue
    const rel = base ? `${base}/${ent.name}` : ent.name
    if (ent.isDirectory()) out.push(...walkBrain(path.join(dir, ent.name), rel))
    else if (ent.name.endsWith('.md')) {
      const st = fs.lstatSync(path.join(dir, ent.name))
      out.push({ path: rel, section: base.split('/')[0] || '', name: ent.name.replace(/\.md$/, ''), size: st.size, mtime: st.mtimeMs })
    }
  }
  return out
}

app.get('/api/brain/tree', (_req, res) => res.json(walkBrain(BRAIN_DIR)))

app.get('/api/brain/file', (req, res) => {
  const abs = brainPath(req.query.path)
  if (!abs) return res.status(400).json({ error: 'invalid path' })
  try { res.json({ path: req.query.path, content: readFileBeneath(BRAIN_DIR, req.query.path, 'utf8') }) }
  catch { res.status(404).json({ error: 'not found' }) }
})

app.post('/api/brain/file', (req, res) => {
  const abs = brainPath(req.body.path, { allowMissing: true })
  if (!abs) return res.status(400).json({ error: 'invalid path' })
  try { writeFileBeneath(BRAIN_DIR, req.body.path, req.body.content ?? '') }
  catch { return res.status(400).json({ error: 'invalid path' }) }
  res.json({ ok: true })
})

app.delete('/api/brain/file', (req, res) => {
  const abs = brainPath(req.query.path)
  if (!abs) return res.status(400).json({ error: 'invalid path' })
  try { unlinkFileBeneath(BRAIN_DIR, req.query.path); res.json({ ok: true }) } catch { res.status(404).json({ error: 'not found' }) }
})

// nodes = files, links = [[wikilink]] mentions (matched by file name, case-insensitive)
app.get('/api/brain/graph', (_req, res) => {
  const files = walkBrain(BRAIN_DIR)
  const byName = new Map(files.map(f => [f.name.toLowerCase(), f.path]))
  const links = []
  for (const f of files) {
    let content = ''
    try { content = fs.readFileSync(path.join(BRAIN_DIR, f.path), 'utf8') } catch { continue }
    for (const m of content.matchAll(/\[\[([^\]|#]+)/g)) {
      const target = byName.get(m[1].trim().toLowerCase())
      if (target && target !== f.path) links.push({ source: f.path, target })
    }
  }
  res.json({ nodes: files, links })
})

// ---------- cloud providers + unified model list ----------
const PROVIDERS_FILE = path.join(DATA, 'providers.json')
const OC_CONFIG = path.join(HOME, '.config', 'opencode', 'opencode.json')
// curated cloud model catalogs (ref = opencode model id "<provider>/<model>")
const CLOUD_CATALOG = {
  anthropic: {
    label: 'Anthropic (Claude)',
    models: [
      { ref: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8 (top)' },
      { ref: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (balanced)' },
      { ref: 'anthropic/claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
    ],
  },
  openai: {
    label: 'OpenAI (GPT)',
    models: [
      { ref: 'openai/gpt-5', label: 'GPT-5' },
      { ref: 'openai/gpt-4.1', label: 'GPT-4.1' },
      { ref: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast)' },
    ],
  },
}
function readProviders() { try { return JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8')) } catch { return {} } }
function writeProviders(p) { atomicWriteJsonSync(PROVIDERS_FILE, p) }
function readOcConfig() { try { return JSON.parse(fs.readFileSync(OC_CONFIG, 'utf8')) } catch { return { provider: {} } } }
function writeOcConfig(c) { atomicWriteJsonSync(OC_CONFIG, c) }
function readMcpRegistry() {
  const cfg = readOcConfig()
  const migrated = migrateMcpRegistry(cfg.mcp)
  if (migrated.changed) { cfg.mcp = migrated.registry; writeOcConfig(cfg) }
  return migrated.registry
}
function migrateLegacyProviderSecrets() {
  const cfg = readOcConfig(); let changed = false
  for (const provider of Object.keys(CLOUD_CATALOG)) {
    const value = cfg.provider?.[provider]?.options?.apiKey
    if (!value) continue
    try {
      storeProviderSecret(provider, value)
      delete cfg.provider[provider].options.apiKey
      if (!Object.keys(cfg.provider[provider].options).length) delete cfg.provider[provider].options
      changed = true; appendAudit('provider_secret_migrated_to_keychain', { provider })
    } catch (error) { appendAudit('provider_secret_migration_failed', { provider, error: error.message }) }
  }
  if (changed) writeOcConfig(cfg)
}
migrateLegacyProviderSecrets()

function secretReferenceUsage(rawId) {
  const id = normalizeSecretReferenceId(rawId), usage = []
  for (const server of Object.values(readMcpRegistry())) if (server.authRef === id) usage.push({ type: 'mcp', id: server.id, name: server.name || server.id })
  if (typeof WF_DIR !== 'undefined' && fs.existsSync(WF_DIR)) for (const file of fs.readdirSync(WF_DIR).filter(name => name.endsWith('.json'))) {
    const workflow = readJson(path.join(WF_DIR, file), null)
    if (!workflow) continue
    if ((workflow.secretReferences || []).some(item => (typeof item === 'string' ? item : item?.id || item?.referenceId) === id) || (workflow.nodes || []).some(node => node?.data?.authRef === id || node?.data?.auth?.ref === id)) usage.push({ type: 'workflow', id: String(workflow.id || file.slice(0, -5)), name: String(workflow.name || workflow.id || file).slice(0, 120) })
  }
  return usage.slice(0, 100)
}
app.use('/api/secret-references', createSecretReferenceRouter({ registry: secretReferenceRegistry, usage: secretReferenceUsage, appendAudit }))

app.get('/api/providers', (_req, res) => {
  const saved = readProviders()
  res.json(Object.entries(CLOUD_CATALOG).map(([name, c]) => ({ name, label: c.label, configured: !!saved[name]?.configured && !!readProviderSecret(name), secretStore: saved[name]?.secretStore || 'legacy' })))
})
app.post('/api/providers', (req, res) => {
  const { provider, apiKey } = req.body
  if (!CLOUD_CATALOG[provider] || !apiKey) return res.status(400).json({ error: 'provider and apiKey required' })
  try {
    storeProviderSecret(provider, apiKey)
    const cfg = readOcConfig(); if (cfg.provider?.[provider]?.options?.apiKey) { delete cfg.provider[provider].options.apiKey; if (!Object.keys(cfg.provider[provider].options).length) delete cfg.provider[provider].options; writeOcConfig(cfg) }
    const saved = readProviders(); saved[provider] = { configured: true, secretStore: 'macos-keychain' }; writeProviders(saved)
    appendAudit('provider_added', { provider, secretStore: 'macos-keychain' }); res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: `could not store provider credential in macOS Keychain: ${error.message}` }) }
})
app.delete('/api/providers/:name', (req, res) => {
  const cfg = readOcConfig()
  if (cfg.provider?.[req.params.name]) { delete cfg.provider[req.params.name]; writeOcConfig(cfg) }
  const saved = readProviders(); delete saved[req.params.name]; writeProviders(saved)
  deleteProviderSecret(req.params.name)
  res.json({ ok: true })
})

// unified model list for workflow node dropdowns: local (LM Studio) + configured cloud
app.get('/api/allmodels', async (_req, res) => {
  const out = []
  try {
    const local = await lmstudioModels()
    for (const m of local) out.push({ ref: 'lmstudio/' + m.id, provider: 'local', label: m.id, kind: 'local' })
  } catch {}
  const saved = readProviders()
  for (const [name, c] of Object.entries(CLOUD_CATALOG)) {
    if (!saved[name]?.configured || !readProviderSecret(name)) continue
    for (const m of c.models) out.push({ ref: m.ref, provider: name, label: m.label, kind: 'cloud' })
  }
  // friendly auto policies — resolved per-run to a concrete model (no IDs needed)
  const POLICIES = [
    { ref: 'policy:fast', label: '⚡ Fast (smallest local)' },
    { ref: 'policy:balanced', label: '⚖ Balanced' },
    { ref: 'policy:premium', label: '★ Premium (strongest available)' },
    { ref: 'policy:local', label: '🔒 Local only' },
  ]
  for (const p of POLICIES) out.push({ ref: p.ref, provider: 'policy', label: p.label, kind: 'policy' })
  // role bindings — resolved per-run through the active tier profile
  for (const role of ROLE_NAMES) out.push({ ref: 'role:' + role, provider: 'role', label: `role: ${role}`, kind: 'role' })
  res.json(out)
})

// ---------- tier profiles (role -> model, swap a whole workflow's models) ----------
const PROFILES_FILE = path.join(DATA, 'profiles.json')
const ROLE_NAMES = ['planner', 'worker', 'reviewer', 'cheap'] // the roles a node can bind to
function seedProfiles() {
  const seed = [
    { id: 'premium', name: 'Premium (big local)', roles: {
      planner: 'lmstudio/qwen/qwen3-coder-30b', worker: 'lmstudio/qwen/qwen3-coder-30b',
      reviewer: 'lmstudio/qwen/qwen3-30b-a3b-2507', cheap: 'lmstudio/openai/gpt-oss-20b' } },
    { id: 'lite', name: 'Lite (fast/small)', roles: {
      planner: 'lmstudio/qwen/qwen3-30b-a3b-2507', worker: 'lmstudio/qwen/qwen3-30b-a3b-2507',
      reviewer: 'lmstudio/openai/gpt-oss-20b', cheap: 'lmstudio/openai/gpt-oss-20b' } },
  ]
  atomicWriteJsonSync(PROFILES_FILE, seed)
  return seed
}
function loadProfiles() { try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')) } catch { return seedProfiles() } }
function saveProfiles(p) { atomicWriteJsonSync(PROFILES_FILE, p) }
// infer a model's size in billions from its id (max number before 'b')
function inferSize(id) { const m = [...String(id).matchAll(/(\d+(?:\.\d+)?)\s*b/gi)].map(x => parseFloat(x[1])); return m.length ? Math.max(...m) : 0 }
// map friendly policies -> a concrete model given what's installed/configured
function buildPolicyMap(localModels, cloudProvider) {
  const ranked = localModels.map(m => ({ ref: 'lmstudio/' + m.id, size: inferSize(m.id) })).sort((a, b) => a.size - b.size)
  const fast = ranked[0]?.ref || 'lmstudio/qwen/qwen3-coder-30b'
  const premiumLocal = ranked[ranked.length - 1]?.ref || fast
  const balanced = ranked[Math.floor((ranked.length - 1) / 2)]?.ref || fast
  const premium = cloudProvider === 'anthropic' ? 'anthropic/claude-opus-4-8' : cloudProvider === 'openai' ? 'openai/gpt-5' : premiumLocal
  return { fast, balanced, premium, local: premiumLocal }
}
// resolve a node model ref: "policy:fast" via policyMap, "role:worker" via profile, else literal
function resolveModel(ref, profile, policyMap) {
  if (typeof ref === 'string' && ref.startsWith('policy:')) {
    return (policyMap && policyMap[ref.slice(7)]) || policyMap?.balanced || 'lmstudio/qwen/qwen3-coder-30b'
  }
  if (typeof ref === 'string' && ref.startsWith('role:')) {
    const role = ref.slice(5)
    return profile?.roles?.[role] || (policyMap?.balanced) || 'lmstudio/qwen/qwen3-coder-30b'
  }
  return ref || 'lmstudio/qwen/qwen3-coder-30b'
}
app.get('/api/profiles', (_req, res) => res.json({ profiles: loadProfiles(), roles: ROLE_NAMES }))
app.post('/api/profiles', (req, res) => {
  const list = loadProfiles(); const p = req.body
  if (!p.name) return res.status(400).json({ error: 'name required' })
  p.id = p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const i = list.findIndex(x => x.id === p.id); if (i >= 0) list[i] = p; else list.push(p)
  saveProfiles(list); res.json(p)
})
app.delete('/api/profiles/:id', (req, res) => { saveProfiles(loadProfiles().filter(p => p.id !== req.params.id)); res.json({ ok: true }) })

// ---------- workflows (visual orchestration) ----------
const WF_DIR = path.join(DATA, 'workflows')
const WF_VERSION_DIR = path.join(DATA, 'workflow-versions')
const PY_ENV_DIR = path.join(DATA, 'python-envs')
fs.mkdirSync(WF_DIR, { recursive: true })
fs.mkdirSync(WF_VERSION_DIR, { recursive: true })
governanceLifecycle.reconcileWorkflowFiles(WF_DIR)
fs.mkdirSync(PY_ENV_DIR, { recursive: true })
const PIPE_WS = path.join(WORKSPACE, 'pipelines')

function seedWorkflows() {
  const cf = {
    id: 'content-factory', name: 'Content Factory',
    nodes: [
      { id: 'in', type: 'input', position: { x: 40, y: 160 }, data: { label: 'Topic' } },
      { id: 'research', type: 'agent', position: { x: 300, y: 60 }, data: { label: 'Researcher', model: 'lmstudio/qwen/qwen3-30b-a3b-2507', instruction: 'Research this topic and list the 5 most important facts:\n\n{{input}}' } },
      { id: 'write', type: 'agent', position: { x: 300, y: 240 }, data: { label: 'Writer', model: 'lmstudio/qwen/qwen3-coder-30b', instruction: 'Using these research facts, write a clear 200-word article:\n\n{{research}}' } },
      { id: 'edit', type: 'agent', position: { x: 580, y: 160 }, data: { label: 'Editor', model: 'lmstudio/qwen/qwen3-30b-a3b-2507', instruction: 'Polish and tighten this article, fix any errors:\n\n{{write}}' } },
      { id: 'out', type: 'output', position: { x: 840, y: 160 }, data: { label: 'Final article' } },
    ],
    edges: [
      { id: 'e1', source: 'in', target: 'research' },
      { id: 'e2', source: 'research', target: 'write' },
      { id: 'e3', source: 'write', target: 'edit' },
      { id: 'e4', source: 'edit', target: 'out' },
    ],
  }
  atomicWriteJsonSync(path.join(WF_DIR, cf.id + '.json'), cf)
}
if (fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json')).length === 0) seedWorkflows()

app.get('/api/workflows', (_req, res) => {
  const list = fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json')).map(f => {
    try { const w = JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8')); return { id: w.id, name: w.name, nodes: w.nodes?.length || 0 } } catch { return null }
  }).filter(Boolean)
  res.json(list)
})
app.get('/api/workflow-components', (_req, res) => res.json(reusableComponentCatalog(WF_DIR, WF_VERSION_DIR)))
app.post('/api/workflow-components/:id/rename', (req, res) => {
  try {
    const result = renameReusableComponent(WF_DIR, WF_VERSION_DIR, req.params.id, { name: req.body.name, description: req.body.description })
    appendAudit('workflow_component_renamed', { workflow: req.params.id })
    res.json(reusableComponentCatalog(WF_DIR, WF_VERSION_DIR).find(item => item.id === result.workflow.id))
  } catch (error) {
    const status = error?.code === 'COMPONENT_NOT_FOUND' ? 404 : error?.code === 'COMPONENT_LOCKED' ? 423 : 400
    res.status(status).json({ error: error.message })
  }
})
app.post('/api/workflow-components/:id/archive', (req, res) => {
  try {
    const result = archiveReusableComponent(WF_DIR, WF_VERSION_DIR, req.params.id)
    appendAudit('workflow_component_archived', { workflow: req.params.id })
    res.json(reusableComponentCatalog(WF_DIR, WF_VERSION_DIR).find(item => item.id === result.workflow.id))
  } catch (error) {
    const status = error?.code === 'COMPONENT_NOT_FOUND' ? 404 : error?.code === 'COMPONENT_LOCKED' ? 423 : error?.code === 'COMPONENT_IN_USE' ? 409 : 400
    res.status(status).json({ error: error.message, ...(error?.dependencies ? { dependencies: error.dependencies } : {}) })
  }
})
app.get('/api/workflow-components/:id/manifest', (req, res) => {
  try {
    const manifest = exportComponentManifest(WF_DIR, WF_VERSION_DIR, req.params.id)
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.component.json"`)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify(manifest, null, 2))
  } catch (error) {
    const status = error?.code === 'COMPONENT_NOT_FOUND' ? 404 : ['CURRENT_SNAPSHOT_MISSING', 'MISSING_WORKFLOW_VERSION'].includes(error?.code) ? 409 : 400
    res.status(status).json({ error: error.message, code: error?.code })
  }
})
app.post('/api/workflow-components/imports', (req, res) => {
  try {
    const validated = validateComponentManifest(req.body, { workflowRoot: WF_DIR })
    const proposals = readJson(COMPONENT_IMPORT_PROPOSALS_FILE, [])
    const item = { id: `component-import-${crypto.randomBytes(6).toString('hex')}`, status: 'review-required', createdAt: Date.now(), review: validated.review, manifest: validated.manifest }
    proposals.unshift(item); writeJson(COMPONENT_IMPORT_PROPOSALS_FILE, proposals.slice(0, 20))
    appendAudit('workflow_component_import_staged', { id: item.id, review: item.review })
    res.status(202).json({ ok: false, status: item.status, proposalId: item.id, review: item.review })
  } catch (error) { res.status(400).json({ error: error.message, code: error?.code }) }
})
app.get('/api/workflow-components/imports/:id', (req, res) => {
  const item = readJson(COMPONENT_IMPORT_PROPOSALS_FILE, []).find(proposal => proposal.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'component import proposal not found' })
  res.json({ id: item.id, status: item.status, createdAt: item.createdAt, review: item.review, decidedAt: item.decidedAt || null })
})
app.post('/api/workflow-components/imports/:id/decision', (req, res) => {
  const proposals = readJson(COMPONENT_IMPORT_PROPOSALS_FILE, []), item = proposals.find(proposal => proposal.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'component import proposal not found' })
  if (item.status !== 'review-required') return res.status(409).json({ error: `component import proposal is already ${item.status}` })
  if (req.body.decision !== 'approve') {
    item.status = 'rejected'; item.decidedAt = Date.now(); item.manifest = undefined; writeJson(COMPONENT_IMPORT_PROPOSALS_FILE, proposals)
    appendAudit('workflow_component_import_rejected', { id: item.id }); return res.json({ ok: true, status: item.status })
  }
  try {
    const review = installComponentManifest(WF_DIR, WF_VERSION_DIR, item.manifest, { proposalId: item.id })
    item.status = 'installed'; item.decidedAt = Date.now(); item.review = review; item.manifest = undefined; writeJson(COMPONENT_IMPORT_PROPOSALS_FILE, proposals)
    appendAudit('workflow_component_import_approved', { id: item.id, review })
    res.json({ ok: true, status: item.status, review })
  } catch (error) {
    const status = error?.code === 'COMPONENT_IMPORT_CONFLICT' ? 409 : 400
    res.status(status).json({ error: error.message, code: error?.code, ...(error?.conflicts ? { conflicts: error.conflicts } : {}) })
  }
})
app.get('/api/workflows/:id', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  try { res.json(migrateWorkflowDocument(JSON.parse(fs.readFileSync(path.join(WF_DIR, req.params.id + '.json'), 'utf8')))) }
  catch (error) { error?.code === 'FUTURE_WORKFLOW_SCHEMA' ? res.status(409).json({ error: error.message }) : res.status(404).json({ error: 'not found' }) }
})
const EXECUTABLE_NODE_TYPES = new Set([
  'input', 'agent', 'orchestrator', 'critic', 'parallel', 'search', 'check', 'output',
  'python', 'shell', 'http', 'json-transform', 'if', 'delay', 'read-file', 'write-file', 'map',
  'human-approval',
  'file-input', 'folder-input', 'pdf-reader', 'obsidian-read', 'obsidian-write',
  'mcp', 'subworkflow', 'custom',
])
function customNodes() { return readJson(CUSTOM_NODES_FILE, []) }
function contractFor(node) { return contractForNode(node, customNodes()) }
app.get('/api/workflow-node-contracts', (_req, res) => res.json(portCatalog(customNodes())))
app.post('/api/workflow-connections/preview', (req, res) => {
  try {
    let value = req.body.value
    if (req.body.parseJson && typeof value === 'string') value = JSON.parse(value)
    if (req.body.coercion) value = coerceValue(value, req.body.coercion)
    const mapping = req.body.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : {}
    if (Object.keys(mapping).length) {
      let mapped = {}
      for (const [sourceField, destinationField] of Object.entries(mapping)) mapped = setAtPath(mapped, destinationField, valueAtPath(value, sourceField))
      value = mapped
    }
    const errors = validateSchema(value, req.body.schema)
    res.json({ value, valid: errors.length === 0, errors })
  } catch (error) { res.status(400).json({ error: error.message }) }
})
function workflowErrors(w) {
  const errors = []
  if (!w || typeof w !== 'object') return ['workflow body required']
  if (typeof w.name !== 'string' || !w.name.trim()) errors.push('name required')
  if (!Array.isArray(w.nodes)) errors.push('nodes must be an array')
  if (!Array.isArray(w.edges)) errors.push('edges must be an array')
  if (errors.length) return errors
  errors.push(...resourcePolicyErrors(w.settings?.resources))
  errors.push(...groupValidationErrors(w.groups, w.nodes))
  errors.push(...commentValidationErrors(w.comments, w.nodes, w.groups))
  const ids = new Set()
  for (const n of w.nodes) {
    if (!n || typeof n.id !== 'string' || !/^[\w-]+$/.test(n.id)) errors.push('every node needs a safe id')
    else if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`)
    else ids.add(n.id)
    if (!EXECUTABLE_NODE_TYPES.has(n?.type)) errors.push(`unsupported node type: ${n?.type || '(missing)'}`)
    if (n?.type === 'subworkflow' && n.data?.workflowVersion && !/^[a-z0-9_.-]+$/i.test(String(n.data.workflowVersion))) errors.push(`subworkflow ${n.id} has an invalid workflowVersion pin`)
    errors.push(...resourcePolicyErrors(n?.runtime?.resources ?? n?.data?.runtime?.resources, `node ${n?.id || '(missing)'}.runtime.resources`))
  }
  const edgeKeys = new Set()
  for (const e of w.edges) {
    if (!e || !ids.has(e.source) || !ids.has(e.target)) errors.push(`connection references a missing node: ${e?.source || '?'} → ${e?.target || '?'}`)
    if (e?.source === e?.target) errors.push(`self-connection is not allowed: ${e.source}`)
    const key = `${e?.source}→${e?.target}`
    if (edgeKeys.has(key)) errors.push(`duplicate connection: ${key}`)
    edgeKeys.add(key)
    const sourceNode = w.nodes.find(n => n.id === e?.source), targetNode = w.nodes.find(n => n.id === e?.target)
    if (sourceNode && targetNode) {
      const sourceContract = contractFor(sourceNode), targetContract = contractFor(targetNode)
      const sourcePort = sourceContract.outputs.find(x => x.id === (e.sourceHandle || 'output')) || sourceContract.outputs[0]
      const targetPort = targetContract.inputs.find(x => x.id === (e.targetHandle || 'input')) || targetContract.inputs[0]
      if (sourcePort && targetPort && !portsCompatible(sourcePort.type, targetPort.type, e.data?.coercion)) errors.push(`incompatible connection ${e.source} (${sourcePort.type}) → ${e.target} (${targetPort.type}); add ${suggestedConverter(sourcePort.type, targetPort.type)}`)
    }
  }
  return [...new Set(errors)]
}
app.post('/api/workflows', (req, res) => {
  let w, existing = null
  const requestedId = typeof req.body?.id === 'string' && /^[a-z0-9_-]+$/i.test(req.body.id) ? req.body.id : null
  if (requestedId) existing = readJson(path.join(WF_DIR, requestedId + '.json'), null)
  try {
    assertOrdinaryWorkflowSave({ input: req.body, existing })
    w = migrateGovernanceLifecycle(migrateWorkflowDocument(req.body)).workflow
  } catch (error) {
    const denial = governanceErrorResponse(error)
    appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'save', outcome: 'denied', workflowId: requestedId, code: denial.body.code, environment: existing?.environment || req.body?.environment }))
    return res.status(error?.code === 'FUTURE_WORKFLOW_SCHEMA' ? 409 : denial.status).json(denial.body)
  }
  const errors = workflowErrors(w)
  if (errors.length) return res.status(400).json({ error: errors.join('; ') })
  if (w.id && !/^[a-z0-9_-]+$/i.test(w.id)) return res.status(400).json({ error: 'invalid workflow id' })
  if (!w.id) {
    const base = w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'
    w.id = base
    let suffix = 2
    while (fs.existsSync(path.join(WF_DIR, w.id + '.json'))) w.id = `${base}-${suffix++}`
  } else {
    existing ||= readJson(path.join(WF_DIR, w.id + '.json'), null)
    if (existing) w = migrateGovernanceLifecycle(preserveWorkflowLifecycle(existing, migrateWorkflowDocument(mergeWorkflowDocuments(existing, w)))).workflow
  }
  const preservedPins = fs.readdirSync(WF_DIR).filter(file => file.endsWith('.json')).flatMap(file => {
    const parent = readJson(path.join(WF_DIR, file), null)
    return (parent?.nodes || []).filter(node => node?.type === 'subworkflow' && node.data?.workflowId === w.id && node.data?.workflowVersion).map(node => String(node.data.workflowVersion))
  })
  const savedVersion = saveWorkflowVersion(WF_VERSION_DIR, w, { preserveIds: preservedPins })
  atomicWriteJsonSync(path.join(WF_DIR, w.id + '.json'), w)
  appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'save', outcome: 'accepted', workflowId: w.id, code: 'WORKFLOW_SAVED', environment: w.environment }))
  res.set('X-Workflow-Version', savedVersion.id).json(w)
})
app.post('/api/workflows/:id/promote', (req, res) => {
  res.status(409).json({ error: 'direct promotion is disabled; use the exact Development → Testing → Production lifecycle', code: 'LIFECYCLE_ACTION_REQUIRED' })
})
app.get('/api/workflows/:id/lifecycle', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  const raw = readJson(path.join(WF_DIR, req.params.id + '.json'), null)
  if (!raw) return res.status(404).json({ error: 'workflow not found' })
  try {
    const preview = migrateGovernanceLifecycle(migrateWorkflowDocument(raw))
    const records = governanceLifecycle.read()
    res.json({ workflowId: req.params.id, migration: { changed: preview.changed, reviewRequired: preview.reviewRequired, lifecycle: preview.workflow.governance.lifecycle }, approvals: records.approvals.filter(item => item.workflowId === req.params.id), deployments: records.deployments.filter(item => item.workflowId === req.params.id), rollbacks: records.rollbacks.filter(item => item.workflowId === req.params.id) })
  } catch (error) {
    const denial = governanceErrorResponse(error)
    res.status(denial.status).json(denial.body)
  }
})
app.post('/api/workflows/:id/lifecycle', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  const file = path.join(WF_DIR, req.params.id + '.json')
  const raw = readJson(file, null)
  if (!raw) return res.status(404).json({ error: 'workflow not found' })
  try {
    const workflow = migrateWorkflowDocument(raw)
    const candidate = governanceCandidates.find(String(req.body.candidateId || ''))
    if (!candidate || candidate.workflowId !== workflow.id) throw Object.assign(new Error('an exact immutable candidate is required'), { code: 'EXACT_CANDIDATE_REQUIRED', status: 409 })
    const version = resolvePinnedWorkflowVersion(WF_VERSION_DIR, workflow.id, candidate.workflowVersion)
    const verifySelectedEvidence = (selectedIds, exactCandidate) => {
      const required = Array.isArray(workflow.governance?.promotionGates?.evaluations) ? workflow.governance.promotionGates.evaluations.map(String) : Array.isArray(workflow.evaluations) ? workflow.evaluations.filter(item => typeof item === 'string') : []
      const selected = new Set(selectedIds.map(String)), suites = readJson(EVALUATIONS_FILE, []), failures = []
      for (const id of required) {
        const suite = suites.find(item => item.id === id)
        const record = suite?.history?.find(item => selected.has(item.id))
        try { assertExactEvaluationEvidence({ suite, record, candidate: exactCandidate }) } catch { failures.push(id) }
      }
      if (failures.length) throw Object.assign(new Error(`exact passing evaluation evidence required for ${failures.join(', ')}`), { code: 'EXACT_EVALUATION_EVIDENCE_REQUIRED', status: 409 })
      return true
    }
    const result = applyLifecycleTransition({ workflow, candidate, versionWorkflow: version.workflow, request: req.body, records: governanceLifecycle.read(), verifySelectedEvidence })
    governanceLifecycle.commitWorkflowState(result.records, result.workflow)
    atomicWriteJsonSync(file, result.workflow)
    saveWorkflowVersion(WF_VERSION_DIR, result.workflow)
    appendAudit('workflow_lifecycle', { workflow: workflow.id, action: String(req.body.action), actor: String(req.body.actor).slice(0, 80), candidateId: candidate.id })
    res.json({ workflow: result.workflow, lifecycle: result.workflow.governance.lifecycle })
  } catch (error) {
    const denial = governanceErrorResponse(error)
    appendAudit('workflow_lifecycle_denied', { workflow: req.params.id, action: /^[a-z-]+$/.test(String(req.body?.action || '')) ? String(req.body.action) : null, code: denial.body.code })
    res.status(denial.status).json(denial.body)
  }
})
app.post('/api/workflows/:id/unlock', (req, res) => {
  res.status(409).json({ error: 'in-place unlock is disabled; create a separate Development revision from the exact deployment', code: 'LIFECYCLE_DEVELOPMENT_REVISION_REQUIRED' })
})
app.delete('/api/workflows/:id', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  const existing = readJson(path.join(WF_DIR, req.params.id + '.json'), null)
  try { assertWorkflowDelete({ existing }) }
  catch (error) {
    const denial = governanceErrorResponse(error)
    appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'delete', outcome: 'denied', workflowId: req.params.id, code: denial.body.code, environment: existing?.environment }))
    return res.status(denial.status).json(denial.body)
  }
  try { fs.unlinkSync(path.join(WF_DIR, req.params.id + '.json')) } catch {}
  try { fs.rmSync(path.join(WF_VERSION_DIR, req.params.id), { recursive: true, force: true }) } catch {}
  appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'delete', outcome: 'accepted', workflowId: req.params.id, code: 'WORKFLOW_DELETED', environment: existing?.environment }))
  res.json({ ok: true })
})
app.get('/api/workflows/:id/versions', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  const current = readJson(path.join(WF_DIR, `${req.params.id}.json`), null)
  const currentHash = current ? workflowContentHash(current) : null
  res.json(listWorkflowVersions(WF_VERSION_DIR, req.params.id).map(version => ({ ...version, current: version.hash === currentHash })))
})
app.get('/api/workflows/:id/candidates', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  res.json(governanceCandidates.list().filter(item => item.workflowId === req.params.id))
})
app.post('/api/workflows/:id/candidates', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  const raw = readJson(path.join(WF_DIR, `${req.params.id}.json`), null)
  if (!raw) return res.status(404).json({ error: 'workflow not found' })
  try {
    const migrated = migrateGovernanceLifecycle(migrateWorkflowDocument(raw))
    if (migrated.reviewRequired) throw Object.assign(new Error('review-required workflows cannot create trusted candidates'), { code: 'LIFECYCLE_REVIEW_REQUIRED', status: 409 })
    const workflow = migrated.workflow, version = saveWorkflowVersion(WF_VERSION_DIR, workflow)
    const requestedEnvironment = String(req.body.environment || workflow.environment).toLowerCase()
    if (requestedEnvironment !== workflow.environment) throw Object.assign(new Error('candidate environment must match the workflow lifecycle environment'), { code: 'CANDIDATE_ENVIRONMENT_MISMATCH', status: 409 })
    const id = `candidate-${crypto.randomBytes(10).toString('hex')}`
    const record = createCandidateRecord({ id, workflow, workflowVersion: version.id, sourceHash: workflowContentHash(workflow), environment: requestedEnvironment, by: req.body.by })
    governanceCandidates.add(record)
    appendAudit('workflow_candidate_created', { candidateId: record.id, workflow: record.workflowId, environment: record.environment, operationalHash: record.operationalHash })
    res.status(201).json(record)
  } catch (error) { res.status(error?.status || 400).json({ error: error.message, code: error.code }) }
})
app.post('/api/workflows/:id/versions/:versionId/restore', (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id) || !/^[a-z0-9_.-]+$/i.test(req.params.versionId)) return res.status(400).json({ error: 'invalid version reference' })
  try {
    const existing = readJson(path.join(WF_DIR, req.params.id + '.json'), null)
    const version = resolvePinnedWorkflowVersion(WF_VERSION_DIR, req.params.id, req.params.versionId)
    let workflow = migrateWorkflowDocument({ ...version.workflow, id: req.params.id })
    assertWorkflowRestore({ existing, candidate: workflow })
    workflow = preserveWorkflowLifecycle(existing, workflow)
    const errors = workflowErrors(workflow)
    if (errors.length) return res.status(400).json({ error: errors.join('; ') })
    atomicWriteJsonSync(path.join(WF_DIR, req.params.id + '.json'), workflow)
    appendAudit('workflow_restore', { workflow: req.params.id, version: req.params.versionId })
    appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'restore', outcome: 'accepted', workflowId: req.params.id, code: 'WORKFLOW_RESTORED', environment: workflow.environment }))
    res.json(workflow)
  } catch (error) {
    const denial = governanceErrorResponse(error)
    appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'restore', outcome: 'denied', workflowId: req.params.id, code: denial.body.code }))
    res.status(error?.code === 'MISSING_WORKFLOW_VERSION' ? 404 : denial.status).json(denial.body)
  }
})

// ---------- extensibility: custom nodes, plugins, evaluations, learning ----------
app.get('/api/custom-nodes', (_req, res) => res.json(customNodes()))
app.post('/api/custom-nodes', (req, res) => {
  const list = customNodes(), body = req.body || {}
  const id = safeSlug(body.id || body.name, 'custom-node')
  const implementation = body.implementation || {}
  if (!['agent', 'python', 'shell', 'http', 'mcp', 'transform'].includes(implementation.kind)) return res.status(400).json({ error: 'implementation kind must be agent, python, shell, http, mcp, or transform' })
  const requestedPermissions = Array.isArray(body.permissions) ? [...new Set(body.permissions.map(String))].slice(0, 20) : []
  const unknownPermission = requestedPermissions.find(capability => !WORKFLOW_CAPABILITIES.includes(capability))
  if (unknownPermission) return res.status(400).json({ error: `unsupported custom-node capability: ${unknownPermission}` })
  const normalizePorts = value => (Array.isArray(value) ? value : []).slice(0, 12).map((x, i) => ({ id: safeSlug(x.id || x.name, `port-${i + 1}`), label: String(x.label || x.name || `Port ${i + 1}`).slice(0, 80), type: PORT_TYPES.includes(x.type) ? x.type : 'any', required: x.required !== false, ...(x.schema && typeof x.schema === 'object' ? { schema: x.schema } : {}) }))
  const previous = list.find(x => x.id === id)
  const priorSnapshot = previous ? { version: previous.version, savedAt: Date.now(), definition: Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'versions')) } : null
  const item = { id, name: String(body.name || id).slice(0, 100), icon: String(body.icon || '◇').slice(0, 8), description: String(body.description || '').slice(0, 500), inputs: normalizePorts(body.inputs).length ? normalizePorts(body.inputs) : [p('input', 'any', 'Input')], outputs: normalizePorts(body.outputs).length ? normalizePorts(body.outputs) : [p('output', 'any', 'Output')], permissions: requestedPermissions, implementation, tests: Array.isArray(body.tests) ? body.tests.slice(0, 20) : [], documentation: String(body.documentation || '').slice(0, 10000), version: Number(body.version) || Number(previous?.version || 0) + 1, enabled: body.enabled !== false, trustStatus: body.trustStatus || previous?.trustStatus || 'trusted-local', provenance: body.provenance || previous?.provenance || { type: 'local', createdBy: 'owner' }, versions: [...(priorSnapshot ? [priorSnapshot] : []), ...(previous?.versions || [])].slice(0, 20), installedAt: previous?.installedAt || Date.now(), updatedAt: Date.now() }
  const index = list.findIndex(x => x.id === id); if (index >= 0) list[index] = item; else list.push(item)
  writeJson(CUSTOM_NODES_FILE, list); appendAudit('custom_node_saved', { id, kind: implementation.kind }); res.json(item)
})
app.delete('/api/custom-nodes/:id', (req, res) => { writeJson(CUSTOM_NODES_FILE, customNodes().filter(x => x.id !== req.params.id)); appendAudit('custom_node_deleted', { id: req.params.id }); res.json({ ok: true }) })

const BUILTIN_MARKETPLACE = [
  { id: 'quality-pack', name: 'Quality & Review Pack', version: '1.0.0', description: 'Reusable validation and review node definitions.', publisher: 'Command Center', verified: true, nodes: [] },
  { id: 'local-automation-pack', name: 'Local Automation Pack', version: '1.0.0', description: 'Local-first workflow templates and tool presets.', publisher: 'Command Center', verified: true, nodes: [] },
]
const stablePluginValue = value => Array.isArray(value) ? value.map(stablePluginValue) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stablePluginValue(value[key])])) : value
const pluginManifestHash = plugin => crypto.createHash('sha256').update(JSON.stringify(stablePluginValue({
  id: plugin.id, name: plugin.name, version: plugin.version, publisher: plugin.publisher || null, license: plugin.license || null,
  permissions: plugin.permissions || [], dependencies: plugin.dependencies || [], nodes: plugin.nodes || [], provenance: plugin.provenance || null,
}))).digest('hex')
const pluginReviewReceipt = ({ plugin, reviewedBy, reviewedAt }) => {
  const body = { schemaVersion: 1, id: `plugin-review-${crypto.randomBytes(10).toString('hex')}`, pluginId: plugin.id, pluginVersion: plugin.version, manifestHash: plugin.manifestHash, decision: 'approved', reviewedBy, reviewedAt }
  return { ...body, receiptHash: crypto.createHash('sha256').update(JSON.stringify(stablePluginValue(body))).digest('hex') }
}
app.get('/api/plugins', (_req, res) => {
  const installed = readJson(PLUGINS_FILE, [])
  res.json(BUILTIN_MARKETPLACE.map(x => ({ ...x, installed: installed.some(i => i.id === x.id), enabled: installed.find(i => i.id === x.id)?.enabled !== false })).concat(installed.filter(i => !BUILTIN_MARKETPLACE.some(x => x.id === i.id))))
})
app.post('/api/plugins/install', (req, res) => {
  const source = req.body.plugin || BUILTIN_MARKETPLACE.find(x => x.id === req.body.id)
  if (!source || !/^[a-z0-9_-]+$/i.test(source.id || '')) return res.status(400).json({ error: 'valid plugin bundle or marketplace id required' })
  if (!source.version || !source.name) return res.status(400).json({ error: 'plugin manifest requires name and version' })
  const builtin = BUILTIN_MARKETPLACE.some(item => item.id === source.id && item.verified)
  const requestedPermissions = Array.isArray(source.permissions) ? [...new Set(source.permissions.map(String))].slice(0, 30) : []
  const unknownPermission = requestedPermissions.find(capability => !WORKFLOW_CAPABILITIES.includes(capability))
  if (unknownPermission) return res.status(400).json({ error: `unsupported plugin capability: ${unknownPermission}` })
  const installed = readJson(PLUGINS_FILE, []), dependencies = Array.isArray(source.dependencies) ? source.dependencies.slice(0, 50) : [], provenance = source.provenance || { source: builtin ? 'builtin-marketplace' : 'imported-bundle' }
  const plugin = { ...source, permissions: requestedPermissions, dependencies, provenance, signatureStatus: builtin ? 'verified' : 'unsigned', trustStatus: builtin ? 'verified' : 'untrusted', enabled: builtin, installedAt: Date.now() }
  plugin.manifestHash = pluginManifestHash(plugin)
  const index = installed.findIndex(x => x.id === plugin.id); if (index >= 0) installed[index] = plugin; else installed.push(plugin)
  writeJson(PLUGINS_FILE, installed)
  if (Array.isArray(plugin.nodes)) for (const node of plugin.nodes) { const list = customNodes(); if (!list.some(x => x.id === node.id)) { list.push({ ...node, enabled: plugin.enabled, pluginId: plugin.id, pluginVersion: plugin.version, manifestHash: plugin.manifestHash, trustStatus: plugin.trustStatus, provenance: { type: 'plugin', pluginId: plugin.id, pluginVersion: plugin.version, manifestHash: plugin.manifestHash, publisher: plugin.publisher || 'unknown' } }); writeJson(CUSTOM_NODES_FILE, list) } }
  appendAudit('plugin_installed', { id: plugin.id, version: plugin.version, manifestHash: plugin.manifestHash }); res.json(plugin)
})
app.post('/api/plugins/:id/review', (req, res) => {
  const list = readJson(PLUGINS_FILE, []), item = list.find(x => x.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'plugin not installed' })
  if (req.body.decision !== 'approve') return res.status(400).json({ error: 'explicit approve decision required' })
  const currentHash = pluginManifestHash(item)
  if (!/^[a-f0-9]{64}$/.test(String(req.body.expectedManifestHash || '')) || req.body.expectedManifestHash !== item.manifestHash || currentHash !== item.manifestHash) return res.status(409).json({ error: 'plugin manifest changed or exact review binding is missing', code: 'STALE_PLUGIN_REVIEW' })
  item.trustStatus = 'trusted'; item.reviewedAt = Date.now(); item.reviewedBy = String(req.body.by || 'owner').slice(0, 80); item.reviewReceipt = pluginReviewReceipt({ plugin: item, reviewedBy: item.reviewedBy, reviewedAt: item.reviewedAt })
  writeJson(PLUGINS_FILE, list)
  const nodes = customNodes().map(node => node.pluginId === item.id ? { ...node, trustStatus: 'trusted', manifestHash: item.manifestHash, provenance: { ...(node.provenance || {}), pluginVersion: item.version, manifestHash: item.manifestHash, reviewReceiptHash: item.reviewReceipt.receiptHash } } : node)
  writeJson(CUSTOM_NODES_FILE, nodes); appendAudit('plugin_trust_approved', { id: item.id, version: item.version, manifestHash: item.manifestHash, receiptHash: item.reviewReceipt.receiptHash, by: item.reviewedBy }); res.json(item)
})
app.post('/api/plugins/:id/toggle', (req, res) => { const list = readJson(PLUGINS_FILE, []), item = list.find(x => x.id === req.params.id); if (!item) return res.status(404).json({ error: 'plugin not installed' }); const enable = req.body.enabled !== false; const exactReview = item.trustStatus === 'verified' || (item.trustStatus === 'trusted' && item.reviewReceipt?.manifestHash === item.manifestHash && pluginManifestHash(item) === item.manifestHash); if (enable && !exactReview) return res.status(403).json({ error: 'plugin requires an exact manifest-bound review before enabling' }); item.enabled = enable; writeJson(PLUGINS_FILE, list); const nodes = customNodes().map(node => node.pluginId === item.id ? { ...node, enabled: enable } : node); writeJson(CUSTOM_NODES_FILE, nodes); appendAudit('plugin_toggled', { id: item.id, version: item.version, manifestHash: item.manifestHash, enabled: item.enabled }); res.json(item) })
app.delete('/api/plugins/:id', (req, res) => { writeJson(PLUGINS_FILE, readJson(PLUGINS_FILE, []).filter(x => x.id !== req.params.id)); writeJson(CUSTOM_NODES_FILE, customNodes().filter(node => node.pluginId !== req.params.id)); appendAudit('plugin_uninstalled', { id: req.params.id }); res.json({ ok: true }) })

app.get('/api/evaluations', (_req, res) => res.json(readJson(EVALUATIONS_FILE, [])))
app.post('/api/evaluations', (req, res) => {
  try {
    const list = readJson(EVALUATIONS_FILE, []), id = safeSlug(req.body.id || req.body.name, `evaluation-${Date.now()}`), index = list.findIndex(item => item.id === id)
    const item = normalizeEvaluationSuite({ ...req.body, id }, index >= 0 ? list[index] : null)
    if (index >= 0) list[index] = item; else list.push(item)
    writeJson(EVALUATIONS_FILE, list); res.json(item)
  } catch (error) { res.status(error?.status || 400).json({ error: error.message, code: error.code }) }
})
app.post('/api/evaluations/:id/run', (req, res) => {
  const list = readJson(EVALUATIONS_FILE, []), suite = list.find(x => x.id === req.params.id)
  if (!suite) return res.status(404).json({ error: 'evaluation not found' })
  const run = req.body.runId ? readJson(path.join(RUNS_DIR, `${req.body.runId}.json`), null) : null
  if (req.body.runId && !run) return res.status(404).json({ error: 'persisted workflow run not found', code: 'EVALUATION_RUN_NOT_FOUND' })
  if (req.body.runId && Object.prototype.hasOwnProperty.call(req.body, 'output')) return res.status(400).json({ error: 'persisted-run evaluations cannot override the stored run result', code: 'EVALUATION_OUTPUT_OVERRIDE' })
  const candidateId = String(req.body.candidateId || run?.candidateId || ''), candidate = candidateId ? governanceCandidates.find(candidateId) : null
  try {
    const record = createEvaluationRecord({ suite, value: String(req.body.output ?? run?.result ?? ''), run, candidate })
    suite.history = [record, ...(suite.history || [])].slice(0, 100); writeJson(EVALUATIONS_FILE, list); appendAudit('evaluation_run', { evaluation: suite.id, recordId: record.id, score: record.score, promotable: record.promotable, candidateId: record.candidateId })
    if (record.runId && run) {
      run.evaluations = [record, ...(run.evaluations || [])].slice(0, 100)
      atomicWriteJsonSync(path.join(RUNS_DIR, `${record.runId}.json`), run)
      const active = runs.get(record.runId); if (active) active.evaluations = run.evaluations
    }
    res.json(record)
  } catch (error) { res.status(error?.status || 409).json({ error: error.message, code: error.code }) }
})
app.delete('/api/evaluations/:id', (req, res) => { writeJson(EVALUATIONS_FILE, readJson(EVALUATIONS_FILE, []).filter(x => x.id !== req.params.id)); res.json({ ok: true }) })

app.get('/api/learning/proposals', (_req, res) => res.json(readJson(LEARNING_FILE, []).map(item => ({ ...item, rationale: String(item.rationale || '').replaceAll(HOME, '~').replaceAll(ROOT, '<repository>') }))))
app.post('/api/learning/analyze', (req, res) => {
  const workflowId = String(req.body.workflowId || ''), persisted = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).map(f => readJson(path.join(RUNS_DIR, f), null)).filter(r => r?.workflowId === workflowId).sort((a, b) => b.started - a.started).slice(0, 50)
  const failed = persisted.filter(r => ['failed', 'interrupted'].includes(r.status)), proposals = readJson(LEARNING_FILE, [])
  const generated = []
  if (failed.length >= 2) generated.push({ id: crypto.randomUUID(), workflowId, kind: 'retry-policy', title: 'Increase bounded retry protection', rationale: `${failed.length} of ${persisted.length} recent runs failed or were interrupted.`, patch: { settings: { retries: 2 } }, status: 'proposed', evidence: failed.slice(0, 5).map(r => r.id), createdAt: Date.now() })
  const commonError = failed.flatMap(r => r.events || []).filter(e => e.type === 'error').map(e => e.text).find(Boolean)
  if (commonError) generated.push({ id: crypto.randomUUID(), workflowId, kind: 'regression-test', title: 'Add a regression evaluation for the repeated failure', rationale: commonError.replaceAll(HOME, '~').replaceAll(ROOT, '<repository>').slice(0, 500), patch: null, status: 'proposed', evidence: failed.slice(0, 5).map(r => r.id), createdAt: Date.now() })
  writeJson(LEARNING_FILE, [...generated, ...proposals].slice(0, 500)); res.json(generated)
})
app.post('/api/learning/proposals/:id/decision', (req, res) => {
  const proposals = readJson(LEARNING_FILE, []), item = proposals.find(x => x.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'proposal not found' })
  if (item.status !== 'proposed') return res.status(409).json({ error: `proposal is already ${item.status}` })
  item.status = req.body.decision === 'approved' ? 'approved' : 'rejected'; item.decidedAt = Date.now()
  if (item.status === 'approved' && item.patch?.settings) {
    const source = readJson(path.join(WF_DIR, `${item.workflowId}.json`), null)
    if (!source) return res.status(404).json({ error: 'source workflow not found' })
    const suffix = crypto.randomBytes(4).toString('hex'), candidateId = `${safeSlug(item.workflowId, 'workflow')}-learning-${suffix}`
    const candidate = migrateWorkflowDocument(createDevelopmentWorkflowCandidate(source, {
      id: candidateId,
      name: `${source.name || source.id} — Learning candidate`,
      settings: item.patch.settings,
      status: 'learning-candidate',
      provenance: { type: 'learning-proposal', proposalId: item.id, sourceWorkflowId: source.id, sourceHash: workflowContentHash(source) },
    }))
    const errors = workflowErrors(candidate)
    if (errors.length) return res.status(409).json({ error: errors.join('; ') })
    atomicWriteJsonSync(path.join(WF_DIR, `${candidate.id}.json`), candidate)
    saveWorkflowVersion(WF_VERSION_DIR, candidate)
    item.applied = false; item.candidateWorkflowId = candidate.id
    appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'learning-candidate', outcome: 'accepted', workflowId: candidate.id, code: 'LEARNING_CANDIDATE_CREATED', environment: candidate.environment }))
  }
  writeJson(LEARNING_FILE, proposals); appendAudit('learning_proposal_decided', { id: item.id, decision: item.status, applied: !!item.applied }); res.json(item)
})

// ---------- template center (built-in, outcome-organized) ----------
const CC = 'lmstudio/qwen/qwen3-coder-30b', GEN = 'lmstudio/qwen/qwen3-30b-a3b-2507'
const wfChain = (name, steps) => {
  // steps: [{id,label,model,instruction}] chained input->...->output
  const nodes = [{ id: 'in', type: 'input', position: { x: 40, y: 120 }, data: { label: 'Your input' } }]
  const edges = []; let prev = 'in'
  steps.forEach((s, i) => { nodes.push({ id: s.id, type: s.type || 'agent', position: { x: 40 + (i + 1) * 240, y: 120 }, data: { label: s.label, model: s.model, instruction: s.instruction, ...(s.extra || {}) } }); edges.push({ id: 'e' + i, source: prev, target: s.id }); prev = s.id })
  nodes.push({ id: 'out', type: 'output', position: { x: 40 + (steps.length + 1) * 240, y: 120 }, data: { label: 'Result' } })
  edges.push({ id: 'eout', source: prev, target: 'out' })
  return { id: '', name, nodes, edges }
}
const TEMPLATES = [
  { id: 'research-factcheck', category: 'Research', title: 'Research & Fact-Check', produces: 'A researched, fact-checked summary', needs: 'A topic or question', complexity: 'Simple', localOnly: true, beginner: true,
    workflow: wfChain('Research & Fact-Check', [
      { id: 'res', label: 'Researcher', model: GEN, instruction: 'Research this and list the key facts with brief reasoning:\n\n{{input}}' },
      { id: 'check', label: 'Fact-Checker', type: 'critic', model: GEN, extra: { reviewerModel: GEN, maxIters: 2 }, instruction: 'Write a clear, accurate summary of these facts. Remove anything unsupported:\n\n{{res}}' },
    ]) },
  { id: 'content-factory-t', category: 'Documents', title: 'Content Factory', produces: 'A polished article', needs: 'A topic', complexity: 'Simple', localOnly: true, beginner: true,
    workflow: wfChain('Content Factory', [
      { id: 'r', label: 'Researcher', model: GEN, instruction: 'List the 5 most important points about:\n\n{{input}}' },
      { id: 'w', label: 'Writer', model: CC, instruction: 'Write a clear 250-word article using these points:\n\n{{r}}' },
      { id: 'e', label: 'Editor', model: GEN, instruction: 'Polish and tighten this article:\n\n{{w}}' },
    ]) },
  { id: 'business-plan', category: 'Business', title: 'Business Plan Generator', produces: 'A one-page business plan', needs: 'A business idea', complexity: 'Simple', localOnly: true, beginner: true,
    workflow: wfChain('Business Plan Generator', [
      { id: 'mkt', label: 'Market Analyst', model: GEN, instruction: 'Analyze the market, audience and competitors for this idea:\n\n{{input}}' },
      { id: 'plan', label: 'Strategist', model: CC, instruction: 'Write a concise one-page business plan (value prop, market, model, go-to-market, risks) using:\n\n{{mkt}}' },
    ]) },
  { id: 'code-team', category: 'Coding', title: 'Software Development Team', produces: 'Working code in a folder', needs: 'A feature description', complexity: 'Medium', localOnly: true, beginner: false,
    workflow: wfChain('Software Development Team', [
      { id: 'plan', label: 'Planner', model: GEN, instruction: 'Break this into a short build plan:\n\n{{input}}' },
      { id: 'code', label: 'Engineer', model: CC, instruction: 'Implement this plan as working code files in the current folder, then run it to confirm:\n\n{{plan}}' },
      { id: 'rev', label: 'Reviewer', model: CC, instruction: 'Review the code that was just written, fix any bugs, and confirm it runs.' },
    ]) },
  { id: 'website-studio', category: 'Websites', title: 'Simple Website Builder', produces: 'A single self-contained index.html', needs: 'A description of the site', complexity: 'Medium', localOnly: true, beginner: true,
    note: 'Produces a clean, responsive single-page HTML site (inline CSS, no heavy 3D). Local models keep it simple — great for landing pages, not yet studio-grade 3D.',
    workflow: wfChain('Simple Website Builder', [
      { id: 'brief', label: 'Content & Layout Planner', model: GEN, instruction: 'Plan a single-page website for this. List sections, headline copy, and a colour/style direction:\n\n{{input}}' },
      { id: 'build', label: 'Frontend Engineer', model: CC, instruction: 'Create a file named index.html — a complete, self-contained, responsive single-page website (inline CSS, semantic HTML, tasteful modern design, no external assets) implementing this plan. Then confirm the file exists:\n\n{{brief}}' },
      { id: 'qa', label: 'Reviewer', model: CC, instruction: 'Open index.html, check the HTML is valid and responsive, fix any issues, and summarise what was built.' },
    ]) },
  { id: 'premium-3d-website', category: 'Websites', title: 'Premium 3D Website Studio', produces: 'An approved, reviewed local website build', needs: 'A business brief and optional brand knowledge', complexity: 'Advanced', localOnly: true, beginner: false,
    note: 'The defining studio workflow: concepts, human selection, specialist production, implementation, critique, validation, final approval, and local export.',
    workflow: {
      id: '', name: 'Premium 3D Website Studio',
      nodes: [
        { id: 'in', type: 'input', position: { x: 30, y: 250 }, data: { label: 'Business Brief' } },
        { id: 'brand', type: 'search', position: { x: 280, y: 120 }, data: { label: 'Read Brand Knowledge', instruction: '{{input}}', k: 6 } },
        { id: 'director', type: 'agent', position: { x: 280, y: 370 }, data: { label: 'Creative Director', model: GEN, contextLimit: 48000, instruction: 'Turn this business brief into a premium digital experience direction. Define audience, emotional goal, visual territory, and differentiators:\n\n{{input}}' } },
        { id: 'concepts', type: 'parallel', position: { x: 560, y: 245 }, data: { label: 'Generate 3 Concepts', models: [GEN, CC, GEN], judgeModel: GEN, instruction: 'Create three genuinely distinct premium interactive website concepts using the brief and brand context. For each give a name, narrative, visual system, 3D idea, motion language, key pages, and risks. Preserve all three options.\n\nBrand:\n{{brand}}\n\nDirection:\n{{director}}' } },
        { id: 'select', type: 'human-approval', position: { x: 830, y: 245 }, data: { label: 'Human Selection', message: 'Review the three concepts. Approve and write which concept to use, or reject with revision direction.', timeoutMs: 21600000 } },
        { id: 'storyboard', type: 'agent', position: { x: 1080, y: 245 }, data: { label: 'Experience Storyboard', model: GEN, contextLimit: 64000, instruction: 'Create an implementation-ready experience storyboard for the approved concept. Include page flow, scene progression, interactions, responsive behavior, content hierarchy, and asset list:\n\n{{select}}' } },
        { id: 'ui', type: 'agent', position: { x: 1360, y: 25 }, data: { label: 'UI Designer', model: GEN, instruction: 'Produce a precise UI system and responsive component specification from this storyboard:\n\n{{storyboard}}' } },
        { id: 'three', type: 'agent', position: { x: 1360, y: 180 }, data: { label: '3D Artist', model: GEN, instruction: 'Design technically feasible WebGL/Three.js scenes, materials, lighting, camera motion, performance fallbacks, and asset plan:\n\n{{storyboard}}' } },
        { id: 'motion', type: 'agent', position: { x: 1360, y: 335 }, data: { label: 'Motion Director', model: GEN, instruction: 'Define purposeful motion choreography, transitions, scroll behavior, timing, reduced-motion behavior, and interaction feedback:\n\n{{storyboard}}' } },
        { id: 'copy', type: 'agent', position: { x: 1360, y: 490 }, data: { label: 'Copywriter', model: GEN, instruction: 'Write premium, concise website copy for every storyboard section while preserving factual accuracy:\n\n{{storyboard}}' } },
        { id: 'build', type: 'agent', position: { x: 1660, y: 245 }, data: { label: 'Creative Frontend Engineer', model: CC, contextLimit: 96000, instruction: 'Build the complete local website in this run folder. Use the specialist specifications below, choose a maintainable stack, implement responsive and reduced-motion behavior, and run the build.\n\nUI:\n{{ui}}\n\n3D:\n{{three}}\n\nMotion:\n{{motion}}\n\nCopy:\n{{copy}}' } },
        { id: 'critic', type: 'critic', position: { x: 1940, y: 245 }, data: { label: 'Visual Critic & Revision Loop', model: CC, reviewerModel: GEN, maxIters: 2, instruction: 'Inspect the website files and improve visual hierarchy, interaction polish, consistency, accessibility, responsive behavior, and performance. Run available checks and report exactly what changed.\n\nImplementation report:\n{{build}}' } },
        { id: 'quality', type: 'check', position: { x: 2210, y: 150 }, data: { label: 'Requirement & Build Gate', checks: { minLength: 120 } } },
        { id: 'final-approval', type: 'human-approval', position: { x: 2460, y: 245 }, data: { label: 'Final Human Approval', message: 'Review the local build and quality report before export.', timeoutMs: 21600000 } },
        { id: 'manifest', type: 'write-file', position: { x: 2720, y: 245 }, data: { label: 'Save Build Manifest', path: 'website-studio-report.md' } },
        { id: 'out', type: 'output', position: { x: 2970, y: 245 }, data: { label: 'Local Website Build' } },
      ],
      edges: [
        { id: 'e1', source: 'in', target: 'brand' }, { id: 'e2', source: 'in', target: 'director' },
        { id: 'e3', source: 'brand', target: 'concepts' }, { id: 'e4', source: 'director', target: 'concepts' },
        { id: 'e5', source: 'concepts', target: 'select' }, { id: 'e6', source: 'select', target: 'storyboard' },
        { id: 'e7', source: 'storyboard', target: 'ui' }, { id: 'e8', source: 'storyboard', target: 'three' }, { id: 'e9', source: 'storyboard', target: 'motion' }, { id: 'e10', source: 'storyboard', target: 'copy' },
        { id: 'e11', source: 'ui', target: 'build' }, { id: 'e12', source: 'three', target: 'build' }, { id: 'e13', source: 'motion', target: 'build' }, { id: 'e14', source: 'copy', target: 'build' },
        { id: 'e15', source: 'build', target: 'critic' }, { id: 'e16', source: 'critic', target: 'quality' }, { id: 'e17', source: 'quality', target: 'final-approval' },
        { id: 'e18', source: 'final-approval', target: 'manifest' }, { id: 'e19', source: 'manifest', target: 'out' },
      ],
    } },
]
app.get('/api/templates', (_req, res) => res.json(TEMPLATES.map(({ workflow, ...meta }) => ({ ...meta, nodeCount: workflow.nodes.length }))))
app.get('/api/templates/:id', (req, res) => { const t = TEMPLATES.find(t => t.id === req.params.id); t ? res.json(t) : res.status(404).json({ error: 'not found' }) })

// topological order of node ids from edges (Kahn); leftover cyclic nodes appended
function topoOrder(nodes, edges) {
  const ids = nodes.map(n => n.id)
  const indeg = Object.fromEntries(ids.map(i => [i, 0]))
  const adj = Object.fromEntries(ids.map(i => [i, []]))
  for (const e of edges) { if (adj[e.source] && indeg[e.target] != null) { adj[e.source].push(e.target); indeg[e.target]++ } }
  const q = ids.filter(i => indeg[i] === 0), order = []
  while (q.length) { const n = q.shift(); order.push(n); for (const m of adj[n]) if (--indeg[m] === 0) q.push(m) }
  if (order.length !== ids.length) throw new Error('workflow contains a cycle; use a Critic Loop for bounded review cycles')
  return order
}

function runProcess(command, args, { cwd, input = '', timeout = 120000, env = ENV, run, nodeId = null, resourceLimit = null } = {}) {
  const execute = () => new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env: { ...env, PWD: cwd }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    proc.commandCenterProcessGroup = process.platform !== 'win32'
    if (run) { run.procs ||= new Set(); run.procs.add(proc) }
    let stdout = '', stderr = '', settled = false, timedOut = false, killTimer = null
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      terminateProcess(proc)
      killTimer = setTimeout(() => terminateProcess(proc, 'SIGKILL'), 1500)
      killTimer.unref()
    }, timeout)
    timer.unref()
    proc.stdout.on('data', c => { stdout += String(c) })
    proc.stderr.on('data', c => { stderr += String(c) })
    proc.on('error', err => { run?.procs?.delete(proc); if (!settled) { settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer); reject(err) } })
    proc.on('exit', code => {
      run?.procs?.delete(proc)
      if (settled) return
      settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer)
      if (timedOut) reject(new Error(`timed out after ${Math.round(timeout / 1000)} seconds`))
      else if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      else reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()))
    })
    if (input) proc.stdin.write(input)
    proc.stdin.end()
  })
  return run?.resourceCoordinator
    ? run.resourceCoordinator.withResource('subprocess', { nodeId, limit: resourceLimit }, execute)
    : execute()
}

async function pythonExecutableFor(nodeData, run, nodeId, cwd) {
  const dependencies = Array.isArray(nodeData.dependencies) ? nodeData.dependencies.map(String).map(x => x.trim()).filter(Boolean) : []
  if (!dependencies.length) return 'python3'
  if (!nodeData.allowPackageInstall) throw new Error('Python dependencies are listed but package installation is not approved for this node')
  const valid = /^[a-zA-Z0-9_.-]+(?:\[[a-zA-Z0-9_,.-]+\])?(?:\s*(?:===|==|~=|>=|<=|>|<)\s*[a-zA-Z0-9_.+*-]+)?$/
  const invalid = dependencies.find(dep => !valid.test(dep))
  if (invalid) throw new Error(`unsupported Python dependency specification: ${invalid}`)
  const normalized = [...new Set(dependencies)].sort()
  const hash = crypto.createHash('sha256').update(normalized.join('\n')).digest('hex').slice(0, 16)
  const envDir = path.join(PY_ENV_DIR, hash)
  const python = path.join(envDir, 'bin', 'python')
  const ready = path.join(envDir, '.command-center-ready')
  if (!fs.existsSync(ready)) {
    pushEvent(run, 'info', `Preparing isolated Python environment (${normalized.join(', ')})`, nodeId)
    fs.mkdirSync(envDir, { recursive: true })
    if (!fs.existsSync(python)) await runProcess('python3', ['-m', 'venv', envDir], { cwd, timeout: 120000, run, nodeId })
    const installed = await runProcess(python, ['-m', 'pip', 'install', '--disable-pip-version-check', ...normalized], { cwd, timeout: 600000, run, nodeId })
    if (installed.stdout) pushEvent(run, 'log', installed.stdout, nodeId)
    if (installed.stderr) pushEvent(run, 'log', installed.stderr, nodeId)
    atomicWriteJsonSync(ready, { dependencies: normalized, createdAt: Date.now() })
  }
  return python
}

function runRelativePath(configured, fallback) {
  const raw = String(configured || fallback || '').trim()
  if (!raw) throw new Error('a file path is required')
  return raw
}
function externalRegularFile(configured, label = 'input file') {
  const file = path.resolve(String(configured || '').replace(/^~(?=\/)/, HOME))
  if (!configured || !fs.existsSync(file)) throw new Error(`${label} not found: ${file}`)
  const entry = fs.lstatSync(file)
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} must be a real regular file: ${file}`)
  return fs.realpathSync(file)
}
function externalDirectory(configured, label = 'folder') {
  const folder = path.resolve(String(configured || '').replace(/^~(?=\/)/, HOME))
  if (!configured || !fs.existsSync(folder)) throw new Error(`${label} not found: ${folder}`)
  const entry = fs.lstatSync(folder)
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a real directory: ${folder}`)
  return fs.realpathSync(folder)
}
function isLoopbackUrl(value) {
  try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname) } catch { return false }
}

function valueAtPath(value, selector) {
  if (!selector) return value
  return String(selector).split('.').filter(Boolean).reduce((v, key) => v == null ? undefined : v[key], value)
}

function setAtPath(target, selector, value) {
  const parts = String(selector || '').split('.').filter(Boolean)
  if (!parts.length) return value
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]] ||= {}
  cursor[parts[parts.length - 1]] = value
  return target
}

function inputPaths(raw) {
  if (Array.isArray(raw)) return raw.map(String)
  try { const parsed = JSON.parse(String(raw || '')); if (Array.isArray(parsed)) return parsed.map(x => typeof x === 'string' ? x : x?.path).filter(Boolean) } catch {}
  return String(raw || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

async function extractPdfText(file) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: fs.readFileSync(file) })
  try { return (await parser.getText()).text || '' } finally { await parser.destroy().catch(() => {}) }
}

async function invokeMcp(serverName, tool, args, timeoutMs = 60000, options = {}) {
  const config = readMcpRegistry()[serverName]
  if (!config) throw new Error(`MCP server "${serverName}" is not configured`)
  assertMcpExecutable(config)
  const allowedTool = assertMcpToolAllowed(config, tool, options.policies || [])
  try {
    const response = config.type === 'remote'
      ? await requestRemoteMcp(config, 'tools/call', { name: allowedTool, arguments: args }, { timeoutMs, signal: options.signal, ...remoteMcpAuthOptions(config, secretReferenceRegistry) })
      : await requestLocalMcp(config, 'tools/call', { name: allowedTool, arguments: args }, { ...options, timeoutMs, terminateProcess })
    return response.result
  } catch (error) { throw normalizeMcpError(error) }
}
async function discoverMcp(serverName, timeoutMs = 10000) {
  const config = readMcpRegistry()[serverName]
  if (!config) throw new Error(`MCP server "${serverName}" is not configured`)
  assertMcpExecutable(config)
  const response = config.type === 'remote'
    ? await requestRemoteMcp(config, 'tools/list', {}, { timeoutMs, ...remoteMcpAuthOptions(config, secretReferenceRegistry) })
    : await requestLocalMcp(config, 'tools/list', {}, { timeoutMs, terminateProcess })
  return { tools: response.result?.tools || [], serverInfo: response.serverInfo || {} }
}
// run one opencode step; resolve with captured stdout text
async function runStep({ run, nodeId, label, model, instruction, cwd, subprocessLimit = null }) {
  pushEvent(run, 'info', `▶ ${label} — ${model}`, nodeId)
  await ensureModelReady(run, model)
  const execute = () => new Promise((resolve, reject) => {
    const proc = spawn(OPENCODE, ['run', instruction, '--model', model], { cwd, env: { ...providerExecutionEnv(), PWD: cwd }, stdio: ['ignore', 'pipe', 'pipe'] })
    run.proc = proc
    run.procs ||= new Set(); run.procs.add(proc)
    let buf = '', text = ''
    const onData = chunk => {
      buf += String(chunk); const lines = buf.split('\n'); buf = lines.pop()
      for (const raw of lines) {
        const line = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trimEnd()
        if (line.trim()) { pushEvent(run, 'log', line, nodeId); text += line + '\n' }
      }
    }
    proc.stdout.on('data', onData); proc.stderr.on('data', onData)
    proc.on('exit', code => {
      run.procs?.delete(proc)
      if (buf.trim()) { pushEvent(run, 'log', buf.trim(), nodeId); text += buf }
      if (run.cancelled) return resolve(text.trim())
      if (code === 0) { pushEvent(run, 'done', `✔ ${label} done`, nodeId); resolve(text.trim()) }
      else { pushEvent(run, 'error', `✘ ${label} failed (${code})`, nodeId); reject(new Error(`${label} failed with exit code ${code}`)) }
    })
    proc.on('error', err => { run.procs?.delete(proc); pushEvent(run, 'error', `✘ ${label} could not start: ${err.message}`, nodeId); reject(err) })
  })
  return run.resourceCoordinator
    ? run.resourceCoordinator.withResource('subprocess', { nodeId, limit: subprocessLimit }, execute)
    : execute()
}

app.post('/api/workflows/:id/run', async (req, res) => {
  if (!/^[a-z0-9_-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'invalid workflow id' })
  let triggerContext = null
  let parentOperation = null
  if (req.body.triggerContext != null) {
    const supplied = Buffer.from(String(req.get('x-command-center-trigger-secret') || ''))
    const expected = Buffer.from(TRIGGER_INTERNAL_SECRET)
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(403).json({ error: 'trigger execution context is server-owned' })
    try { triggerContext = normalizeTriggerContext(req.body.triggerContext) } catch (error) { return res.status(400).json({ error: error.message }) }
    if (triggerContext.workflowId !== req.params.id) return res.status(409).json({ error: 'trigger delivery workflow identity does not match this route' })
  }
  if (req.body.parentOperation != null) {
    const supplied = Buffer.from(String(req.get('x-command-center-trigger-secret') || ''))
    const expected = Buffer.from(TRIGGER_INTERNAL_SECRET)
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(403).json({ error: 'parent operation context is server-owned' })
    try { parentOperation = normalizeParentOperation(req.body.parentOperation) } catch (error) { return res.status(400).json({ error: error.message }) }
  }
  const resumeSource = req.body.resumeRunId && /^[a-z0-9_.-]+$/i.test(req.body.resumeRunId) ? readJson(path.join(RUNS_DIR, `${req.body.resumeRunId}.json`), null) : null
  if (req.body.resumeRunId && (!resumeSource || resumeSource.workflowId !== req.params.id)) return res.status(400).json({ error: 'resume checkpoint does not belong to this workflow' })
  let effectiveTriggerContext = triggerContext
  if (!effectiveTriggerContext && resumeSource?.triggerContext) {
    try { effectiveTriggerContext = normalizeTriggerContext(resumeSource.triggerContext) }
    catch (error) { return res.status(409).json({ error: `resume trigger context is invalid: ${error.message}` }) }
  }
  let resumedParentOperation = null
  if (resumeSource?.parentOperation) {
    try { resumedParentOperation = normalizeParentOperation(resumeSource.parentOperation) }
    catch (error) { return res.status(409).json({ error: `resume parent operation is invalid: ${error.message}` }) }
  }
  const requestedCandidateId = String(req.body.candidateId || resumeSource?.candidateId || '').trim()
  const candidate = requestedCandidateId ? governanceCandidates.find(requestedCandidateId) : null
  if (requestedCandidateId && (!candidate || candidate.workflowId !== req.params.id)) return res.status(409).json({ error: 'run requires a valid exact candidate for this workflow', code: 'INVALID_RUN_CANDIDATE' })
  let requestedVersion = String(req.body.workflowVersion || resumeSource?.workflowVersion || candidate?.workflowVersion || '').trim()
  if (candidate && requestedVersion !== candidate.workflowVersion) return res.status(409).json({ error: 'run workflow version does not match its exact candidate', code: 'CANDIDATE_VERSION_MISMATCH' })
  if (resumeSource?.workflowVersion && req.body.workflowVersion && req.body.workflowVersion !== resumeSource.workflowVersion) return res.status(409).json({ error: 'resume cannot change a pinned workflow version; explicitly update the parent subworkflow node before starting a new run' })
  let wf
  try {
    const definition = requestedVersion
      ? resolvePinnedWorkflowVersion(WF_VERSION_DIR, req.params.id, requestedVersion).workflow
      : JSON.parse(fs.readFileSync(path.join(WF_DIR, req.params.id + '.json'), 'utf8'))
    wf = migrateGovernanceLifecycle(migrateWorkflowDocument(definition)).workflow
    if (wf.governance?.lifecycle?.reviewRequired) return res.status(409).json({ error: 'review-required workflow cannot execute', code: 'LIFECYCLE_REVIEW_REQUIRED' })
    if (!requestedVersion) {
      const saved = saveWorkflowVersion(WF_VERSION_DIR, wf)
      requestedVersion = saved.id
    }
  } catch (error) {
    if (error?.code === 'MISSING_WORKFLOW_VERSION') return res.status(404).json({ error: error.message })
    if (error?.code === 'INVALID_WORKFLOW_VERSION' || error?.code === 'MISMATCHED_WORKFLOW_VERSION') return res.status(409).json({ error: error.message })
    return res.status(404).json({ error: 'no such workflow' })
  }
  const validation = workflowErrors(wf)
  if (validation.length) return res.status(400).json({ error: validation.join('; ') })
  const operationalEvidence = workflowOperationalEvidence(wf)
  if (candidate && (workflowContentHash(wf) !== candidate.sourceHash || operationalEvidence.operationalHash !== candidate.operationalHash || operationalEvidence.permissionHash !== candidate.permissionHash || operationalEvidence.secretManifestHash !== candidate.secretManifestHash || operationalEvidence.dependencyHash !== candidate.dependencyHash)) return res.status(409).json({ error: 'candidate evidence does not match its pinned workflow version', code: 'STALE_RUN_CANDIDATE' })
  if (triggerContext) {
    if ((triggerContext.workflowVersion || null) !== (requestedVersion || null)) return res.status(409).json({ error: 'trigger delivery workflow version does not match the requested version' })
    const canonical = (wf.triggers || []).find(item => item.id === triggerContext.triggerId)
    if (!canonical || canonical.workflowId !== wf.id) return res.status(409).json({ error: 'trigger delivery does not match the canonical workflow definition' })
    let existing
    try { existing = findTriggerRun({ activeRuns: runs.values(), runsDir: RUNS_DIR, context: triggerContext, workflowId: wf.id, workflowVersion: requestedVersion || null }) }
    catch (error) { return res.status(409).json({ error: error.message }) }
    if (existing) {
      return res.json({ runId: existing.id, duplicate: true })
    }
  }
  if (parentOperation) {
    let existing
    try { existing = findSubworkflowRun({ activeRuns: runs.values(), runsDir: RUNS_DIR, operation: parentOperation, workflowId: wf.id, workflowVersion: requestedVersion || null }) }
    catch (error) { return res.status(409).json({ error: error.message }) }
    if (existing) return res.json({ runId: existing.id, duplicate: true })
  }
  let order
  try { order = topoOrder(wf.nodes, wf.edges) } catch (e) { return res.status(400).json({ error: e.message }) }
  const inheritedContext = req.body.executionContext
    ? parseInheritedExecutionContext(req.body.executionContext, req.body.subworkflowStack)
    : resumeSource?.executionPolicy
      ? executionContextFromEvidence(resumeSource.executionPolicy)
      : parseInheritedExecutionContext(null, req.body.subworkflowStack)
  const subworkflowStack = inheritedContext.stack
  if (parentOperation && (inheritedContext.parentRunId !== parentOperation.parentRunId || inheritedContext.parentNodeId !== parentOperation.parentNodeId)) return res.status(409).json({ error: 'parent operation does not match inherited execution context' })
  if (subworkflowStack.length > MAX_SUBWORKFLOW_DEPTH) return res.status(400).json({ error: `subworkflow depth limit ${MAX_SUBWORKFLOW_DEPTH} exceeded before starting ${wf.id}` })
  if (subworkflowStack.includes(wf.id)) return res.status(400).json({ error: `recursive subworkflow reference detected: ${[...subworkflowStack, wf.id].join(' → ')}` })
  const input = String(req.body.input ?? resumeSource?.task ?? '').trim()
  const resumeFromNode = String(req.body.fromNodeId || resumeSource?.failedNodeId || resumeSource?.checkpoint?.lastNodeId || '')
  if (resumeFromNode && !wf.nodes.some(n => n.id === resumeFromNode)) return res.status(400).json({ error: 'resume node does not exist in this workflow version' })
  const requestedNodeIds = [...new Set((Array.isArray(req.body.nodeIds) ? req.body.nodeIds : []).map(String))]
  if (requestedNodeIds.some(id => !wf.nodes.some(node => node.id === id))) return res.status(400).json({ error: 'selected run contains a node that does not exist in this workflow version' })
  const safe = !!req.body.safe // safe preview: clamp critic loops to 1 and parallel to 1 branch
  const executionContext = effectiveExecutionContext({ inherited: inheritedContext, workflow: wf })
  const policyEvidence = executionPolicyEvidence(executionContext)
  const profile = req.body.profileId ? loadProfiles().find(p => p.id === req.body.profileId) : null
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex')
  const logicalRunId = resumeSource?.logicalRunId || resumeSource?.checkpoint?.logicalRunId || resumeSource?.id || runId
  const runtimeEpoch = crypto.randomUUID()
  let runControl
  try { runControl = createRunControl(resumeSource?.control || null) }
  catch (error) { return res.status(409).json({ error: `resume control state is invalid: ${error.message}`, code: 'INVALID_RUN_CONTROL' }) }
  const cwd = path.join(PIPE_WS, runId)
  fs.mkdirSync(cwd, { recursive: true })
  if (resumeSource?.dir && fs.existsSync(resumeSource.dir)) fs.cpSync(resumeSource.dir, cwd, { recursive: true, force: false })
  const effectiveParentOperation = parentOperation || resumedParentOperation
  const run = { id: runId, logicalRunId, runtimeEpoch, type: 'workflow', workflowId: wf.id, workflowVersion: requestedVersion || null, candidateId: candidate?.id || null, environment: candidate?.environment || wf.environment || 'development', ...operationalEvidence, workflowName: wf.name, task: input, status: 'running', paused: runControl.manualPause.paused, control: runControl, approvalComments: { ...(resumeSource?.approvalComments || {}) }, dir: cwd, events: [], listeners: new Set(), childRunIds: [], executionPolicy: policyEvidence, modelAbortController: new AbortController(), started: Date.now(), resumedFrom: resumeSource?.id || null, resumeFromNode: resumeFromNode || null, ...(effectiveTriggerContext ? { triggerContext: effectiveTriggerContext } : {}), ...(effectiveParentOperation ? { parentOperation: effectiveParentOperation } : {}) }
  runs.set(runId, run)
  persistRun(runId, run) // persist at start so it survives restarts (durability)
  res.json({ runId })
  appendAudit(resumeSource ? 'workflow_resumed' : 'workflow_run', { workflow: wf.name, runId, safe, resumedFrom: resumeSource?.id, fromNodeId: resumeFromNode || undefined })

  pushEvent(run, 'info', `▶ Workflow "${wf.name}" started — ${wf.nodes.length} nodes${requestedVersion ? ` · pinned ${requestedVersion}` : ''}${profile ? ` · tier: ${profile.name}` : ''}${safe ? ' · SAFE PREVIEW (limited)' : ''}`)
  const localForPolicy = await lmstudioModels().catch(() => [])
  const provs = readProviders()
  const cloudProv = provs.anthropic?.configured ? 'anthropic' : provs.openai?.configured ? 'openai' : null
  const policyMap = buildPolicyMap(localForPolicy, cloudProv)
  const nodeById = Object.fromEntries(wf.nodes.map(n => [n.id, n]))
  const incoming = {} // nodeId -> edges
  for (const e of wf.edges) (incoming[e.target] = incoming[e.target] || []).push(e)
  const requestedNodeId = String(req.body.nodeId || resumeFromNode || '')
  const runMode = ['selected', 'from', 'branch'].includes(req.body.runMode) ? req.body.runMode : resumeSource ? 'from' : 'full'
  const parents = Object.fromEntries(wf.nodes.map(node => [node.id, []])), children = Object.fromEntries(wf.nodes.map(node => [node.id, []]))
  for (const edge of wf.edges) { parents[edge.target]?.push(edge.source); children[edge.source]?.push(edge.target) }
  const closure = (start, graph) => { const result = new Set(), todo = start ? [start] : []; while (todo.length) { const id = todo.pop(); if (result.has(id)) continue; result.add(id); todo.push(...(graph[id] || [])) }; return result }
  let allowedNodes = new Set(order)
  if (requestedNodeIds.length && runMode === 'selected') {
    allowedNodes = new Set(requestedNodeIds)
    pushEvent(run, 'info', `▣ Running exactly ${requestedNodeIds.length} step${requestedNodeIds.length === 1 ? '' : 's'} from the selected workflow section`)
  } else if (requestedNodeId && runMode !== 'full') {
    const ancestors = closure(requestedNodeId, parents), descendants = closure(requestedNodeId, children)
    allowedNodes = runMode === 'selected' ? ancestors : new Set([...ancestors, ...descendants])
  }
  const disabledNodes = disabledWorkflowNodeIds(wf.groups, wf.nodes)
  for (const nodeId of disabledNodes) allowedNodes.delete(nodeId)
  if (disabledNodes.size) pushEvent(run, 'info', `⊘ Skipping ${disabledNodes.size} step${disabledNodes.size === 1 ? '' : 's'} in disabled workflow sections`)
  const triggerReceipt = effectiveTriggerContext ? { receiptRef: `trigger:${effectiveTriggerContext.deliveryId}`, deliveryId: effectiveTriggerContext.deliveryId, deliveryKey: effectiveTriggerContext.deliveryKey, triggerId: effectiveTriggerContext.triggerId, workflowId: effectiveTriggerContext.workflowId, workflowVersion: effectiveTriggerContext.workflowVersion, source: effectiveTriggerContext.source } : null
  const checkpointIdentity = { logicalRunId, workflowVersion: requestedVersion, workflowVersionHash: workflowContentHash(wf), nodeIds: wf.nodes.map(node => node.id), runtimeEpoch, executionPolicy: policyEvidence, triggerReceipt }
  const unsafeRecoveryNodeIds = wf.nodes.filter(node => {
    if (node.type === 'http') return !['GET', 'HEAD', 'OPTIONS'].includes(String(node.data?.method || 'GET').toUpperCase())
    return ['obsidian-write', 'python', 'shell', 'write-file', 'mcp', 'subworkflow', 'agent', 'orchestrator', 'custom'].includes(node.type)
  }).map(node => node.id)
  try {
    if (resumeSource?.checkpoint?.schemaVersion === 2) {
      validateCheckpoint(resumeSource.checkpoint)
      if (resumeSource.checkpoint.workflowVersion !== requestedVersion || resumeSource.checkpoint.workflowVersionHash !== checkpointIdentity.workflowVersionHash) throw new Error('resume checkpoint identity does not match the pinned workflow definition')
      const reconcile = {}
      for (const node of Object.values(resumeSource.checkpoint.nodes)) {
        const evidence = node.effect?.reconciliation
        if (node.state === 'running' && node.effect?.state === 'inflight' && evidence?.kind === 'subworkflow') {
          reconcile[node.nodeId] = 'absent'
          continue
        }
        if (node.state !== 'running' || node.effect?.state !== 'inflight' || evidence?.kind !== 'file-write') continue
        try {
          const target = resolvePathBeneath(cwd, evidence.relativePath, { allowMissing: true })
          if (!fs.existsSync(target.path)) reconcile[node.nodeId] = 'absent'
          else {
            const value = readFileBeneath(cwd, evidence.relativePath, evidence.encoding || 'utf8')
            const actualHash = crypto.createHash('sha256').update(value, evidence.encoding || 'utf8').digest('hex')
            if (actualHash === evidence.contentHash) reconcile[node.nodeId] = 'confirmed'
          }
        } catch {}
      }
      run.checkpoint = recoverCheckpoint(resumeSource.checkpoint, { runtimeEpoch, unsafeNodeIds: unsafeRecoveryNodeIds, reconcile })
    } else if (resumeSource?.checkpoint) {
      run.checkpoint = migrateLegacyCheckpoint(resumeSource.checkpoint, checkpointIdentity)
    } else {
      run.checkpoint = createCheckpoint(checkpointIdentity)
    }
    if (triggerReceipt) {
      const existingReceipt = run.checkpoint.triggerReceipt
      if (existingReceipt && (existingReceipt.deliveryId !== triggerReceipt.deliveryId || existingReceipt.deliveryKey !== triggerReceipt.deliveryKey || existingReceipt.triggerId !== triggerReceipt.triggerId || existingReceipt.workflowVersion !== triggerReceipt.workflowVersion)) throw new Error('resume checkpoint trigger receipt conflicts with the persisted delivery identity')
      run.checkpoint.triggerReceipt = triggerReceipt
      validateCheckpoint(run.checkpoint)
    }
  } catch (error) {
    run.status = 'failed'; run.ended = Date.now(); run.checkpointError = error.message
    pushEvent(run, 'error', `✘ Checkpoint rejected: ${error.message}`)
    persistRun(runId, run)
    return
  }
  if (resumeSource && resumeFromNode) {
    const resetIds = runMode === 'selected' ? [resumeFromNode] : [...closure(resumeFromNode, children)]
    run.checkpoint = resetCheckpointNodes(run.checkpoint, resetIds)
  }
  const reviewNodes = Object.values(run.checkpoint.nodes).filter(node => node.state === 'needs_review').map(node => node.nodeId)
  if (reviewNodes.length) {
    run.status = 'needs_review'; run.needsReviewNodes = reviewNodes; run.ended = Date.now()
    pushEvent(run, 'error', `⚠ Recovery stopped for review: uncertain external effect at ${reviewNodes.join(', ')}`)
    persistRun(runId, run)
    return
  }
  const outputs = run.checkpoint.outputs // nodeId -> text
  const routes = run.checkpoint.routes // decision node id -> true/false
  const skipped = new Set(run.checkpoint.skipped)
  const resourcePolicy = executionContext.resources
  let resourceCoordinator
  const persistResourceState = () => {
    run.resources = resourceCoordinator.snapshot()
    run.checkpoint.updatedAt = Date.now()
    persistRun(runId, run)
  }
  resourceCoordinator = new ResourceCoordinator(resourcePolicy, {
    onWait: (request, snapshot) => { run.resources = snapshot; pushEvent(run, 'info', `⌛ ${request.nodeId || 'workflow'} waiting for ${request.kind} capacity`, request.nodeId); persistRun(runId, run) },
    onAcquire: (lease, snapshot) => { run.resources = snapshot; run.checkpoint.activeLeases.push({ id: lease.id, kind: lease.kind, nodeId: lease.nodeId, acquiredAt: lease.acquiredAt }); pushEvent(run, 'info', `◆ ${lease.nodeId || 'workflow'} acquired ${lease.kind} capacity`, lease.nodeId); persistResourceState() },
    onRelease: (lease, snapshot) => { run.resources = snapshot; run.checkpoint.activeLeases = run.checkpoint.activeLeases.filter(item => item.id !== lease.id); pushEvent(run, 'info', `◇ ${lease.nodeId || 'workflow'} released ${lease.kind} capacity`, lease.nodeId); persistResourceState() },
    onCancel: (request, snapshot) => { run.resources = snapshot; pushEvent(run, 'info', `⏹ ${request.nodeId || 'workflow'} resource wait cancelled`, request.nodeId); persistRun(runId, run) },
    onPause: snapshot => { run.resources = snapshot; persistRun(runId, run) },
  })
  run.resourceCoordinator = resourceCoordinator
  run.resourcePolicy = resourcePolicy
  run.resources = resourceCoordinator.snapshot()
  persistRun(runId, run)
  const workflowVariables = wf.variables && typeof wf.variables === 'object' ? wf.variables : {}
  const resolveForRun = ref => {
    const model = resolveModel(ref, profile, policyMap)
    if (executionContext.localOnly && !String(model).startsWith('lmstudio/')) throw new Error(`cloud model ${shortRef(model)} is blocked by the effective local-only workflow policy`)
    return model
  }
  const permissionAllowed = (node, capability) => {
    const workflowPolicy = executionContext.permissions?.[capability]
    const nodePolicy = node.permissions?.[capability] ?? node.data?.permissions?.[capability]
    return workflowPolicy !== false && nodePolicy !== false
  }
  const requirePermission = (node, capability) => { if (!permissionAllowed(node, capability)) throw new Error(`${node.data?.label || node.id} is not permitted to ${capability.replace(/-/g, ' ')}`) }
  const fillTemplate = (tpl) => (tpl || '{{input}}')
    .replace(/\{\{\s*input\s*\}\}/g, input)
    .replace(/\{\{\s*vars\.([\w-]+)\s*\}\}/g, (_m, key) => {
      const value = workflowVariables[key]
      return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    })
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_m, ref) => outputs[ref] ?? '')

  const waitIfPaused = async () => { while (run.paused && !run.cancelled) { await new Promise(r => setTimeout(r, 400)) } }
  const concurrentMap = async (items, concurrency, worker) => {
    const results = new Array(items.length), next = { value: 0 }
    const consume = async () => {
      while (!run.cancelled) {
        const index = next.value++
        if (index >= items.length) return
        await waitIfPaused(); results[index] = await worker(items[index], index)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1)) }, consume))
    return results.filter(x => x !== undefined)
  }
  const modelStep = async (args, nodeData = {}) => {
    const retries = safe ? 0 : Math.max(0, Math.min(5, Number(nodeData.retries ?? wf.settings?.retries ?? 0)))
    let lastError
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const node = nodeById[args.nodeId]
        return await resourceCoordinator.withResource('model', { nodeId: args.nodeId, limit: nodeResourceLimit(node, 'model'), signal: run.modelAbortController.signal }, () => withGlobalModel(run, args.model, args.nodeId, () => runStep({ ...args, subprocessLimit: nodeResourceLimit(node, 'subprocess') })))
      }
      catch (error) {
        lastError = error
        if (attempt < retries && !run.cancelled) {
          const base = Math.max(100, Math.min(5000, Number(nodeData.retryBackoffMs ?? wf.settings?.retryBackoffMs ?? 500))), delay = Math.min(10000, base * 2 ** attempt)
          pushEvent(run, 'info', `⟳ Retrying ${args.label} in ${delay}ms (${attempt + 1}/${retries})`, args.nodeId)
          const until = Date.now() + delay
          while (!run.cancelled && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())))
        }
      }
    }
    throw lastError
  }
  let activeNodeId = null
  try {
    const executeNode = async nid => {
      if (!allowedNodes.has(nid)) return
      if (['succeeded', 'skipped'].includes(run.checkpoint.nodes[nid]?.state)) { pushEvent(run, 'info', `↳ ${nodeById[nid]?.data?.label || nid} restored from checkpoint`, nid); return }
      activeNodeId = nid
      await waitIfPaused()
      if (wf.settings?.maxDuration && Date.now() - run.started > Number(wf.settings.maxDuration)) throw new Error(`workflow exceeded its ${Math.round(Number(wf.settings.maxDuration) / 60000)} minute duration limit`)
      if (run.cancelled) { run.status = 'cancelled'; run.ended = Date.now(); pushEvent(run, 'info', '⏹ Cancelled by user'); return }
      let node = nodeById[nid]; if (!node) return
      if (node.type === 'custom') {
        const definition = customNodes().find(x => x.id === node.data?.customNodeId)
        if (!definition) throw new Error(`${node.data?.label || nid} references a custom node that is not installed`)
        if (definition.enabled === false) throw new Error(`${node.data?.label || nid} references a disabled custom node`)
        let plugin = null
        if (definition.pluginId) {
          plugin = readJson(PLUGINS_FILE, []).find(item => item.id === definition.pluginId)
          if (!plugin?.enabled || !['trusted', 'verified'].includes(plugin.trustStatus)) throw new Error(`${node.data?.label || nid} belongs to an untrusted or disabled plugin`)
        }
        const requestedCapabilities = [...new Set([...(definition.permissions || []), ...(plugin?.permissions || [])].map(String))]
        const unsupported = requestedCapabilities.find(capability => !WORKFLOW_CAPABILITIES.includes(capability))
        if (unsupported) throw new Error(`${node.data?.label || nid} requests unsupported capability ${unsupported}`)
        for (const capability of requestedCapabilities) requirePermission(node, capability)
        const kind = definition.implementation?.kind === 'transform' ? 'json-transform' : definition.implementation?.kind
        node = { ...node, type: kind, data: { ...(definition.implementation?.config || {}), ...definition.implementation, ...(node.data || {}), customDefinitionId: definition.id } }
      }
      const d = node.data || {}
      const incomingEdges = incoming[nid] || []
      const activeEdges = incomingEdges.filter(e => {
        if (skipped.has(e.source)) return false
        if (routes[e.source] == null) return true
        const expected = e.data?.condition
        return expected == null ? true : String(expected) === String(routes[e.source])
      })
      if (incomingEdges.length && !activeEdges.length) {
        skipped.add(nid); outputs[nid] = ''
        pushEvent(run, 'info', `○ ${d.label || nid} skipped — route not active`, nid)
        return
      }
      const transferred = activeEdges.map(e => {
        const raw = outputs[e.source] ?? ''
        const mapping = e.data?.mapping
        let value = raw
        if (mapping && typeof mapping === 'object' && Object.keys(mapping).length) {
          let source
          try { source = JSON.parse(raw) } catch { throw new Error(`connection ${e.source} → ${e.target} has field mapping but the source output is not valid JSON`) }
          let mapped = {}
          for (const [sourceField, destinationField] of Object.entries(mapping)) mapped = setAtPath(mapped, destinationField, valueAtPath(source, sourceField))
          value = mapped
        }
        if (e.data?.coercion) {
          try { value = coerceValue(value, e.data.coercion) }
          catch (error) { throw new Error(`connection ${e.source} → ${e.target} could not coerce to ${e.data.coercion}: ${error.message}`) }
        }
        const targetContract = contractFor(nodeById[e.target]), targetPort = targetContract.inputs.find(port => port.id === (e.targetHandle || 'input')) || targetContract.inputs[0]
        const validationErrors = validateSchema(value, e.data?.schema || targetPort?.schema)
        if (validationErrors.length) throw new Error(`connection ${e.source} → ${e.target} failed schema validation: ${validationErrors.join('; ')}`)
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      })
      const upstream = transferred.filter(Boolean).join('\n\n')
      if (d.disabled) { outputs[nid] = upstream || input; pushEvent(run, 'info', `○ ${d.label || nid} disabled — input passed through`, nid); return }
      if (d.breakpoint) {
        pushEvent(run, 'info', `◎ Breakpoint before ${d.label || nid}: inspect current variables, then continue or stop`, nid)
        while (!run.approvals[nid] && !run.cancelled) await new Promise(resolve => setTimeout(resolve, 350))
        if (run.cancelled) return
        if (run.approvals[nid].decision !== 'approved') throw new Error(`stopped at breakpoint before ${d.label || nid}`)
      }
      if (node.type === 'input') { outputs[nid] = input; pushEvent(run, 'done', `✔ ${d.label || 'Input'} received`, nid); return }
      if (node.type === 'output') { outputs[nid] = upstream; pushEvent(run, 'done', `✔ ${d.label || 'Output'} collected`, nid); return }
      const cacheable = ['check', 'json-transform'].includes(node.type) && wf.settings?.cache !== false && d.cache !== false
      const cacheKey = cacheable ? crypto.createHash('sha256').update(JSON.stringify({ workflowId: wf.id, nodeId: nid, definition: d, upstream })).digest('hex') : ''
      const cached = cacheable ? readJson(WORKFLOW_CACHE_FILE, {})[cacheKey] : null
      if (cached) { outputs[nid] = cached.value; pushEvent(run, 'done', `⚡ ${d.label || nid}: reused verified cached output`, nid); return }
      const storeCache = value => {
        if (!cacheable) return
        const next = readJson(WORKFLOW_CACHE_FILE, {}); next[cacheKey] = { value, workflowId: wf.id, nodeId: nid, createdAt: Date.now() }
        writeJson(WORKFLOW_CACHE_FILE, Object.fromEntries(Object.entries(next).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 500)))
      }

      let instruction = fillTemplate(d.instruction)
      if (!instruction.trim()) instruction = upstream || input
      if (Array.isArray(d.skills) && d.skills.length) {
        const skillTexts = []
        for (const rel of d.skills.slice(0, 12)) {
          if (typeof rel !== 'string' || !rel.startsWith(`${SKILLS_REL}/`) || rel.includes('..')) continue
          try { skillTexts.push(readFileBeneath(BRAIN_DIR, rel, 'utf8')) } catch {}
        }
        if (skillTexts.length) instruction = `Follow these reusable skill playbooks when completing the task:\n\n${skillTexts.join('\n\n---\n\n')}\n\n## Task\n${instruction}`
      }

      if (node.type === 'file-input') {
        requirePermission(node, 'read-files')
        const files = inputPaths(d.paths || d.path).map(p => externalRegularFile(p))
        if (!files.length) throw new Error(`${d.label || nid} needs at least one configured file`)
        outputs[nid] = d.readText ? files.map(file => `--- ${file} ---\n${fs.readFileSync(file, d.encoding || 'utf8')}`).join('\n\n') : JSON.stringify(files, null, 2)
        pushEvent(run, 'done', `✔ ${d.label || nid}: selected ${files.length} file(s)`, nid)
        return
      }

      if (node.type === 'folder-input') {
        requirePermission(node, 'read-files')
        const folder = externalDirectory(d.path, `${d.label || nid} folder`)
        const maxFiles = Math.max(1, Math.min(5000, Number(d.maxFiles) || 500))
        const extensions = String(d.extensions || '').split(',').map(x => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
        const found = []
        const visit = current => {
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (found.length >= maxFiles || entry.name.startsWith('.') || entry.isSymbolicLink()) continue
            const full = path.join(current, entry.name)
            if (entry.isDirectory() && d.recursive) visit(full)
            else if (entry.isFile() && (!extensions.length || extensions.includes(path.extname(entry.name).slice(1).toLowerCase()))) found.push(full)
          }
        }
        visit(folder)
        outputs[nid] = JSON.stringify(found, null, 2)
        pushEvent(run, 'done', `✔ ${d.label || nid}: found ${found.length} file(s)`, nid)
        return
      }

      if (node.type === 'pdf-reader') {
        requirePermission(node, 'read-files')
        const files = inputPaths(upstream || d.path).map(p => externalRegularFile(p, 'PDF')).filter(p => p.toLowerCase().endsWith('.pdf'))
        if (!files.length) throw new Error(`${d.label || nid} received no PDF paths`)
        const chunks = []
        for (const file of files.slice(0, Math.max(1, Math.min(200, Number(d.maxFiles) || 50)))) {
          chunks.push(`--- SOURCE: ${file} ---\n${await extractPdfText(file)}`)
        }
        outputs[nid] = chunks.join('\n\n')
        pushEvent(run, 'done', `✔ ${d.label || nid}: extracted ${chunks.length} PDF(s)`, nid)
        return
      }

      if (node.type === 'obsidian-read') {
        requirePermission(node, 'read-files')
        const vault = externalDirectory(d.vaultPath || path.join(HOME, 'AgentBrain'), `${d.label || nid} vault`)
        const note = String(d.notePath || '').replace(/^\/+/, '')
        const file = resolvePathBeneath(vault, note).path
        outputs[nid] = readFileBeneath(vault, note, 'utf8')
        pushEvent(run, 'done', `✔ ${d.label || nid}: read ${path.relative(vault, file)}`, nid)
        return
      }

      if (node.type === 'obsidian-write') {
        requirePermission(node, 'write-files')
        const vault = externalDirectory(d.vaultPath || path.join(HOME, 'AgentBrain'), `${d.label || nid} vault`)
        let note = fillTemplate(d.notePath || `${wf.name || 'Workflow Result'}.md`).replace(/^\/+/, '')
        if (!path.extname(note)) note += '.md'
        const content = redactReleaseValue(String(upstream || input || ''))
        const file = writeFileBeneath(vault, note, d.append ? `\n\n${content}` : content, { append: d.append === true })
        outputs[nid] = file
        pushEvent(run, 'done', `✔ ${d.label || nid}: wrote ${path.relative(vault, file)}`, nid)
        return
      }

      if (node.type === 'check') {
        // deterministic evaluation — reliable, no model involved
        const content = (upstream || input || '').toString()
        const c = d.checks || {}
        const fails = []
        if (c.contains) for (const kw of String(c.contains).split(',').map(s => s.trim()).filter(Boolean)) if (!content.toLowerCase().includes(kw.toLowerCase())) fails.push(`missing "${kw}"`)
        if (c.minLength && content.length < c.minLength) fails.push(`too short (needs ≥${c.minLength} chars, has ${content.length})`)
        if (c.isJson) { try { JSON.parse(content) } catch { fails.push('not valid JSON') } }
        outputs[nid] = content // pass content through so downstream still gets it
        if (fails.length) {
          pushEvent(run, 'error', `✘ ${d.label || nid}: ${fails.join('; ')}`, nid)
          throw new Error(`${d.label || nid} failed: ${fails.join('; ')}`)
        }
        pushEvent(run, 'done', `✔ ${d.label || nid}: all checks passed`, nid)
        storeCache(outputs[nid])
        return
      }

      if (node.type === 'if') {
        const raw = upstream || input || ''
        let subject = raw
        if (d.selector) {
          try { subject = valueAtPath(JSON.parse(raw), d.selector) } catch { subject = undefined }
        }
        const expected = d.value ?? ''
        let passed = false
        switch (d.operator || 'contains') {
          case 'equals': passed = String(subject) === String(expected); break
          case 'not-equals': passed = String(subject) !== String(expected); break
          case 'matches': passed = new RegExp(String(expected), d.caseSensitive ? '' : 'i').test(String(subject)); break
          case 'greater': passed = Number(subject) > Number(expected); break
          case 'less': passed = Number(subject) < Number(expected); break
          case 'exists': passed = subject !== undefined && subject !== null && subject !== ''; break
          default: passed = d.caseSensitive
            ? String(subject).includes(String(expected))
            : String(subject).toLowerCase().includes(String(expected).toLowerCase())
        }
        routes[nid] = passed
        outputs[nid] = raw
        pushEvent(run, 'done', `◆ ${d.label || nid}: ${passed ? 'Yes' : 'No'} route selected`, nid)
        return
      }

      if (node.type === 'delay') {
        const ms = Math.max(0, Math.min(300000, Number(d.durationMs) || 1000))
        pushEvent(run, 'info', `◷ ${d.label || nid} — waiting ${ms < 1000 ? `${ms} ms` : `${ms / 1000} s`}`, nid)
        const until = Date.now() + (safe ? Math.min(ms, 1000) : ms)
        while (!run.cancelled && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())))
        if (run.cancelled) return
        outputs[nid] = upstream || input
        pushEvent(run, 'done', `✔ ${d.label || nid} continued`, nid)
        return
      }

      if (node.type === 'human-approval') {
        outputs[nid] = upstream || input
        const timeout = Math.max(60000, Math.min(86400000, Number(d.timeoutMs) || 21600000))
        const startedWaiting = Date.now()
        const attemptId = run.checkpoint.nodes[nid].activeAttempt.id
        const requested = requestApproval(run.control, {
          runId: logicalRunId,
          workflowVersionHash: run.checkpoint.workflowVersionHash,
          nodeExecKey: run.checkpoint.nodes[nid].execKey,
          operationKey: run.checkpoint.nodes[nid].effect?.operationKey,
          inputHash: run.checkpoint.nodes[nid].inputHash,
          permissionHash: run.permissionHash,
          message: d.message || d.label || 'Review the result before continuing',
          nodeId: nid,
          expiresAt: startedWaiting + timeout,
        })
        run.control = requested.control
        let approval = run.control.approvals[requested.approval.id]
        if (approval.state === 'pending') {
          run.checkpoint = waitNode(run.checkpoint, nid, attemptId, { kind: 'approval', ref: approval.id })
          persistRun(runId, run)
          pushEvent(run, 'info', `◎ Approval required: ${d.message || d.label || 'Review the result before continuing'}`, nid)
        }
        while (approval.state === 'pending' && !run.cancelled && Date.now() - startedWaiting < timeout) {
          await new Promise(resolve => setTimeout(resolve, 250))
          approval = run.control.approvals[requested.approval.id]
        }
        if (run.cancelled) return
        if (approval.state === 'pending') throw new Error(`${d.label || nid} approval timed out`)
        if (run.checkpoint.nodes[nid].state === 'waiting') run.checkpoint = resumeWaitingNode(run.checkpoint, nid, attemptId, approval.id)
        const comment = run.approvalComments[approval.id] || ''
        if (approval.state !== 'approved') throw new Error(`${d.label || nid} was rejected${comment ? `: ${comment}` : ''}`)
        if (comment) outputs[nid] += `\n\nReviewer direction:\n${comment}`
        pushEvent(run, 'done', `✔ ${d.label || nid} approved${comment ? ` — ${comment}` : ''}`, nid)
        return
      }

      if (node.type === 'json-transform') {
        let value
        try { value = JSON.parse(upstream || input || 'null') } catch { throw new Error(`${d.label || nid} expected valid JSON input`) }
        value = valueAtPath(value, d.selector)
        if (d.mode === 'pick' && Array.isArray(d.fields) && value && typeof value === 'object') {
          value = Object.fromEntries(d.fields.filter(Boolean).map(key => [key, value[key]]))
        }
        outputs[nid] = d.pretty === false ? JSON.stringify(value) : JSON.stringify(value, null, 2)
        storeCache(outputs[nid])
        pushEvent(run, 'done', `✔ ${d.label || nid} transformed JSON`, nid)
        return
      }

      if (node.type === 'python') {
        requirePermission(node, 'execute-code')
        if (Array.isArray(d.dependencies) && d.dependencies.length) requirePermission(node, 'install-packages')
        const code = String(d.code || '').trim()
        if (!code) throw new Error(`${d.label || nid} has no Python code`)
        const script = writeFileBeneath(cwd, `.nodes/${nid}.py`, code)
        pushEvent(run, 'info', `▶ ${d.label || nid} — Python`, nid)
        const payload = JSON.stringify({ input: upstream || input, workflowInput: input, outputs })
        const python = await pythonExecutableFor(d, run, nid, cwd)
        const result = await runProcess(python, [script], { cwd, input: payload, timeout: Math.max(1000, Math.min(300000, Number(d.timeoutMs) || 120000)), run, nodeId: nid, resourceLimit: nodeResourceLimit(node, 'subprocess') })
        if (result.stderr) pushEvent(run, 'log', result.stderr, nid)
        outputs[nid] = result.stdout
        pushEvent(run, 'done', `✔ ${d.label || nid} completed`, nid)
        return
      }

      if (node.type === 'shell') {
        requirePermission(node, 'execute-shell')
        const command = String(d.command || '').trim()
        if (!command) throw new Error(`${d.label || nid} has no command`)
        pushEvent(run, 'info', `▶ ${d.label || nid} — shell`, nid)
        const result = await runProcess('/bin/zsh', ['-lc', command], { cwd, input: upstream || input, timeout: Math.max(1000, Math.min(300000, Number(d.timeoutMs) || 120000)), run, nodeId: nid, resourceLimit: nodeResourceLimit(node, 'subprocess') })
        if (result.stderr) pushEvent(run, 'log', result.stderr, nid)
        outputs[nid] = result.stdout
        pushEvent(run, 'done', `✔ ${d.label || nid} completed`, nid)
        return
      }

      if (node.type === 'read-file') {
        requirePermission(node, 'read-files')
        const relative = runRelativePath(d.path)
        const file = resolvePathBeneath(cwd, relative).path
        outputs[nid] = readFileBeneath(cwd, relative, d.encoding || 'utf8')
        pushEvent(run, 'done', `✔ ${d.label || nid} read ${path.relative(cwd, file)}`, nid)
        return
      }

      if (node.type === 'write-file') {
        requirePermission(node, 'write-files')
        const relative = runRelativePath(d.path, 'output.txt')
        const encoding = d.encoding || 'utf8'
        const content = redactReleaseValue(String(upstream || input || ''))
        const contentHash = crypto.createHash('sha256').update(content, encoding).digest('hex')
        const attemptId = run.checkpoint.nodes[nid].activeAttempt.id
        run.checkpoint = prepareEffect(run.checkpoint, nid, attemptId, { requestHash: crypto.createHash('sha256').update(JSON.stringify({ relative, encoding, contentHash })).digest('hex'), reconciliation: { kind: 'file-write', relativePath: relative, encoding, contentHash }, output: relative })
        persistRun(runId, run)
        run.checkpoint = markEffectInflight(run.checkpoint, nid, attemptId)
        persistRun(runId, run)
        const file = writeFileBeneath(cwd, relative, content, { encoding })
        if (process.env.ACC_TEST_CRASH_AFTER_EFFECT === `${wf.id}:${nid}:file-write`) process.kill(process.pid, 'SIGKILL')
        outputs[nid] = path.relative(cwd, file)
        run.checkpoint = confirmEffect(run.checkpoint, nid, attemptId, { receiptRef: `file:sha256:${contentHash}`, output: outputs[nid], outputHash: crypto.createHash('sha256').update(outputs[nid]).digest('hex') })
        persistRun(runId, run)
        pushEvent(run, 'done', `✔ ${d.label || nid} saved ${outputs[nid]}`, nid)
        return
      }

      if (node.type === 'http') {
        requirePermission(node, 'network')
        const url = validateCredentialSafeHttpUrl(fillTemplate(d.url))
        if (executionContext.localOnly && !isLoopbackUrl(url)) throw new Error(`${d.label || nid} is blocked from remote network access by the effective local-only workflow policy`)
        const method = String(d.method || 'GET').toUpperCase()
        const requestBody = ['GET', 'HEAD'].includes(method) ? undefined : (upstream || input || d.body || '')
        const headers = authorizedHttpHeaders(d, secretReferenceRegistry)
        const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method)
        const attemptId = run.checkpoint.nodes[nid].activeAttempt.id
        if (mutating) {
          const requestHash = crypto.createHash('sha256').update(JSON.stringify({ method, url, body: requestBody || '', headerNames: Object.keys(headers).map(value => value.toLowerCase()).sort() })).digest('hex')
          run.checkpoint = prepareEffect(run.checkpoint, nid, attemptId, { requestHash, reconciliation: { kind: 'http', method, origin: new URL(url).origin } })
          const idempotencyHeader = String(d.idempotencyHeader || '').trim()
          if (idempotencyHeader) headers[idempotencyHeader] = run.checkpoint.nodes[nid].effect.operationKey
          persistRun(runId, run)
          run.checkpoint = markEffectInflight(run.checkpoint, nid, attemptId)
          persistRun(runId, run)
        }
        pushEvent(run, 'info', `▶ ${d.label || nid} — ${method} ${new URL(url).host}`, nid)
        const { response, body } = await resourceCoordinator.withResource('http', { nodeId: nid, limit: nodeResourceLimit(node, 'http') }, async () => {
          const controller = new AbortController(); run.controllers ||= new Set(); run.controllers.add(controller)
          try {
            const response = await fetch(url, {
              method,
              headers,
              body: requestBody,
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1000, Math.min(120000, Number(d.timeoutMs) || 30000)))]),
            })
            return { response, body: await response.text() }
          } finally { run.controllers.delete(controller) }
        })
        if (mutating) {
          run.checkpoint = confirmEffect(run.checkpoint, nid, attemptId, { receiptRef: `http:${response.status}`, output: body, outputHash: crypto.createHash('sha256').update(body).digest('hex') })
          persistRun(runId, run)
        }
        if (!response.ok && d.failOnError !== false) throw new Error(`${method} ${new URL(url).origin} returned HTTP ${response.status}`)
        outputs[nid] = body
        pushEvent(run, 'done', `✔ ${d.label || nid}: HTTP ${response.status}`, nid)
        return
      }

      if (node.type === 'mcp') {
        requirePermission(node, 'tools')
        const serverId = String(d.server || '')
        const toolName = String(d.tool || '')
        const mcpConfig = readMcpRegistry()[serverId]
        if (executionContext.localOnly && mcpConfig?.type === 'remote' && !isLoopbackUrl(mcpConfig.url)) throw new Error(`${d.label || nid} is blocked from remote MCP access by the effective local-only workflow policy`)
        let args = d.arguments && typeof d.arguments === 'object' ? d.arguments : {}
        if (upstream) { try { args = JSON.parse(upstream) } catch { args = { ...args, input: upstream } } }
        if (!mcpConfig) throw new Error(`MCP server "${serverId}" is not configured`)
        assertMcpExecutable(mcpConfig)
        const allowedTool = assertMcpToolAllowed(mcpConfig, toolName, [executionContext.permissions, wf.permissions, node.permissions, node.data?.permissions])
        const attemptId = run.checkpoint.nodes[nid].activeAttempt.id
        const requestHash = crypto.createHash('sha256').update(JSON.stringify({ serverId, tool: allowedTool, args })).digest('hex')
        run.checkpoint = prepareEffect(run.checkpoint, nid, attemptId, { requestHash, reconciliation: { kind: 'mcp', serverId, tool: allowedTool } })
        persistRun(runId, run)
        run.checkpoint = markEffectInflight(run.checkpoint, nid, attemptId)
        persistRun(runId, run)
        pushEvent(run, 'info', `▶ ${d.label || nid} — MCP ${d.server || '?'} / ${d.tool || '?'}`, nid)
        const controller = new AbortController(); run.controllers ||= new Set(); run.controllers.add(controller)
        const startedAt = Date.now()
        let result, callError
        try {
          result = await resourceCoordinator.withResource('mcp', { nodeId: nid, limit: nodeResourceLimit(node, 'mcp') }, () => invokeMcp(serverId, toolName, args, Math.max(1000, Math.min(300000, Number(d.timeoutMs) || 60000)), { run, nodeId: nid, signal: controller.signal, subprocessLimit: nodeResourceLimit(node, 'subprocess'), policies: [executionContext.permissions, wf.permissions, node.permissions, node.data?.permissions] }))
        } catch (error) { callError = error; throw error }
        finally {
          run.controllers.delete(controller)
          run.mcpEvidence ||= []
          const code = callError?.code
          const status = !callError ? 'done' : code === 'MCP_CANCELLED' ? 'cancelled' : code === 'MCP_TIMEOUT' ? 'timed-out' : /denied|scope|permitted|disabled|trust review/i.test(callError.message) ? 'denied' : 'failed'
          run.mcpEvidence = [...run.mcpEvidence, mcpEvidence({ serverId, tool: toolName, status, error: callError, startedAt, endedAt: Date.now() })].slice(-100)
          persistRun(runId, run)
        }
        outputs[nid] = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        run.checkpoint = confirmEffect(run.checkpoint, nid, attemptId, { receiptRef: `mcp:${serverId}:${allowedTool}`, output: outputs[nid], outputHash: crypto.createHash('sha256').update(outputs[nid]).digest('hex') })
        persistRun(runId, run)
        pushEvent(run, 'done', `✔ ${d.label || nid}: MCP tool completed`, nid)
        return
      }

      if (node.type === 'subworkflow') {
        const childId = String(d.workflowId || '')
        const childVersion = String(d.workflowVersion || '').trim()
        if (!/^[a-z0-9_-]+$/i.test(childId)) throw new Error(`${d.label || nid} needs a valid workflow selection`)
        if (childVersion && !/^[a-z0-9_.-]+$/i.test(childVersion)) throw new Error(`${d.label || nid} has an invalid pinned workflow version`)
        const childContext = childExecutionContext({ parent: executionContext, workflowId: wf.id, parentRunId: run.id, parentNode: node })
        if (childContext.stack.includes(childId)) throw new Error(`recursive subworkflow reference detected at ${wf.id}/${nid}: ${[...childContext.stack, childId].join(' → ')}`)
        if (childVersion) resolvePinnedWorkflowVersion(WF_VERSION_DIR, childId, childVersion)
        const childPolicyEvidence = executionPolicyEvidence(childContext)
        const attemptId = run.checkpoint.nodes[nid].activeAttempt.id
        const requestHash = crypto.createHash('sha256').update(JSON.stringify({ childId, childVersion: childVersion || null, input: upstream || input, executionPolicy: childPolicyEvidence })).digest('hex')
        run.checkpoint = prepareEffect(run.checkpoint, nid, attemptId, { requestHash, reconciliation: { kind: 'subworkflow', workflowId: childId, workflowVersion: childVersion || null } })
        persistRun(runId, run)
        const operationKey = run.checkpoint.nodes[nid].effect.operationKey
        const parentOperationContext = { operationKey, parentRunId: run.id, parentLogicalRunId: run.logicalRunId, parentWorkflowId: wf.id, parentNodeId: nid, parentWorkflowVersionHash: run.checkpoint.workflowVersionHash }
        pushEvent(run, 'info', `▶ ${d.label || nid} — starting subworkflow ${childId}${childVersion ? ` at pinned version ${childVersion}` : ' at its current unpinned draft'}`, nid)
        run.checkpoint = markEffectInflight(run.checkpoint, nid, attemptId)
        persistRun(runId, run)
        const response = await fetch(`http://127.0.0.1:${PORT}/api/workflows/${childId}/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-trigger-secret': TRIGGER_INTERNAL_SECRET }, body: JSON.stringify({ input: upstream || input, profileId: req.body.profileId, safe, executionContext: childContext, parentOperation: parentOperationContext, ...(childVersion ? { workflowVersion: childVersion } : {}) }) })
        const started = await response.json()
        if (!response.ok) {
          pushEvent(run, 'error', `✘ ${d.label || nid}: ${started.error || `subworkflow ${childId} could not start`}`, nid)
          throw new Error(started.error || `subworkflow ${childId} could not start`)
        }
        if (process.env.ACC_TEST_CRASH_AFTER_EFFECT === `${wf.id}:${nid}:subworkflow-start`) process.kill(process.pid, 'SIGKILL')
        run.childRunIds.push(started.runId)
        if (!run.checkpoint.subworkflows.some(item => item.operationKey === operationKey)) run.checkpoint.subworkflows.push({ nodeId: nid, operationKey, workflowId: childId, workflowVersion: childVersion || null, runId: started.runId, executionPolicy: childPolicyEvidence, startedAt: Date.now() })
        persistRun(runId, run)
        if (run.paused) pauseActiveRun(runs.get(started.runId), true)
        let child, activeChildRunId = started.runId, interruptedPolls = 0
        while (true) {
          await waitIfPaused()
          if (run.cancelled) { cancelActiveRun(runs.get(activeChildRunId), 'parent workflow stopped'); break }
          child = runs.get(activeChildRunId) || readJson(path.join(RUNS_DIR, `${activeChildRunId}.json`), null)
          if (child?.recoveredBy) {
            const recoveredFrom = activeChildRunId
            activeChildRunId = child.recoveredBy
            const record = run.checkpoint.subworkflows.find(item => item.operationKey === operationKey)
            if (record) { record.recoveredFrom = recoveredFrom; record.runId = activeChildRunId }
            if (!run.childRunIds.includes(activeChildRunId)) run.childRunIds.push(activeChildRunId)
            persistRun(runId, run)
            continue
          }
          if (child?.status === 'interrupted' && interruptedPolls++ < 20) { await new Promise(resolve => setTimeout(resolve, 300)); continue }
          if (child && !['running', 'paused'].includes(child.status)) break
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        outputs[nid] = child?.result || ''
        const childRecord = run.checkpoint.subworkflows.find(item => item.operationKey === operationKey)
        if (childRecord) childRecord.completedAt = Date.now()
        run.checkpoint = confirmEffect(run.checkpoint, nid, attemptId, { receiptRef: `subworkflow:${activeChildRunId}`, output: outputs[nid], outputHash: crypto.createHash('sha256').update(outputs[nid]).digest('hex') })
        persistRun(runId, run)
        if (!child || child.status !== 'done') throw new Error(`subworkflow ${childId} ${child?.status || 'did not finish'}`)
        pushEvent(run, 'done', `✔ ${d.label || nid}: subworkflow complete`, nid)
        return
      }

      if (node.type === 'search') {
        const q = (instruction || upstream || input).trim()
        pushEvent(run, 'info', `▶ ${d.label || nid} — searching your knowledge`, nid)
        try {
          const hits = await knowledgeSearch(q, d.k || 4, d.sourceId)
          outputs[nid] = hits.length ? hits.map((h, i) => `[${i + 1}] (from ${h.source}) ${h.text}`).join('\n\n') : '(no relevant knowledge found)'
          pushEvent(run, 'done', `✔ ${d.label || nid}: found ${hits.length} passage(s)`, nid)
        } catch (e) { outputs[nid] = ''; pushEvent(run, 'error', `✘ search failed: ${e.message}`, nid); throw e }
        return
      }

      if (node.type === 'critic') {
        // worker produces → reviewer critiques → loop until APPROVED or maxIters
        const worker = resolveForRun(d.model)
        const reviewer = resolveForRun(d.reviewerModel || d.model)
        const maxIters = safe ? 1 : Math.max(1, Math.min(5, d.maxIters || 2))
        let draft = '', critique = ''
        for (let i = 1; i <= maxIters; i++) {
          const wInstr = i === 1 ? instruction
            : `${instruction}\n\n--- Your previous draft ---\n${draft}\n\n--- Reviewer feedback (address it) ---\n${critique}`
          draft = await modelStep({ run, nodeId: nid, label: `${d.label || nid} · draft ${i}`, model: worker, instruction: wInstr, cwd }, d)
          const rOut = await modelStep({ run, nodeId: nid, label: `${d.label || nid} · review ${i}`, model: reviewer,
            instruction: `You are a strict reviewer. If this fully meets the goal, reply with exactly "APPROVED". Otherwise give specific fixes.\n\nGoal:\n${instruction}\n\nDraft:\n${draft}`, cwd }, d)
          critique = rOut
          if (/\bAPPROVED\b/i.test(rOut)) { pushEvent(run, 'info', `✓ approved on iteration ${i}`, nid); break }
        }
        outputs[nid] = draft; return
      }

      if (node.type === 'parallel') {
        // run each worker model on the instruction, then a judge merges/picks the best
        let workers = (Array.isArray(d.models) && d.models.length ? d.models : [d.model]).map(resolveForRun)
        if (safe) workers = workers.slice(0, 1)
        const judge = resolveForRun(d.judgeModel || workers[0])
        pushEvent(run, 'info', `⑂ ${d.label || nid}: running ${workers.length} branch${workers.length === 1 ? '' : 'es'} concurrently`, nid)
        const results = await concurrentMap(workers, safe ? 1 : Math.min(workers.length, Number(d.concurrency || wf.settings?.parallelism || 4)), async (worker, i) => {
          const out = await modelStep({ run, nodeId: nid, label: `${d.label || nid} · branch ${i + 1}`, model: worker, instruction, cwd }, d)
          return `### Candidate ${i + 1} (${shortRef(worker)})\n${out}`
        })
        outputs[nid] = await modelStep({ run, nodeId: nid, label: `${d.label || nid} · judge`, model: judge,
          instruction: `You are a judge. Given these candidate answers to the goal, produce the single best final answer (merge strengths, fix errors).\n\nGoal:\n${instruction}\n\n${results.join('\n\n')}`, cwd }, d)
        return
      }

      if (node.type === 'map') {
        const source = upstream || input || ''
        let items
        try { const parsed = JSON.parse(source); items = Array.isArray(parsed) ? parsed : [parsed] }
        catch { items = source.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }
        const limit = safe ? Math.min(2, items.length) : Math.min(Math.max(1, Number(d.maxItems) || 25), items.length)
        const model = resolveForRun(d.model)
        const selectedItems = items.slice(0, limit)
        const concurrency = safe ? 1 : Math.max(1, Math.min(Number(d.concurrency || wf.settings?.parallelism || 4), 16))
        pushEvent(run, 'info', `⑂ ${d.label || nid}: processing ${limit} item(s) with concurrency ${Math.min(concurrency, limit)}`, nid)
        const results = await concurrentMap(selectedItems, concurrency, async (item, i) => {
          const itemText = typeof item === 'string' ? item : JSON.stringify(item)
          const mapInstruction = String(d.instruction || 'Process this item:\n\n{{item}}')
            .replace(/\{\{\s*item\s*\}\}/g, itemText).replace(/\{\{\s*index\s*\}\}/g, String(i))
          return modelStep({ run, nodeId: nid, label: `${d.label || nid} · item ${i + 1}/${limit}`, model, instruction: mapInstruction, cwd }, d)
        })
        outputs[nid] = JSON.stringify(results, null, 2)
        pushEvent(run, 'done', `✔ ${d.label || nid}: processed ${results.length} item(s)`, nid)
        return
      }

      if (!['agent', 'orchestrator'].includes(node.type)) throw new Error(`unsupported node type: ${node.type}`)
      // agent / orchestrator node
      if (node.type === 'orchestrator') {
        instruction = `You are an orchestrator. Break this goal into steps and use your available sub-agents/tools to accomplish it, then report the result.\n\nGoal:\n${instruction}`
      }
      const model = resolveForRun(d.model)
      if (d.contextLimit && instruction.length > Number(d.contextLimit)) {
        const limit = Math.max(1000, Number(d.contextLimit))
        instruction = instruction.slice(0, limit) + `\n\n[Context truncated to ${limit} characters by node policy]`
        pushEvent(run, 'info', `Context limited to ${limit} characters`, nid)
      }
      outputs[nid] = await modelStep({ run, nodeId: nid, label: d.label || nid, model, instruction, cwd }, d)
    }
    const executeCheckpointedNode = async nid => {
      if (!allowedNodes.has(nid) || ['succeeded', 'skipped'].includes(run.checkpoint.nodes[nid]?.state)) return executeNode(nid)
      await waitIfPaused()
      if (run.cancelled) return
      const predecessorEvidence = (incoming[nid] || []).map(edge => [edge.source, run.checkpoint.nodes[edge.source]?.outputHash || null])
      const inputHash = crypto.createHash('sha256').update(JSON.stringify({ workflowHash: run.checkpoint.workflowVersionHash, node: nodeById[nid], input, predecessorEvidence, permissionHash: run.permissionHash })).digest('hex')
      run.checkpoint = claimNode(run.checkpoint, nid, { inputHash })
      const attemptId = run.checkpoint.nodes[nid].activeAttempt.id
      persistRun(runId, run)
      try {
        await executeNode(nid)
        if (run.cancelled) return
        run.checkpoint = completeNode(run.checkpoint, nid, attemptId, { output: outputs[nid] ?? '', skipped: skipped.has(nid) })
        persistRun(runId, run)
      } catch (error) {
        run.checkpoint = failNode(run.checkpoint, nid, attemptId, `error:${crypto.createHash('sha256').update(String(error?.message || error)).digest('hex').slice(0, 16)}`)
        persistRun(runId, run)
        error.nodeId ||= nid
        throw error
      }
    }
    await runDependencyGraph(wf.nodes, wf.edges, { parallelism: safe ? 1 : wf.settings?.parallelism || 4, execute: executeCheckpointedNode, cancelled: () => run.cancelled, onLayer: layer => { if (layer.length > 1) pushEvent(run, 'info', `⑂ Running ${layer.length} independent workflow branches with bounded concurrency`) } })
    if (run.cancelled && run.status !== 'cancelled') { run.status = 'cancelled'; run.ended = Date.now(); pushEvent(run, 'info', '⏹ Cancelled by user') }
    if (run.status !== 'cancelled') {
      run.status = 'done'; run.ended = Date.now()
      const finalNode = wf.nodes.find(n => n.type === 'output')
      const selectedResultId = [...requestedNodeIds].reverse().find(id => outputs[id] != null)
      run.result = selectedResultId ? outputs[selectedResultId] : runMode === 'selected' && requestedNodeId ? outputs[requestedNodeId] ?? '' : finalNode && outputs[finalNode.id] != null ? outputs[finalNode.id] : requestedNodeId ? outputs[requestedNodeId] ?? '' : ''
      pushEvent(run, 'done', '✔ Workflow complete')
    }
  } catch (e) {
    const checkpointState = run.checkpoint?.nodes?.[e?.nodeId || activeNodeId]?.state
    run.status = run.cancelled ? 'cancelled' : checkpointState === 'needs_review' ? 'needs_review' : 'failed'; run.ended = Date.now()
    run.failedNodeId = e?.nodeId || activeNodeId
    pushEvent(run, run.cancelled ? 'info' : 'error', run.cancelled ? '⏹ Cancelled by user' : checkpointState === 'needs_review' ? '⚠ Workflow stopped for review after an uncertain external effect' : '✘ Workflow error: ' + (e?.message || e))
  }
  persistRun(runId, run)
  for (const l of run.listeners) { try { l.end() } catch {} }
})
const shortRef = (m) => (m || '').replace(/^lmstudio\//, '').split('/').pop() || m

app.get('/api/workflows/runs/:runId/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const run = runs.get(req.params.runId)
  if (!run) {
    try { const saved = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, req.params.runId + '.json'), 'utf8')); for (const ev of saved.events) res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {}
    return res.end()
  }
  for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
  if (run.status !== 'running') return res.end()
  run.listeners.add(res)
  req.on('close', () => run.listeners.delete(res))
})
app.post('/api/workflows/runs/:runId/nodes/:nodeId/approval', (req, res) => {
  const run = runs.get(req.params.runId)
  if (!run || run.type !== 'workflow') return res.status(404).json({ error: 'active workflow run not found' })
  if (!['approved', 'rejected'].includes(req.body.decision)) return res.status(400).json({ error: 'decision must be approved or rejected', code: 'INVALID_APPROVAL_DECISION' })
  const approval = pendingApprovalForNode(run.control, req.params.nodeId) || Object.values(run.control?.approvals || {}).find(item => item.nodeId === req.params.nodeId)
  if (!approval) return res.status(409).json({ error: 'node is not waiting for approval', code: 'APPROVAL_NOT_PENDING' })
  const comment = String(req.body.comment || '').slice(0, 1000)
  const commentRef = comment ? `comment:${crypto.createHash('sha256').update(comment).digest('hex').slice(0, 16)}` : null
  const commandId = String(req.body.commandId || `approval-command-${crypto.createHash('sha256').update(JSON.stringify({ runId: run.logicalRunId, approvalId: approval.id, decision: req.body.decision, commentRef })).digest('hex').slice(0, 24)}`)
  try {
    const decided = decideApproval(run.control, { approvalId: approval.id, decision: req.body.decision, commandId, expectedRevision: req.body.expectedRevision, expectedSubjectHash: req.body.expectedSubjectHash, actorId: String(req.body.actorId || 'local-owner'), commentRef })
    run.control = decided.control
    if (comment) run.approvalComments[approval.id] = redactReleaseValue(comment)
    persistRun(run.id, run)
    appendAudit('workflow_approval', { runId: req.params.runId, approvalId: approval.id, nodeId: req.params.nodeId, decision: req.body.decision, commandId, replay: decided.replay })
    res.json({ ok: true, decision: req.body.decision, approvalId: approval.id, subjectHash: approval.subjectHash, receipt: decided.receipt, replay: decided.replay })
  } catch (error) {
    const status = ['STALE_APPROVAL_REVISION', 'STALE_APPROVAL_SUBJECT'].includes(error.code) ? 412 : ['APPROVAL_COMMAND_CONFLICT', 'APPROVAL_DECISION_CONFLICT'].includes(error.code) ? 409 : 400
    res.status(status).json({ error: error.message, code: error.code || 'APPROVAL_DECISION_FAILED' })
  }
})
app.get('/api/workflows/runs/:runId/checkpoint', (req, res) => {
  const run = runs.get(req.params.runId) || readJson(path.join(RUNS_DIR, `${req.params.runId}.json`), null)
  if (!run || run.type !== 'workflow') return res.status(404).json({ error: 'workflow run not found' })
  res.json({ runId: run.id, workflowId: run.workflowId, workflowVersion: run.workflowVersion || null, status: run.status, failedNodeId: run.failedNodeId || null, checkpoint: run.checkpoint || null })
})
app.post('/api/workflows/runs/:runId/retry', async (req, res) => {
  const previous = runs.get(req.params.runId) || readJson(path.join(RUNS_DIR, `${req.params.runId}.json`), null)
  if (!previous || previous.type !== 'workflow') return res.status(404).json({ error: 'workflow run not found' })
  const nodeId = String(req.body.nodeId || previous.failedNodeId || previous.checkpoint?.lastNodeId || '')
  if (!nodeId) return res.status(400).json({ error: 'no retry node is available' })
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/workflows/${previous.workflowId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resumeRunId: previous.id, fromNodeId: nodeId, nodeId, runMode: req.body.scope === 'node' ? 'selected' : 'from', input: req.body.input ?? previous.task, profileId: req.body.profileId, safe: !!req.body.safe, ...(previous.workflowVersion ? { workflowVersion: previous.workflowVersion } : {}) }) })
    const result = await response.json(); res.status(response.status).json(result)
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// ---------- AI workflow generator (describe a goal → a graph) ----------
function autoLayout(nodes, edges) {
  const incoming = {}; for (const e of edges) (incoming[e.target] = incoming[e.target] || []).push(e.source)
  const depth = {}
  const calc = (id, seen = new Set()) => {
    if (depth[id] != null) return depth[id]
    if (seen.has(id)) return 0
    seen.add(id)
    const ins = incoming[id] || []
    depth[id] = ins.length ? Math.max(...ins.map(s => calc(s, seen))) + 1 : 0
    return depth[id]
  }
  nodes.forEach(n => calc(n.id))
  const perDepth = {}
  nodes.forEach(n => { const d = depth[n.id] || 0; perDepth[d] = (perDepth[d] || 0); n.position = { x: 40 + d * 250, y: 60 + perDepth[d] * 150 }; perDepth[d]++ })
  return nodes
}

// generate text with a chosen model — local via LM Studio /v1, cloud via OpenCode
function opencodeText(model, prompt, nodeId = 'direct-model', signal) {
  return withGlobalModel(null, model, nodeId, () => new Promise((resolve, reject) => {
    const proc = spawn(OPENCODE, ['run', prompt, '--model', model], { cwd: os.tmpdir(), env: { ...providerExecutionEnv(), PWD: os.tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener('abort', onAbort)
      fn(value)
    }
    let abortError = null
    const onAbort = () => { abortError = new Error('model request cancelled'); abortError.name = 'AbortError'; terminateProcess(proc) }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    proc.stdout.on('data', c => out += c); proc.stderr.on('data', c => out += c)
    proc.on('exit', () => abortError ? finish(reject, abortError) : finish(resolve, out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')))
    proc.on('error', error => finish(reject, error))
  }), signal)
}

function localTextCompletion(modelId, body, nodeId = 'direct-model', signal) {
  return withGlobalModel(null, modelId, nodeId, async () => {
    const response = await fetch(`${LMSTUDIO}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model: modelId, ...body }),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, signal)
}

app.post('/api/workflows/generate', async (req, res) => {
  const goal = (req.body.goal || '').trim()
  if (!goal) return res.status(400).json({ error: 'goal required' })
  const signal = modelRequestSignal(req, res)
  const chosen = req.body.model // optional model ref chosen by the user
  let models = []
  try { models = await lmstudioModels() } catch {}
  const modelRefs = models.map(m => 'lmstudio/' + m.id)
  const sys = `You design executable local-first workflows as JSON. Output ONLY a JSON object, no prose.
Schema: {"name": string, "nodes": [{"id": string, "type": string, "data": object}], "edges": [{"id": string, "source": string, "target": string, "data"?: {"condition"?: "true"|"false"}}]}
Rules:
- Exactly one "input" node (id "in") and one "output" node (id "out").
- Use 2-10 purposeful nodes between them. Available types: agent, orchestrator, critic, parallel, search, check, if, human-approval, python, shell, http, json-transform, delay, map, file-input, folder-input, pdf-reader, obsidian-read, obsidian-write, write-file.
- Prefer agent for one focused AI task, critic for bounded revision, parallel for multiple candidates plus a judge, check for deterministic quality rules, human-approval before consequential publishing, and python only for deterministic transformations.
- A decision node must have one outgoing edge with data.condition "true" and one with "false".
- Each agent's "instruction" uses {{input}} for the workflow input or {{nodeId}} to reference an upstream node's output.
- Each agent "model" must be one of: ${modelRefs.join(', ') || 'lmstudio/qwen/qwen3-coder-30b'}
- Every node must be reachable from input and lead toward output. Give every edge a unique id.`
  try {
    let txt
    const useLocal = !chosen || chosen.startsWith('lmstudio/')
    if (useLocal) {
      if (!models.length) return res.status(502).json({ error: 'no local model available; pick a cloud model or load a local one' })
      const id = (chosen || 'lmstudio/' + (models.find(m => m.state === 'loaded') || models[0]).id).replace(/^lmstudio\//, '')
      const d = await localTextCompletion(id, { temperature: 0.2, messages: [
        { role: 'system', content: sys }, { role: 'user', content: `Goal: ${goal}` },
      ] }, 'workflow-generator', signal)
      txt = d.choices?.[0]?.message?.content || ''
    } else {
      // cloud model — route through OpenCode
      txt = await opencodeText(chosen, `${sys}\n\nGoal: ${goal}\n\nRespond with ONLY the JSON object.`, 'workflow-generator', signal)
    }
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}')
    if (s < 0 || e < 0) throw new Error('model did not return JSON')
    const wf = JSON.parse(txt.slice(s, e + 1))
    // normalize
    wf.id = ''; wf.name = wf.name || goal.slice(0, 40)
    wf.nodes = (wf.nodes || []).map(n => ({ id: n.id, type: n.type, position: n.position || { x: 0, y: 0 }, data: n.data || {} }))
    if (!wf.nodes.some(n => n.type === 'input')) wf.nodes.unshift({ id: 'in', type: 'input', data: { label: 'Input' } })
    if (!wf.nodes.some(n => n.type === 'output')) wf.nodes.push({ id: 'out', type: 'output', data: { label: 'Output' } })
    // validate models fall back to a real one
    for (const n of wf.nodes) if (['agent', 'orchestrator', 'critic', 'parallel', 'map'].includes(n.type) && n.data.model && !modelRefs.includes(n.data.model)) n.data.model = modelRefs[0]
    wf.edges = (wf.edges || []).map((e, i) => ({ id: e.id || 'e' + i, source: e.source, target: e.target }))
      .filter(e => wf.nodes.some(n => n.id === e.source) && wf.nodes.some(n => n.id === e.target))
    autoLayout(wf.nodes, wf.edges)
    res.json(wf)
  } catch (err) { res.status(502).json({ error: 'generation failed: ' + err.message }) }
})

// AI Architect — reasons about the current workflow; returns {reply, workflow?}
app.post('/api/architect', async (req, res) => {
  const command = (req.body.command || '').trim()
  if (!command) return res.status(400).json({ error: 'command required' })
  const signal = modelRequestSignal(req, res)
  const wf = req.body.workflow || { nodes: [], edges: [] }
  const selectedId = req.body.selectedNodeId || null
  const chosen = req.body.model
  let models = []
  try { models = await lmstudioModels() } catch {}
  const modelRefs = models.map(m => 'lmstudio/' + m.id)
  const sys = `You are the AI Architect for a local multi-agent workflow tool.
You are given the CURRENT workflow as JSON and a user command. Respond with ONLY a JSON object:
{"reply": "<plain-language answer for a non-technical user>", "workflow": <full modified workflow OR null>}
Rules:
- Include "workflow" ONLY if the command asks to change the workflow (add/remove/replace/simplify/improve/make faster/keep local/etc). For explain/why/what questions, set workflow to null.
- The modified workflow keeps the same schema: {"name","nodes":[{"id","type","position","data":{"label","model","instruction",...}}],"edges":[{"id","source","target"}]}.
- Preserve existing node ids where possible; keep exactly one input (id "in") and one output (id "out").
- node "type" is one of: input, agent, orchestrator, critic, parallel, search, check, if, human-approval, python, shell, http, json-transform, delay, map, file-input, folder-input, pdf-reader, obsidian-read, obsidian-write, write-file, output.
- agent/critic/parallel "model" must be one of: ${modelRefs.join(', ') || 'lmstudio/qwen/qwen3-coder-30b'}. For "keep local" use only these.
- "reply" must be short and explain WHAT you changed and WHY, in plain language.
- Do not invent tools or fields not in the schema.`
  const user = `CURRENT WORKFLOW:\n${JSON.stringify(wf)}\n\nSELECTED NODE: ${selectedId || 'none'}\n\nUSER COMMAND: ${command}`
  try {
    let txt
    if (!chosen || chosen.startsWith('lmstudio/')) {
      if (!models.length) return res.status(502).json({ error: 'no local model available' })
      const id = (chosen || 'lmstudio/' + (models.find(m => m.state === 'loaded') || models[0]).id).replace(/^lmstudio\//, '')
      const d = await localTextCompletion(id, { temperature: 0.3, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }, 'architect', signal)
      txt = d.choices?.[0]?.message?.content || ''
    } else {
      txt = await opencodeText(chosen, `${sys}\n\n${user}\n\nRespond with ONLY the JSON.`, 'architect', signal)
    }
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}')
    if (s < 0) return res.json({ reply: txt.trim() || 'No response.' })
    let parsed
    try { parsed = JSON.parse(txt.slice(s, e + 1)) } catch { return res.json({ reply: txt.slice(s, e + 1).slice(0, 800) }) }
    let outWf = parsed.workflow || null
    if (outWf) {
      outWf.nodes = (outWf.nodes || []).map(n => ({ id: n.id, type: n.type, position: n.position || { x: 0, y: 0 }, data: n.data || {} }))
      if (!outWf.nodes.some(n => n.type === 'input')) outWf.nodes.unshift({ id: 'in', type: 'input', position: {}, data: { label: 'Input' } })
      if (!outWf.nodes.some(n => n.type === 'output')) outWf.nodes.push({ id: 'out', type: 'output', position: {}, data: { label: 'Output' } })
      for (const n of outWf.nodes) if (['agent', 'orchestrator', 'critic', 'parallel', 'map'].includes(n.type) && n.data.model && !modelRefs.includes(n.data.model) && !String(n.data.model).startsWith('role:') && !String(n.data.model).startsWith('policy:')) n.data.model = modelRefs[0]
      outWf.edges = (outWf.edges || []).map((e2, i) => ({ id: e2.id || 'e' + i, source: e2.source, target: e2.target }))
        .filter(e2 => outWf.nodes.some(n => n.id === e2.source) && outWf.nodes.some(n => n.id === e2.target))
      autoLayout(outWf.nodes, outWf.edges)
      outWf.name = outWf.name || wf.name
    }
    res.json({ reply: parsed.reply || 'Done.', workflow: outWf })
  } catch (err) { res.status(502).json({ error: err.message }) }
})

// test a single node in isolation (real run of its model + instruction)
app.post('/api/workflows/testnode', async (req, res) => {
  const model = req.body.model || 'lmstudio/qwen/qwen3-coder-30b'
  const instruction = (req.body.instruction || '').replace(/\{\{\s*input\s*\}\}/g, req.body.input || '').trim()
  if (!instruction) return res.status(400).json({ error: 'instruction (with input filled) required' })
  const signal = modelRequestSignal(req, res)
  try {
    let out
    if (model.startsWith('lmstudio/')) {
      const id = model.replace(/^lmstudio\//, '')
      const d = await localTextCompletion(id, { temperature: 0.4, messages: [{ role: 'user', content: instruction }] }, 'test-node', signal)
      out = d.choices?.[0]?.message?.content || '(no output)'
    } else {
      out = await opencodeText(model, instruction, 'test-node', signal)
    }
    res.json({ output: out })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

// ---------- bundle export / import (portable "company") ----------
app.get('/api/bundle/export', (_req, res) => {
  const workflows = fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8')) } catch { return null } }).filter(Boolean)
  const brain = {}
  for (const f of walkBrain(BRAIN_DIR)) { try { brain[f.path] = readFileBeneath(BRAIN_DIR, f.path, 'utf8') } catch {} }
  const bundle = {
    version: 1, exported: new Date().toISOString(),
    agents: loadAgents(),
    workflows,
    profiles: loadProfiles(),
    brain, // { relpath: content }
    providers: Object.keys(readProviders()), // names only — NEVER keys
  }
  res.setHeader('Content-Disposition', 'attachment; filename="command-center-bundle.json"')
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(redactReleaseValue(bundle), null, 2))
})

function bundleSummary(bundle) { return { agents: Array.isArray(bundle.agents) ? bundle.agents.length : 0, workflows: Array.isArray(bundle.workflows) ? bundle.workflows.length : 0, profiles: Array.isArray(bundle.profiles) ? bundle.profiles.length : 0, brainFiles: bundle.brain && typeof bundle.brain === 'object' ? Object.keys(bundle.brain).length : 0 } }
function bundleRisks(bundle) {
  const executableTypes = new Set(['python', 'shell', 'http', 'mcp', 'custom'])
  const executableNodes = (bundle.workflows || []).flatMap(workflow => workflow.nodes || []).filter(node => executableTypes.has(node.type)).length
  return [...(bundle.agents?.length ? [`${bundle.agents.length} agent definitions contain prompts, tools, and permission requests`] : []), ...(executableNodes ? [`${executableNodes} executable workflow nodes require review`] : []), ...(bundle.brain && Object.keys(bundle.brain).length ? [`${Object.keys(bundle.brain).length} knowledge files will be written`] : [])]
}
app.post('/api/bundle/import', (req, res) => {
  const bundle = req.body || {}
  if (Number(bundle.version) !== 1 || !Array.isArray(bundle.workflows || []) || !Array.isArray(bundle.agents || [])) return res.status(400).json({ error: 'unsupported or invalid bundle manifest' })
  try { for (const workflow of bundle.workflows || []) { assertWorkflowImport({ input: workflow }); const migrated = migrateWorkflowDocument(workflow); const errors = workflowErrors(migrated); if (errors.length) throw new Error(`${workflow.name || workflow.id}: ${errors.join('; ')}`) } }
  catch (error) { return res.status(400).json({ error: `bundle validation failed: ${error.message}` }) }
  const proposals = readJson(IMPORT_PROPOSALS_FILE, []), item = { id: `import-${crypto.randomBytes(6).toString('hex')}`, status: 'review-required', createdAt: Date.now(), summary: bundleSummary(bundle), risks: bundleRisks(bundle), bundle }
  proposals.unshift(item); writeJson(IMPORT_PROPOSALS_FILE, proposals.slice(0, 20)); appendAudit('bundle_import_staged', { id: item.id, summary: item.summary }); res.status(202).json({ ok: false, status: item.status, proposalId: item.id, summary: item.summary, risks: item.risks })
})
app.post('/api/bundle/import/:id/decision', (req, res) => {
  const proposals = readJson(IMPORT_PROPOSALS_FILE, []), item = proposals.find(proposal => proposal.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'import proposal not found' })
  if (item.status !== 'review-required') return res.status(409).json({ error: `import proposal is already ${item.status}` })
  if (req.body.decision !== 'approve') { item.status = 'rejected'; item.decidedAt = Date.now(); writeJson(IMPORT_PROPOSALS_FILE, proposals); appendAudit('bundle_import_rejected', { id: item.id }); return res.json({ ok: true, status: item.status }) }
  const summary = { agents: 0, workflows: 0, profiles: 0, brainFiles: 0 }, bundle = item.bundle, overwrite = req.body.overwrite === true
  if (!overwrite) {
    const agentIds = new Set(loadAgents().map(agent => agent.id)), conflicts = []
    for (const agent of bundle.agents || []) if (agentIds.has(agent.id)) conflicts.push(`agent ${agent.id}`)
    for (const workflow of bundle.workflows || []) if (fs.existsSync(path.join(WF_DIR, `${workflow.id}.json`))) conflicts.push(`workflow ${workflow.id}`)
    for (const rel of Object.keys(bundle.brain || {})) { const abs = brainPath(rel, { allowMissing: true }); if (abs && fs.existsSync(abs)) conflicts.push(`knowledge file ${rel}`) }
    if (conflicts.length) return res.status(409).json({ error: `${conflicts.slice(0, 10).join(', ')} already exist; explicit overwrite is required`, conflicts })
  }
  try {
    for (const raw of bundle.workflows || []) {
      const existing = readJson(path.join(WF_DIR, `${raw.id}.json`), null)
      assertWorkflowImport({ input: raw, existing: overwrite ? existing : null })
    }
    for (const raw of bundle.agents || []) { const agent = { ...raw, permissions: 'standard' }; const list = loadAgents(), index = list.findIndex(current => current.id === agent.id); if (index >= 0) list[index] = agent; else list.push(agent); saveAgents(list); writeOcAgent(agent); summary.agents++ }
    for (const raw of bundle.workflows || []) { const workflow = createDevelopmentWorkflowCandidate(migrateWorkflowDocument(raw), { id: raw.id, name: raw.name, status: 'imported-review', provenance: { type: 'bundle', proposalId: item.id } }), file = path.join(WF_DIR, `${workflow.id}.json`); atomicWriteJsonSync(file, workflow); summary.workflows++ }
    if (bundle.profiles) { saveProfiles(bundle.profiles); summary.profiles = bundle.profiles.length }
    for (const [rel, content] of Object.entries(bundle.brain || {})) { const abs = brainPath(rel, { allowMissing: true }); if (!abs) continue; writeFileBeneath(BRAIN_DIR, rel, String(content)); summary.brainFiles++ }
    item.status = 'installed'; item.decidedAt = Date.now(); item.bundle = undefined; item.applied = summary; writeJson(IMPORT_PROPOSALS_FILE, proposals); appendAudit('bundle_import_approved', { id: item.id, summary }); res.json({ ok: true, status: item.status, summary })
  } catch (error) {
    const denial = governanceErrorResponse(error)
    if (error?.code?.startsWith('GOVERNANCE_')) appendAudit('workflow_mutation', governanceAuditDetail({ operation: 'import-overwrite', outcome: 'denied', code: denial.body.code }))
    res.status(denial.status).json({ ...denial.body, summary })
  }
})

// ---------- knowledge (RAG: ingest, embed, search) ----------
const KNOW_DIR = path.join(DATA, 'knowledge')
fs.mkdirSync(KNOW_DIR, { recursive: true })
const EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5'
async function embed(inputs) {
  const out = []
  for (let i = 0; i < inputs.length; i += 16) {
    const batch = inputs.slice(i, i + 16)
    const d = await withGlobalModel(null, EMBED_MODEL, 'embedding', async () => {
      const response = await fetch(`${LMSTUDIO}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: EMBED_MODEL, input: batch }) })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    })
    if (!d.data) throw new Error('embedding failed: ' + JSON.stringify(d).slice(0, 160))
    out.push(...d.data.map(x => x.embedding))
  }
  return out
}
function chunkText(text, size = 700) {
  const paras = String(text).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const chunks = []; let cur = ''
  for (const p of paras) { if ((cur + '\n\n' + p).length > size && cur) { chunks.push(cur); cur = p } else cur = cur ? cur + '\n\n' + p : p }
  if (cur) chunks.push(cur)
  return chunks.flatMap(c => c.length > size * 1.6 ? (c.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) || [c]) : [c]).slice(0, 400)
}
function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9) }
function loadSources() { return fs.readdirSync(KNOW_DIR).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(KNOW_DIR, f), 'utf8')) } catch { return null } }).filter(Boolean) }
async function knowledgeSearch(query, k = 4, sourceId) {
  const [qv] = await embed([query])
  const sources = loadSources().filter(s => !sourceId || s.id === sourceId)
  const scored = []
  for (const s of sources) for (const c of s.chunks) scored.push({ text: c.text, source: s.name, score: cosine(qv, c.embedding) })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

app.get('/api/knowledge', (_req, res) => res.json(loadSources().map(s => ({ id: s.id, name: s.name, type: s.type, chunks: s.chunks.length, addedAt: s.addedAt }))))
app.post('/api/knowledge', async (req, res) => {
  try {
    let { name, text, pdfBase64 } = req.body
    let type = 'text'
    if (pdfBase64) {
      const buf = Buffer.from(pdfBase64, 'base64')
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buf })
      try { text = (await parser.getText()).text } finally { await parser.destroy().catch(() => {}) }
      type = 'pdf'
    }
    if (!name || !text || !text.trim()) return res.status(400).json({ error: 'name and non-empty text required' })
    const chunks = chunkText(text)
    if (!chunks.length) return res.status(400).json({ error: 'no content to index' })
    const vecs = await embed(chunks)
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + crypto.randomBytes(3).toString('hex')
    const source = { id, name, type, addedAt: Date.now(), chunks: chunks.map((t, i) => ({ text: t, embedding: vecs[i] })) }
    atomicWriteJsonSync(path.join(KNOW_DIR, id + '.json'), source)
    res.json({ id, name, chunks: chunks.length })
  } catch (e) { res.status(502).json({ error: 'ingest failed: ' + e.message }) }
})
app.delete('/api/knowledge/:id', (req, res) => { try { fs.unlinkSync(path.join(KNOW_DIR, req.params.id + '.json')) } catch {} ; res.json({ ok: true }) })
app.post('/api/knowledge/search', async (req, res) => {
  try { res.json(await knowledgeSearch(req.body.query || '', req.body.k || 4, req.body.sourceId)) }
  catch (e) { res.status(502).json({ error: e.message }) }
})

const workflowTriggerAdapter = createWorkflowTriggerAdapter({ workflowDir: WF_DIR, versionDir: WF_VERSION_DIR })

const triggerService = createTriggerService({
  app,
  triggersFile: TRIGGERS_FILE,
  historyFile: TRIGGER_HISTORY_FILE,
  rootDir: ROOT,
  appendAudit,
  workflowTriggers: workflowTriggerAdapter.list,
  mutateWorkflowTrigger: workflowTriggerAdapter.mutate,
  migrateLegacyTriggers: workflowTriggerAdapter.migrateLegacy,
  currentWorkflowVersion: workflowTriggerAdapter.currentVersion,
  authorizeFolderTrigger: workflowTriggerAdapter.authorizeFolder,
  authorizeWebhookTrigger: workflowTriggerAdapter.authorizeWebhook,
  getRun: async runId => runs.get(runId) || readJson(path.join(RUNS_DIR, `${runId}.json`), null),
  runWorkflow: async (workflowId, input, triggerContext) => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/workflows/${encodeURIComponent(workflowId)}/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-center-trigger-secret': TRIGGER_INTERNAL_SECRET }, body: JSON.stringify({ input: typeof input === 'string' ? input : JSON.stringify(input), triggerContext, ...(triggerContext.workflowVersion ? { workflowVersion: triggerContext.workflowVersion } : {}) }) })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `workflow run returned ${response.status}`)
    return payload
  },
})

const localModelFactory = createLocalModelFactory({ repositoryRoot: ROOT, endpoint: LMSTUDIO, concurrency: 4, maxQueue: 100 })
app.use('/api/local-factory', createLocalFactoryRouter({ factory: localModelFactory, appendAudit }))

// ---------- static UI ----------
const DIST = path.join(ROOT, 'dist')
app.use(express.static(DIST))
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')))

const httpServer = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ◉ AI COMMAND CENTER  →  http://localhost:${PORT}\n`)
  triggerService.start().catch(error => appendAudit('trigger_service_disabled', { error: String(error?.message || error).slice(0, 240) }))
  setTimeout(async () => {
    for (const previousId of interruptedWorkflowRuns) {
      const previousFile = path.join(RUNS_DIR, `${previousId}.json`), previous = readJson(previousFile, null)
      const workflow = previous?.workflowId ? readJson(path.join(WF_DIR, `${previous.workflowId}.json`), null) : null
      if (!previous || !workflow || workflow.settings?.restartRecovery === false || previous.recoveredBy) continue
      try {
        const legacyFromNodeId = previous.checkpoint?.schemaVersion === 2 ? undefined : previous.failedNodeId || previous.checkpoint?.lastNodeId
        const response = await fetch(`http://127.0.0.1:${PORT}/api/workflows/${previous.workflowId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resumeRunId: previous.id, ...(legacyFromNodeId ? { fromNodeId: legacyFromNodeId, runMode: 'from' } : {}), input: previous.task }) })
        const recovered = await response.json()
        if (response.ok && recovered.runId) { previous.recoveredBy = recovered.runId; previous.recoveryStartedAt = Date.now(); atomicWriteJsonSync(previousFile, previous); appendAudit('workflow_restart_recovery', { previousRunId: previous.id, recoveredBy: recovered.runId, workflowId: previous.workflowId }) }
      } catch (error) { appendAudit('workflow_restart_recovery_failed', { previousRunId: previous.id, error: error.message }) }
    }
  }, 500).unref()
})

async function shutdown() {
  globalModelCoordinator.shutdown()
  localModelFactory.shutdown('server shutting down')
  for (const run of runs.values()) {
    try { run.modelAbortController?.abort(new Error('server shutting down')) } catch {}
    terminateProcess(run.proc, 'SIGTERM')
    for (const proc of run.procs || []) terminateProcess(proc, 'SIGTERM')
  }
  await triggerService.stop?.().catch(() => {})
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
