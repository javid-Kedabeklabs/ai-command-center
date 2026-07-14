import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, addEdge,
  useNodesState, useEdgesState, useReactFlow, ReactFlowProvider,
  type Node, type Edge, type Connection,
} from '@xyflow/react'
import {
  api, streamChat, subscribeEvents, subscribeRun,
  type SystemInfo, type Model, type Agent, type AgentMigrationPreview, type RunSummary, type RunEvent,
  type BrainFile, type BrainGraph, type StudioModel,
  subscribeWfRun, type AllModel, type Provider, type Workflow, type WfSummary,
  type Profile, type ProfilesResp, type Template, type RunSummary as RunSum, type RunDetail, type RunEvidence, type Artifact,
  type KnowledgeSource, type KnowledgeHit, type ToolInfo, type Skill,
  type LocalFactoryStatus, type LocalFactoryTaskSummary,
  type CollaborationStatus, type CollaborationTaskSummary, type CollaborationLease,
} from './api'
import { WorkflowStudioV2 } from './WorkflowStudio'

type Page = 'home' | 'templates' | 'runs' | 'results' | 'knowledge' | 'skills' | 'dashboard' | 'models' | 'chat' | 'agents' | 'brain' | 'studio' | 'pipelines' | 'mcp' | 'evaluations' | 'world' | 'extensions' | 'factory' | 'collaboration'

/* ---------- complexity modes: presentation-only; never changes workflow logic ---------- */
export type Mode = 'easy' | 'guided' | 'pro' | 'developer'
const MODE_RANK: Record<Mode, number> = { easy: 0, guided: 1, pro: 2, developer: 3 }
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: 'easy', label: 'Easy', hint: 'Just describe it and run. No settings.' },
  { key: 'guided', label: 'Guided', hint: 'The AI Architect walks you through it.' },
  { key: 'pro', label: 'Pro', hint: 'Full canvas, models, tools, conditions.' },
  { key: 'developer', label: 'Developer', hint: 'JSON, prompts, traces, raw everything.' },
]
const ModeCtx = createContext<Mode>('guided')
export const useMode = () => useContext(ModeCtx)
/** show content only at/above a minimum mode */
export function AtLeast({ mode: min, children }: { mode: Mode; children: React.ReactNode }) {
  const m = useMode()
  return MODE_RANK[m] >= MODE_RANK[min] ? <>{children}</> : null
}

const NAV: { key: Page; icon: string; label: string; easyLabel?: string; group: 'primary' | 'advanced'; soon?: boolean }[] = [
  { key: 'home', icon: '🏠', label: 'Home', group: 'primary' },
  { key: 'templates', icon: '✦', label: 'Templates', group: 'primary' },
  { key: 'pipelines', icon: '⛓', label: 'Workflows', easyLabel: 'Create', group: 'primary' },
  { key: 'studio', icon: '🎨', label: 'Studio', easyLabel: 'Images', group: 'primary' },
  { key: 'runs', icon: '▷', label: 'Runs', easyLabel: 'Running', group: 'primary' },
  { key: 'results', icon: '📦', label: 'Results', group: 'primary' },
  { key: 'world', icon: '◈', label: 'Company World', group: 'primary' },
  { key: 'knowledge', icon: '📚', label: 'Knowledge', group: 'primary' },
  { key: 'agents', icon: '🤖', label: 'Agents', easyLabel: 'Your Team', group: 'advanced' },
  { key: 'skills', icon: '📘', label: 'Skills', group: 'advanced' },
  { key: 'brain', icon: '🧠', label: 'Agent Rules', group: 'advanced' },
  { key: 'models', icon: '▣', label: 'Models', group: 'advanced' },
  { key: 'chat', icon: '💬', label: 'Chat', group: 'advanced' },
  { key: 'dashboard', icon: '📊', label: 'System', group: 'advanced' },
  { key: 'mcp', icon: '🔌', label: 'Tools', group: 'advanced' },
  { key: 'evaluations', icon: '✓', label: 'Evaluation Lab', group: 'advanced' },
  { key: 'factory', icon: '▦', label: 'Local Worker Factory', group: 'advanced' },
  { key: 'collaboration', icon: '⇄', label: 'AI Collaboration', group: 'advanced' },
  { key: 'extensions', icon: '▣', label: 'Extensions', group: 'advanced' },
]

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const requested = new URLSearchParams(window.location.search).get('page') as Page | null
    return requested && NAV.some(n => n.key === requested && !n.soon) ? requested : 'home'
  })
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('cc-mode') as Mode) || 'guided')
  const [advOpen, setAdvOpen] = useState(false)
  const [onboard, setOnboard] = useState(() => !localStorage.getItem('cc-onboarded') && new URLSearchParams(window.location.search).get('onboarding') !== 'skip')
  const [palette, setPalette] = useState(false)
  useEffect(() => subscribeEvents(setSys), [])
  useEffect(() => { localStorage.setItem('cc-mode', mode) }, [mode])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  const flat = MODE_RANK[mode] >= MODE_RANK.pro // pro/dev show everything flat
  const primary = NAV.filter(n => n.group === 'primary')
  const advanced = NAV.filter(n => n.group === 'advanced')
  const label = (n: typeof NAV[number]) => (mode === 'easy' && n.easyLabel) ? n.easyLabel : n.label
  const up = sys?.services.lmstudio

  const NavBtn = (n: typeof NAV[number]) => (
    <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''} ${n.soon ? 'soon' : ''}`}
      onClick={() => !n.soon && setPage(n.key)}>
      <span>{n.icon}</span> {label(n)}
      {n.soon && <span className="soon-tag">SOON</span>}
    </button>
  )

  return (
    <ModeCtx.Provider value={mode}>
      <div className="app">
        <aside className="side">
          <div className="brand"><span className="dot">◉</span> AI COMMAND CENTER</div>
          {primary.map(NavBtn)}
          {flat ? advanced.map(NavBtn) : (
            <div className="nav-group">
              <button className="nav-group-head" onClick={() => setAdvOpen(o => !o)}>
                <span>⚙</span> Advanced Tools <span className="chev">{advOpen ? '▾' : '▸'}</span>
              </button>
              {advOpen && advanced.map(NavBtn)}
            </div>
          )}
          <div className="side-foot">M3 Ultra · 512 GB<br />100% local · $0/token</div>
        </aside>
        <main className="main">
          {page !== 'pipelines' && <div className="topbar">
            <h1>{label(NAV.find(n => n.key === page)!)}</h1>
            <ModeSelector mode={mode} onChange={setMode} />
            <button className="btn danger killall" title="Emergency stop — cancel every running agent & workflow"
              onClick={async () => { if (confirm('Stop ALL running agents and workflows now?')) { const r = await api.killAll(); alert(`Stopped ${r.stopped} running task(s).`) } }}>🛑 Stop all</button>
            <span className={`live ${up ? '' : 'down'}`}><span className="pulse" /> {up ? 'LIVE' : 'OFFLINE'}</span>
          </div>}
          {page === 'home' && <Home sys={sys} go={setPage} />}
          {page === 'templates' && <Templates go={setPage} />}
          {page === 'runs' && <RunCenter />}
          {page === 'results' && <ArtifactCenter />}
          {page === 'world' && <CompanyWorld go={setPage} />}
          {page === 'knowledge' && <Knowledge />}
          {page === 'skills' && <Skills go={setPage} />}
          {page === 'mcp' && <Tools />}
          {page === 'evaluations' && <EvaluationLab />}
          {page === 'factory' && <LocalWorkerFactory />}
          {page === 'collaboration' && <CollaborationCenter />}
          {page === 'extensions' && <ExtensionCenter />}
          {page === 'dashboard' && <Dashboard sys={sys} />}
          {page === 'models' && <Models sys={sys} />}
          {page === 'chat' && <Chat />}
          {page === 'agents' && <Agents />}
          {page === 'brain' && <Brain />}
          {page === 'studio' && <Studio comfy={sys?.services.comfy} />}
          {page === 'pipelines' && <WorkflowStudioV2 mode={mode} onModeChange={setMode} />}
        </main>
        {onboard && <Onboarding onDone={(m, startPage) => { if (m) setMode(m); localStorage.setItem('cc-onboarded', '1'); setOnboard(false); if (startPage) setPage(startPage) }} />}
        {palette && <CommandPalette nav={NAV} onGo={p => { setPage(p as Page); setPalette(false) }} onClose={() => setPalette(false)} />}
      </div>
    </ModeCtx.Provider>
  )
}

function LocalWorkerFactory() {
  const [status, setStatus] = useState<LocalFactoryStatus | null>(null)
  const [tasks, setTasks] = useState<LocalFactoryTaskSummary[]>([])
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextTasks] = await Promise.all([api.localFactoryStatus(), api.localFactoryTasks()])
      setStatus(nextStatus); setTasks(nextTasks); setError('')
    } catch (value) { setError(String(value)) }
  }, [])
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  const active = tasks.filter(task => task.status === 'RUNNING' || task.status === 'QUEUED')
  const completed = tasks.filter(task => task.status === 'COMPLETED').length
  const failed = tasks.filter(task => ['FAILED', 'PARTIAL', 'BLOCKED', 'CANCELLED'].includes(task.status)).length
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>Four bounded Qwen Coder workers share one local model allocation. Workers analyze and propose; they cannot edit files, run commands, or integrate code.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="grid cols-4">
        <div className="card home-stat"><h3>Factory</h3><div className="stat">{status?.enabled ? 'Ready' : '–'}</div><div className="sub">{status?.model || 'checking…'}</div></div>
        <div className="card home-stat"><h3>Worker slots</h3><div className="stat">{status?.active ?? 0}<small> / {status?.concurrency ?? 4}</small></div><div className="sub">{status?.queued ?? 0} queued</div></div>
        <div className="card home-stat"><h3>Completed</h3><div className="stat">{completed}</div><div className="sub">durable task records</div></div>
        <div className="card home-stat"><h3>Needs review</h3><div className="stat">{failed}</div><div className="sub">blocked, partial, failed, or cancelled</div></div>
      </div>
      <div className="section-title">Worker queue</div>
      <div className="rows">
        {!tasks.length && <div className="empty">No local worker tasks yet.</div>}
        {tasks.map(task => (
          <div className="row" key={task.taskId}>
            <span className={`dot-s ${task.status === 'COMPLETED' ? 'loaded' : task.status === 'RUNNING' ? 'loading' : 'disk'}`} />
            <div><div className="name">{task.taskId}</div><div className="meta">{task.status} · updated {new Date(task.updatedAt).toLocaleTimeString()}</div></div>
            {(task.status === 'RUNNING' || task.status === 'QUEUED') && <button className="btn danger spacer" style={{ marginLeft: 'auto' }} onClick={async () => { await api.cancelLocalFactoryTask(task.taskId); refresh() }}>Stop</button>}
          </div>
        ))}
      </div>
      <AtLeast mode="developer"><div className="card" style={{ marginTop: 16 }}><h3>Enforced operating policy</h3><p className="sub">Loopback LM Studio only · pinned qwen-coder-factory model · exact allowlisted context files · strict structured output · bounded tokens, bytes, queue, timeout, and concurrency · no tools or direct repository writes.</p><div className="meta">Active or queued records: {active.length} · API: /api/local-factory</div></div></AtLeast>
    </div>
  )
}

function CollaborationCenter() {
  const [status, setStatus] = useState<CollaborationStatus | null>(null)
  const [tasks, setTasks] = useState<CollaborationTaskSummary[]>([])
  const [leases, setLeases] = useState<CollaborationLease[]>([])
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextTasks, nextLeases] = await Promise.all([api.collaborationStatus(), api.collaborationTasks(), api.collaborationLeases()])
      setStatus(nextStatus); setTasks(nextTasks); setLeases(nextLeases); setError('')
    } catch (value) { setError(String(value)) }
  }, [])
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 3_000); return () => window.clearInterval(timer) }, [refresh])
  const waiting = (status?.counts.QUEUED || 0) + (status?.counts.RUNNING || 0)
  const review = (status?.counts.BLOCKED || 0) + (status?.counts.PARTIAL || 0) + (status?.counts.FAILED || 0)
  return <div data-testid="collaboration-center">
    <p className="sub" style={{ marginBottom: 16 }}>Codex owns architecture and integration. Fable implements bounded packets in isolated worktrees. Qwen reviews read-only. Every worker result remains review-gated.</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="grid cols-4">
      <div className="card home-stat"><h3>Control plane</h3><div className="stat">{status?.enabled ? 'Ready' : '–'}</div><div className="sub">durable task records</div></div>
      <div className="card home-stat"><h3>Active work</h3><div className="stat">{waiting}</div><div className="sub">queued or running packets</div></div>
      <div className="card home-stat"><h3>Worktree leases</h3><div className="stat">{status?.activeLeases ?? 0}</div><div className="sub">{status?.blockedLeases ?? 0} blocked after review/recovery</div></div>
      <div className="card home-stat"><h3>Needs review</h3><div className="stat">{review}</div><div className="sub">never retried or integrated blindly</div></div>
    </div>
    <div className="plain-callout" style={{ marginTop: 16 }}><b>Safe operating boundary</b><p>The dispatch receipt contract is {status?.dispatchContract.verified ? 'verified' : 'checking'} across task, lease, owned process, actual model provenance, inspected commit, and terminal result. Live product dispatch remains disabled until an explicit owner command approves the exact packet and clean base; integration always remains a separate Codex review.</p><small>Automatic integration: {status?.policy.automaticIntegration ? 'enabled' : 'disabled'} · Worktrees: {status?.worktreeEnabled ? 'source checkout ready' : 'unavailable in packaged install'} · Network access: disabled · Subagents: disabled</small></div>
    <div className="plain-callout" style={{ marginTop: 12 }}><b>Measured routing: shadow only</b><p>{status?.metrics.observations || 0} accepted-cycle observations are recorded. Fable and Qwen recommendations remain advisory until the declared sample, first-pass, review-time, boundary, and escaped-defect thresholds pass.</p><small>Fable task classes eligible: {status?.metrics.byTaskClass.filter(item => item.recommendation === 'ELIGIBLE_FOR_FABLE_DEFAULT_REVIEW').length || 0} · Qwen preflight: {status?.metrics.qwen.recommendation === 'ELIGIBLE_FOR_QWEN_PREFLIGHT_REVIEW' ? 'eligible for lead review' : 'insufficient evidence'} · Automatic routing authority: disabled</small></div>
    <div className="section-title">Fable task packets</div>
    <div className="rows" aria-label="Fable task packets">
      {!tasks.length && <div className="empty">No collaboration task packets yet.</div>}
      {tasks.map(task => <div className="row" key={task.taskId}><span className={`dot-s ${task.status === 'COMPLETED' ? 'loaded' : task.status === 'RUNNING' ? 'loading' : 'disk'}`} /><div><div className="name">{task.taskId}</div><div className="meta">{task.status} · updated {new Date(task.updatedAt).toLocaleString()}</div></div></div>)}
    </div>
    <AtLeast mode="developer"><div className="section-title">Durable worktree leases</div><div className="rows" aria-label="Durable worktree leases">
      {!leases.length && <div className="empty">No registered Fable worktrees.</div>}
      {leases.map(lease => <div className="row" key={lease.taskId}><span className={`dot-s ${lease.state === 'ACTIVE' ? 'loading' : lease.state === 'BLOCKED' ? 'disk' : 'loaded'}`} /><div><div className="name">{lease.taskId}</div><div className="meta">{lease.state}{lease.reason ? ` · ${lease.reason}` : ''} · {lease.branch}</div></div></div>)}
    </div></AtLeast>
  </div>
}

function CommandPalette({ nav, onGo, onClose }: { nav: typeof NAV; onGo: (p: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const items = [
    ...nav.filter(n => !n.soon).map(n => ({ icon: n.icon, label: 'Go to ' + n.label, run: () => onGo(n.key) })),
    { icon: '🛑', label: 'Stop all running tasks', run: async () => { await api.killAll(); onClose() } },
  ]
  const filtered = items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input autoFocus placeholder="Jump to… or type a command" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && filtered[0]) filtered[0].run(); if (e.key === 'Escape') onClose() }} />
        <div className="palette-list">
          {filtered.map((i, k) => <button key={k} className="palette-item" onClick={i.run}><span>{i.icon}</span> {i.label}</button>)}
          {filtered.length === 0 && <div className="empty" style={{ padding: 20 }}>No matches</div>}
        </div>
        <div className="palette-hint">⌘K to toggle · Enter to run · Esc to close</div>
      </div>
    </div>
  )
}

/* ================= Templates ================= */
function Templates({ go }: { go: (p: Page) => void }) {
  const [tpls, setTpls] = useState<Template[]>([])
  const [busy, setBusy] = useState('')
  useEffect(() => { api.templates().then(setTpls).catch(() => {}) }, [])
  const use = async (id: string, open: boolean) => {
    setBusy(id)
    try {
      const t = await api.template(id)
      const saved = await api.saveWorkflow({ ...t.workflow, id: '', name: t.title })
      sessionStorage.setItem('cc-open-wf', saved.id)
      go('pipelines')
    } catch (e) { alert('Could not start template: ' + e) }
    setBusy('')
  }
  const cats = [...new Set(tpls.map(t => t.category))]
  return (
    <div>
      <p className="sub" style={{ marginBottom: 18, fontSize: 14 }}>Ready-made teams for common outcomes. Pick one, give it your input, and run — customize on the canvas any time.</p>
      {cats.map(cat => (
        <div key={cat}>
          <div className="section-title">{cat}</div>
          <div className="grid cols-2">
            {tpls.filter(t => t.category === cat).map(t => (
              <div className="card tpl-card" key={t.id}>
                <div className="tpl-title">{t.title} {t.beginner && <span className="tpl-badge">Beginner-friendly</span>}</div>
                <div className="tpl-produces">→ {t.produces}</div>
                <div className="tpl-meta">
                  <span>📥 Needs: {t.needs}</span><span>· {t.complexity}</span><span>· {t.localOnly ? '🔒 Local' : '☁️ Cloud'}</span><span>· {t.nodeCount} steps</span>
                </div>
                {t.note && <div className="tpl-note">{t.note}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn primary" disabled={busy === t.id} onClick={() => use(t.id, false)}>{busy === t.id ? '…' : '⚡ Use this'}</button>
                  <button className="btn" disabled={busy === t.id} onClick={() => use(t.id, true)}>Open in canvas</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ================= Company World: real-state Operations Map ================= */
function CompanyWorld({ go }: { go: (page: Page) => void }) {
  const [world, setWorld] = useState<any>(null), [selectedAgent, setSelectedAgent] = useState(''), [task, setTask] = useState(''), [busy, setBusy] = useState(false), [managingDepartments, setManagingDepartments] = useState(false), [departmentName, setDepartmentName] = useState(''), [departmentColor, setDepartmentColor] = useState('#8b7cf6')
  const refresh = useCallback(() => api.companyWorld().then(setWorld), [])
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 2000); return () => clearInterval(timer) }, [refresh])
  if (!world) return <div className="empty">Loading operational state…</div>
  const selected = world.agents.find((agent: any) => agent.id === selectedAgent), selectedRun = world.activeRuns.find((run: any) => run.agentId === selectedAgent)
  const assign = async () => { if (!selected || !task.trim()) return; setBusy(true); try { await api.runTask(selected.id, task); setTask(''); await refresh() } finally { setBusy(false) } }
  const createDepartment = async () => { if (!departmentName.trim()) return; setBusy(true); try { await api.createDepartment(departmentName, departmentColor); setDepartmentName(''); await refresh() } catch (error) { alert(String(error)) } finally { setBusy(false) } }
  const removeDepartment = async (department: any) => { if (!confirm(`Delete empty department ${department.name}?`)) return; try { await api.deleteDepartment(department.id, world.organizationRevision); await refresh() } catch (error) { alert(String(error)) } }
  return <div className="company-world"><div className="world-toolbar"><div><b>2D Employee Operations Map</b><span>Persisted checkpoints, control state, real workers, and bounded queues · no synthetic progress</span></div><button className="btn" onClick={refresh}>Refresh</button></div>
    <div className="world-layout"><div className="operations-map">{world.departments.map((department: any) => <section className="department-zone" key={department.id} data-department-id={department.id} style={{ '--department': department.color } as React.CSSProperties}><header><span /> <b>{department.name}</b><em>{department.agentIds.length} workers</em>{managingDepartments && department.agentIds.length === 0 && <button className="btn danger" aria-label={`Delete ${department.name} department`} onClick={() => removeDepartment(department)}>Delete</button>}</header><div className="department-agents">{department.agentIds.map((id: string) => { const agent = world.agents.find((item: any) => item.id === id), run = world.activeRuns.find((item: any) => item.agentId === id); return <button key={id} className={`world-agent ${run ? `state-${run.status}` : 'state-idle'} ${selectedAgent === id ? 'selected' : ''}`} onClick={() => setSelectedAgent(id)}><span>{agent.avatar}</span><b>{agent.name}</b><small>{run ? run.activity : 'Available'}</small><i>{run ? run.status : 'idle'}</i></button> })}</div></section>)}
      <section className="department-zone workflow-transit"><header><span /><b>Workflow Transit</b><em>{world.activeRuns.filter((run: any) => run.type === 'workflow').length} active</em></header>{world.activeRuns.filter((run: any) => run.type === 'workflow').map((run: any) => <button key={run.id} data-world-run-id={run.id} onClick={() => go('runs')} className={`world-workflow state-${run.status}`}><b>{run.workflowName}</b><span>{run.currentNodeId || 'Scheduling'} · {run.status}</span><small>{run.activity}</small><small>{run.workflowVersion || 'unversioned'} · checkpoint r{run.checkpointRevision ?? 0}</small></button>)}{!world.activeRuns.some((run: any) => run.type === 'workflow') && <p>No workflow is currently executing.</p>}</section>
    </div><aside className="world-inspector">{selected ? <><div className="world-agent-profile"><span>{selected.avatar}</span><div><b>{selected.name}</b><small>{selected.role} · {selected.department}</small></div></div><dl><dt>Status</dt><dd>{selectedRun?.status || 'Available'}</dd><dt>Model</dt><dd>{selected.model}</dd><dt>Permissions</dt><dd>{selected.permissions}</dd><dt>Skills</dt><dd>{selected.skills.length || 0}</dd></dl>{selectedRun && <div className="world-current-task"><span>ACTIVE TASK</span><b>{selectedRun.task}</b><p>{selectedRun.activity}</p><button className="btn danger" onClick={async () => { await api.stopRun(selectedRun.id); refresh() }}>Stop worker</button><button className="btn" onClick={() => go('runs')}>Open console</button></div>}<label>Assign a task<textarea rows={5} value={task} onChange={e => setTask(e.target.value)} placeholder="Describe a real task for this worker…" /></label><button className="btn primary" disabled={busy || !task.trim() || !!selectedRun} onClick={assign}>{selectedRun ? 'Worker is occupied' : busy ? 'Assigning…' : 'Assign task'}</button><button className="btn" onClick={() => go('agents')}>Open agent configuration</button></> : <><div className="world-overview"><b>Company status</b><span>{world.activeRuns.length} active runs</span><span>{world.agents.length} workers</span><span>{world.workflows.length} workflows</span></div><div className="resource-grid"><div><span>RAM used</span><b>{world.resources.ram.usedGB} GB</b></div><div><span>Loaded models</span><b>{world.resources.loadedModels.length}</b></div><div><span>Model calls</span><b>{world.resources.modelScheduling.active} active</b></div><div><span>Model queue</span><b>{world.resources.modelScheduling.queued} waiting</b></div></div><p className="sub">Global model calls are FIFO and bounded across runs. Unknown memory estimates still use the concurrency limit.</p><p className="sub">Select a real agent or active workflow. Animation appears only while a matching backend run exists.</p><button className="btn" onClick={() => setManagingDepartments(value => !value)}>{managingDepartments ? 'Done managing departments' : 'Manage departments'}</button>{managingDepartments && <div className="world-department-form"><label>Department name<input value={departmentName} onChange={event => setDepartmentName(event.target.value)} /></label><label>Department color<input aria-label="Department color" type="color" value={departmentColor} onChange={event => setDepartmentColor(event.target.value)} /></label><button className="btn primary" disabled={busy || !departmentName.trim()} onClick={createDepartment}>Create department</button><p className="sub">Empty departments are durable. Assign workers from Agent configuration; departments with workers cannot be deleted.</p></div>}<button className="btn" onClick={() => go('pipelines')}>Open visual workflows</button></>}</aside></div>
  </div>
}

/* ================= Extension Control Center ================= */
function ExtensionCenter() {
  const [plugins, setPlugins] = useState<any[]>([]), [customNodes, setCustomNodes] = useState<any[]>([]), [busy, setBusy] = useState('')
  const refresh = useCallback(async () => { const [pluginData, nodeData] = await Promise.all([api.plugins(), api.customNodes()]); setPlugins(pluginData); setCustomNodes(nodeData) }, [])
  useEffect(() => { refresh().catch(() => {}) }, [refresh])
  const act = async (id: string, operation: () => Promise<any>) => { setBusy(id); try { await operation(); await refresh() } catch (error) { alert(String(error)) } finally { setBusy('') } }
  const importBundle = async (file?: File) => { if (!file) return; try { const raw = JSON.parse(await file.text()); await act(String(raw.plugin?.id || raw.id || 'import'), () => api.installPluginBundle(raw.plugin || raw)); } catch (error) { alert(`Plugin import failed: ${error}`) } }
  const exportBundle = async (plugin: any) => { try { const bundle = await api.exportPlugin(plugin.id), blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), href = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = href; anchor.download = `${plugin.id}-${plugin.version}.plugin.json`; anchor.click(); URL.revokeObjectURL(href) } catch (error) { alert(String(error)) } }
  return <div className="extension-center"><p className="sub">Plugins and custom nodes are executable packages. Imported code stays disabled and untrusted until you review its exact manifest, provenance, dependencies, permissions, compatibility, deterministic fixtures, and signature integrity.</p><label className="btn">Import reviewed plugin JSON<input type="file" accept="application/json,.json" hidden onChange={event => { importBundle(event.target.files?.[0]); event.target.value = '' }} /></label><div className="section-title">Plugin marketplace and installed plugins</div><div className="grid cols-2">{plugins.map(plugin => <div className="card extension-card" data-plugin-id={plugin.id} key={plugin.id}><div><b>{plugin.name}</b><span>v{plugin.version}</span></div><p>{plugin.description}</p><dl><dt>Publisher</dt><dd>{plugin.publisher || 'Unknown'}</dd><dt>Trust</dt><dd>{plugin.trustStatus || (plugin.verified ? 'verified' : 'not reviewed')}</dd><dt>Signature</dt><dd>{plugin.signatureStatus || (plugin.verified ? 'verified' : 'unsigned')}</dd><dt>Permissions</dt><dd>{plugin.permissions?.join(', ') || 'None declared'}</dd><dt>Dependencies</dt><dd>{plugin.dependencies?.join(', ') || 'None declared'}</dd>{plugin.manifestHash && <><dt>Manifest</dt><dd><code title={plugin.manifestHash}>{plugin.manifestHash.slice(0, 16)}…</code></dd></>}{plugin.reviewReceipt && <><dt>Review receipt</dt><dd><code title={plugin.reviewReceipt.receiptHash}>{plugin.reviewReceipt.receiptHash.slice(0, 16)}…</code></dd><dt>Reviewed by</dt><dd>{plugin.reviewReceipt.reviewedBy}</dd></>}</dl><div className="extension-actions">{!plugin.installed ? <button className="btn primary" disabled={busy === plugin.id} onClick={() => act(plugin.id, () => api.installPlugin(plugin.id))}>Install verified package</button> : <>{plugin.trustStatus === 'untrusted' && <button className="btn" disabled={!plugin.manifestHash} onClick={() => { if (confirm(`Approve only this exact manifest?\n\n${plugin.manifestHash}`)) act(plugin.id, () => api.reviewPlugin(plugin.id, plugin.manifestHash!)) }}>Review exact manifest</button>}<button className="btn" onClick={async () => { const result = await api.testPlugin(plugin.id); alert(result.passed ? 'Package checks passed.' : 'Package checks failed.') }}>Test package</button><button className="btn" onClick={() => exportBundle(plugin)}>Export JSON</button><button className="btn" disabled={busy === plugin.id || plugin.trustStatus === 'untrusted'} onClick={() => act(plugin.id, () => api.togglePlugin(plugin.id, plugin.enabled === false))}>{plugin.enabled === false ? 'Enable' : 'Disable'}</button><button className="btn danger" onClick={() => { if (confirm(`Uninstall ${plugin.name} and its contributed nodes?`)) act(plugin.id, () => api.uninstallPlugin(plugin.id)) }}>Uninstall</button></>}</div></div>)}</div><div className="section-title">Installed custom nodes</div><div className="grid cols-2">{customNodes.map(node => <div className="card extension-card" key={node.id}><div><b>{node.icon || '◇'} {node.name}</b><span>v{node.version}</span></div><p>{node.description}</p><dl><dt>Adapter</dt><dd>{node.implementation?.kind}</dd><dt>Trust</dt><dd>{node.trustStatus}</dd><dt>Provenance</dt><dd>{node.provenance?.type || 'local'}{node.provenance?.pluginVersion ? ` · plugin ${node.provenance.pluginVersion}` : ''}</dd><dt>Tests</dt><dd>{node.tests?.length || 0}</dd>{node.provenance?.reviewReceiptHash && <><dt>Review receipt</dt><dd><code title={node.provenance.reviewReceiptHash}>{node.provenance.reviewReceiptHash.slice(0, 16)}…</code></dd></>}</dl></div>)}</div></div>
}

/* ================= Evaluation Laboratory ================= */
function EvaluationLab() {
  const [suites, setSuites] = useState<any[]>([]), [datasets, setDatasets] = useState<any[]>([]), [workflows, setWorkflows] = useState<WfSummary[]>([]), [runs, setRuns] = useState<RunSummary[]>([]), [proposals, setProposals] = useState<any[]>([])
  const [name, setName] = useState('Quality gate'), [workflowId, setWorkflowId] = useState(''), [checkType, setCheckType] = useState('contains'), [checkValue, setCheckValue] = useState(''), [suiteDatasetId, setSuiteDatasetId] = useState(''), [selectedRun, setSelectedRun] = useState(''), [busy, setBusy] = useState('')
  const [datasetName, setDatasetName] = useState('Regression cases'), [datasetCases, setDatasetCases] = useState('[{"id":"case-1","input":"sample","expected":"sample","match":"equals"}]'), [caseRunIds, setCaseRunIds] = useState<Record<string, string>>({})
  const refresh = useCallback(async () => { const [evaluationData, datasetData, workflowData, runData, proposalData] = await Promise.all([api.evaluations(), api.evaluationDatasets(), api.workflows(), api.runs(), api.learningProposals()]); setSuites(evaluationData); setDatasets(datasetData); setWorkflows(workflowData); setRuns(runData); setProposals(proposalData); if (!workflowId && workflowData[0]) setWorkflowId(workflowData[0].id) }, [workflowId])
  useEffect(() => { refresh().catch(() => {}) }, [refresh])
  const checkNeedsValue = checkType !== 'json' && checkType !== 'no-needs-review'
  const createSuite = async () => { if (!name.trim() || (checkNeedsValue && !checkValue.trim())) return; setBusy('create'); try { await api.saveEvaluation({ name, workflowId, ...(suiteDatasetId ? { datasetId: suiteDatasetId } : {}), checks: [{ id: 'primary', type: checkType, ...(checkNeedsValue ? { value: ['min-length', 'run-duration-max'].includes(checkType) ? Number(checkValue) : checkValue } : {}) }] }); setCheckValue(''); await refresh() } finally { setBusy('') } }
  const createDataset = async () => { if (!datasetName.trim()) return; setBusy('dataset'); try { const cases = JSON.parse(datasetCases); await api.saveEvaluationDataset({ name: datasetName, cases }); await refresh() } finally { setBusy('') } }
  const runSuite = async (id: string) => { setBusy(id); try { const suite = suites.find(item => item.id === id), dataset = datasets.find(item => item.id === suite?.datasetId); if (dataset) { const cases = dataset.cases.map((item: any) => ({ caseId: item.id, runId: caseRunIds[`${id}:${item.id}`] })), first = runs.find(run => run.id === cases[0]?.runId); await api.runDatasetEvaluation(id, { candidateId: first?.candidateId || undefined, cases }) } else await api.runEvaluation(id, selectedRun ? { runId: selectedRun } : { output: checkValue }); await refresh() } finally { setBusy('') } }
  const analyze = async () => { if (!workflowId) return; setBusy('analyze'); try { await api.analyzeLearning(workflowId); await refresh() } finally { setBusy('') } }
  const eligibleRuns = runs.filter(run => run.type === 'workflow' && (!workflowId || run.workflowId === workflowId))
  const selectedRunRecord = eligibleRuns.find(run => run.id === selectedRun)
  return <div className="evaluation-lab"><p className="sub">Deterministic checks are the default. Results attach to real runs and can block production promotion when configured as gates.</p><div className="grid cols-2">
    <div className="card"><div className="section-title" style={{ marginTop: 0 }}>Create deterministic suite</div><label>Name<input value={name} onChange={e => setName(e.target.value)} /></label><label>Workflow<select value={workflowId} onChange={e => { setWorkflowId(e.target.value); setSelectedRun('') }}>{workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label><label>Versioned dataset (optional)<select value={suiteDatasetId} onChange={e => setSuiteDatasetId(e.target.value)}><option value="">Single-run suite</option>{datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.cases.length} cases</option>)}</select></label><div className="eval-check-row"><select value={checkType} onChange={e => setCheckType(e.target.value)}><option value="contains">Contains</option><option value="not-contains">Does not contain</option><option value="min-length">Minimum length</option><option value="regex">Regular expression</option><option value="json">Valid JSON</option><option value="run-duration-max">Maximum run duration (ms)</option><option value="no-needs-review">No unresolved effect review</option><option value="visual-report">Visual regression report</option><option value="accessibility-report">Accessibility report</option><option value="security-report">Security report</option><option value="model-report">Bounded model rubric report</option></select>{checkNeedsValue && <input value={checkValue} onChange={e => setCheckValue(e.target.value)} placeholder={checkType === 'run-duration-max' ? 'Maximum milliseconds' : checkType.endsWith('-report') ? 'Run artifact report filename' : 'Expected value'} />}</div><button className="btn primary" disabled={busy === 'create' || (checkNeedsValue && !checkValue.trim())} onClick={createSuite}>Create suite</button></div>
    <div className="card"><div className="section-title" style={{ marginTop: 0 }}>Run evidence</div><label>Attach evaluation to an exact workflow run<select value={selectedRunRecord?.id || ''} onChange={e => setSelectedRun(e.target.value)}><option value="">Use typed sample value (never promotable)</option>{eligibleRuns.slice(0, 100).map(run => <option key={run.id} value={run.id}>{run.title || run.task?.slice(0, 45) || run.id} · {run.status}{run.candidateId ? ` · candidate ${run.candidateId.slice(-8)}` : ' · no candidate'}</option>)}</select></label>{selectedRunRecord ? <div className="plain-callout" data-testid="evaluation-run-evidence"><b>{selectedRunRecord.candidateId ? 'Exact candidate evidence' : 'Diagnostic run only'}</b><p>{selectedRunRecord.workflowVersion || 'unversioned'} · {selectedRunRecord.environment || 'unknown environment'} · {selectedRunRecord.status}</p>{!selectedRunRecord.candidateId && <small>This run can record a score but cannot satisfy a Production gate.</small>}</div> : <p className="sub">Typed sample checks are useful while authoring a suite, but they never satisfy promotion gates.</p>}<button className="btn" onClick={analyze} disabled={!workflowId || busy === 'analyze'}>Analyze failures for learning proposals</button></div>
  </div><div className="grid cols-2"><div className="card"><div className="section-title" style={{ marginTop: 0 }}>Versioned regression dataset</div><label>Name<input value={datasetName} onChange={event => setDatasetName(event.target.value)} /></label><label>Cases JSON<textarea rows={5} value={datasetCases} onChange={event => setDatasetCases(event.target.value)} /></label><button className="btn primary" disabled={busy === 'dataset' || !datasetName.trim()} onClick={createDataset}>Save dataset</button></div><div className="card"><div className="section-title" style={{ marginTop: 0 }}>Datasets</div>{datasets.map(dataset => <div key={dataset.id}><b>{dataset.name}</b><small>{dataset.cases.length} cases · {dataset.definitionHash}</small><button className="btn" onClick={async () => { await api.deleteEvaluationDataset(dataset.id); refresh() }}>Delete</button></div>)}</div></div><div className="section-title">Evaluation suites</div><div className="grid cols-2">{suites.map(suite => { const latest = suite.history?.[0], dataset = datasets.find(item => item.id === suite.datasetId), datasetReady = !dataset || dataset.cases.every((item: any) => caseRunIds[`${suite.id}:${item.id}`]); const wrongWorkflow = !!selectedRunRecord && !!suite.workflowId && selectedRunRecord.workflowId !== suite.workflowId; return <div className="card eval-suite" key={suite.id}><div><b>{suite.name}</b><span className={latest?.passed ? 'ok' : latest ? 'bad' : ''}>{latest ? `${latest.score}% · ${latest.passed ? 'PASS' : 'FAIL'}` : 'Not run'}</span></div><small>{suite.workflowId || 'Any workflow'} · {dataset ? `${dataset.cases.length} versioned cases` : `${suite.checks?.length || 0} checks`} · {suite.history?.length || 0} recorded runs</small>{dataset && <div className="eval-results" data-testid="dataset-case-runs">{dataset.cases.map((item: any) => <label key={item.id}>{item.id}<select value={caseRunIds[`${suite.id}:${item.id}`] || ''} onChange={event => setCaseRunIds(current => ({ ...current, [`${suite.id}:${item.id}`]: event.target.value }))}><option value="">Select exact candidate run</option>{eligibleRuns.filter(run => run.status === 'done' && run.candidateId).map(run => <option key={run.id} value={run.id}>{run.task?.slice(0, 45) || run.id} · {run.candidateId?.slice(-8)}</option>)}</select></label>)}</div>}{latest && <><div className="eval-results">{latest.results?.map((result: any) => <span key={result.id || result.caseId}>{result.passed ? '✓' : '✗'} {result.detail}</span>)}</div><small className={latest.promotable ? 'ok' : 'bad'}>{latest.promotable ? `Promotable receipt · ${latest.candidateId} · ${latest.workflowVersion}` : `Diagnostic only · ${latest.nonPromotableReason || 'not candidate-bound'}`}</small>{latest.baseline && <small data-testid="evaluation-baseline-delta">Baseline {latest.baseline.score}% · {latest.baseline.delta >= 0 ? '+' : ''}{latest.baseline.delta} points</small>}</>}<div><button className="btn primary" disabled={busy === suite.id || wrongWorkflow || !datasetReady || (!dataset && !selectedRun && !checkValue)} title={wrongWorkflow ? 'Select a run from this suite’s workflow' : ''} onClick={() => runSuite(suite.id)}>{dataset ? 'Run dataset evaluation' : 'Run evaluation'}</button>{latest?.promotable && suite.baselineRecordId !== latest.id && <button className="btn" onClick={async () => { await api.setEvaluationBaseline(suite.id, latest.id); refresh() }}>Set latest as baseline</button>}<button className="btn" onClick={async () => { if (confirm(`Delete ${suite.name}?`)) { await api.deleteEvaluation(suite.id); refresh() } }}>Delete</button></div></div> })}</div>
  <div className="section-title">Controlled learning proposals</div>{!proposals.length && <div className="empty">No evidence-backed proposals yet. Analyze a workflow after it has run.</div>}{proposals.map(proposal => { const verificationRecord = suites.flatMap(suite => suite.history || []).find(record => record.promotable && record.passed && record.workflowId === proposal.candidateWorkflowId); return <div className="card learning-proposal" data-workflow-id={proposal.workflowId} key={proposal.id}><div><b>{proposal.title}</b><span>{proposal.status}</span></div><p>{proposal.rationale}</p><small>{proposal.workflowId} · {proposal.evidence?.length || 0} exact run receipts · observed {proposal.observationCount || 1} times · source {proposal.sourceWorkflowHash || 'legacy/unbound'}</small><pre>{JSON.stringify(proposal.patch, null, 2)}</pre>{proposal.candidateWorkflowId && <div className="plain-callout" data-testid="learning-candidate"><b>Separate Development candidate created</b><p>{proposal.candidateWorkflowId}</p><small>The source workflow was not changed. Test and promote this candidate through the ordinary governed lifecycle.</small>{proposal.status === 'approved' && verificationRecord && <button className="btn primary" onClick={async () => { await api.verifyLearningProposal(proposal.id, verificationRecord.id); refresh() }}>Bind exact regression receipt</button>}{proposal.verification && <small data-testid="learning-verification">Verified by {proposal.verification.suiteId} · {proposal.verification.recordId}</small>}</div>}{proposal.status === 'proposed' && <div><button className="btn primary" onClick={async () => { await api.decideLearningProposal(proposal.id, 'approved'); refresh() }}>Approve new version</button><button className="btn" onClick={async () => { await api.decideLearningProposal(proposal.id, 'rejected'); refresh() }}>Reject</button></div>}</div> })}</div>
}

/* ================= Run Center ================= */
const STATUS_META: Record<string, { icon: string; cls: string }> = {
  running: { icon: '⏳', cls: 'running' }, paused: { icon: '⏸', cls: 'running' },
  done: { icon: '✓', cls: 'done' }, succeeded: { icon: '✓', cls: 'done' },
  failed: { icon: '✗', cls: 'failed' }, cancelled: { icon: '⏹', cls: 'failed' }, interrupted: { icon: '⚠', cls: 'failed' },
}
function RunCenter() {
  const [runs, setRuns] = useState<RunSum[]>([])
  const [sel, setSel] = useState<string>('')
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [evidence, setEvidence] = useState<RunEvidence | null>(null)
  const refresh = () => api.runs().then(setRuns)
  const loadRun = useCallback(async (id: string) => {
    const [nextDetail, nextEvidence] = await Promise.all([
      api.runDetail(id),
      api.runEvidence(id).catch(() => null),
    ])
    setDetail(nextDetail)
    setEvidence(nextEvidence)
  }, [])
  useEffect(() => { refresh(); const iv = setInterval(refresh, 3000); return () => clearInterval(iv) }, [])
  useEffect(() => { if (sel) void loadRun(sel); else { setDetail(null); setEvidence(null) } }, [sel, loadRun])
  useEffect(() => { if (sel && ['running', 'paused'].includes(detail?.status || '')) { const iv = setInterval(() => void loadRun(sel), 2500); return () => clearInterval(iv) } }, [sel, detail?.status, loadRun])

  const live = runs.filter(r => r.status === 'running' || r.status === 'paused')
  return (
    <div className="runcenter">
      <div className="runcenter-list">
        {live.length > 0 && <div className="section-title" style={{ marginTop: 0 }}>Running now</div>}
        {live.map(r => <RunRow key={r.id} r={r} active={sel === r.id} onClick={() => setSel(r.id)} onChange={refresh} live />)}
        <div className="section-title">History</div>
        {runs.filter(r => r.status !== 'running' && r.status !== 'paused').length === 0 && <div className="empty">No runs yet.</div>}
        {runs.filter(r => r.status !== 'running' && r.status !== 'paused').map(r => <RunRow key={r.id} r={r} active={sel === r.id} onClick={() => setSel(r.id)} onChange={refresh} />)}
      </div>
      <div className="runcenter-detail">
        {!detail ? <div className="empty">Select a run to see its transcript and outputs.</div> : (
          <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{detail.avatar}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{detail.title || detail.workflowName || detail.agentName}</div>
                <div className="meta" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{detail.task}</div>
              </div>
              <span className={`badge ${STATUS_META[detail.status]?.cls || ''} spacer`} style={{ marginLeft: 'auto' }}>{STATUS_META[detail.status]?.icon} {detail.status}</span>
            </div>
            {detail.result && <><div className="section-title">Result</div>
              <div className="msg ai" style={{ maxWidth: 'none' }} dangerouslySetInnerHTML={{ __html: marked.parse(detail.result.slice(0, 6000)) as string }} /></>}
            {detail.artifacts && detail.artifacts.length > 0 && <><div className="section-title">Files produced</div>
              <div className="rows">{detail.artifacts.map(a => (
                <a key={a.name} className="row" href={`/api/runs/${detail.id}/artifact?name=${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  <span>📄</span><span className="name">{a.name}</span><span className="meta spacer">{(a.size / 1024).toFixed(1)} KB</span>
                </a>))}</div></>}
            {evidence && <><div className="section-title">Verified evidence</div>
              <div className="card" data-testid="run-evidence" style={{ padding: 12, background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><b>Evidence receipt</b><code title={evidence.evidenceId}>{evidence.evidenceId.slice(0, 16)}…</code></div>
                <div className="meta" style={{ marginTop: 6 }}>Workflow {evidence.run.workflowVersion || 'unversioned'} · definition {evidence.run.workflowVersionHash || 'n/a'} · checkpoint r{evidence.checkpoint.revision ?? 0}</div>
                {evidence.triggerReceipt && <div className="meta">Trigger receipt {evidence.triggerReceipt.receiptRef}</div>}
                {!!evidence.approvals.length && <div className="meta">Approvals: {evidence.approvals.map(item => `${item.nodeId} ${item.state}`).join(' · ')}</div>}
                <div className="rows" style={{ marginTop: 8 }}>{Object.entries(evidence.checkpoint.nodes).map(([nodeId, node]) => <div className="row" key={nodeId}><span><b>{nodeId}</b><small>{node.state} · {node.attemptsStarted} attempt{node.attemptsStarted === 1 ? '' : 's'}{node.effect?.receiptRef ? ` · ${node.effect.receiptRef}` : ''}</small></span></div>)}</div>
              </div></>}
            <div className="section-title">Transcript</div>
            <div className="feed" style={{ flex: 1 }}>
              {(detail.events || []).map((e, i) => <div key={i} className={`ev-${e.type}`}>{e.text}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
function RunRow({ r, active, onClick, onChange, live }: { r: RunSum; active: boolean; onClick: () => void; onChange: () => void; live?: boolean }) {
  const m = STATUS_META[r.status] || { icon: '•', cls: '' }
  return (
    <div className={`run-row ${active ? 'active' : ''}`} data-run-id={r.id} onClick={onClick}>
      <span>{r.avatar}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="run-row-title">{r.title || r.agentName}</div>
        <div className="run-row-task">{r.task?.slice(0, 60) || '—'}</div>
      </div>
      {live ? (
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          {r.status === 'running' && r.type === 'workflow' && <button className="btn" title="Pause before next step" onClick={() => api.pauseRun(r.id).then(onChange)}>⏸</button>}
          {r.status === 'paused' && <button className="btn" title="Resume" onClick={() => api.resumeRun(r.id).then(onChange)}>▶</button>}
          <button className="btn danger" title="Cancel" onClick={() => api.stopRun(r.id).then(onChange)}>⏹</button>
        </div>
      ) : <span className={`badge ${m.cls}`}>{m.icon}</span>}
    </div>
  )
}

/* ================= Artifact Center ================= */
function ArtifactCenter() {
  const [arts, setArts] = useState<Artifact[]>([])
  const [view, setView] = useState<{ a: Artifact; text: string } | null>(null)
  useEffect(() => { api.artifacts().then(setArts).catch(() => {}) }, [])
  const open = async (a: Artifact) => {
    if (/\.(png|jpg|jpeg|webp|gif|pdf|zip|mp4)$/i.test(a.name)) { window.open(`/api/runs/${a.runId}/artifact?name=${encodeURIComponent(a.name)}`, '_blank'); return }
    try { setView({ a, text: await api.artifactText(a.runId, a.name) }) } catch { setView({ a, text: '(could not read)' }) }
  }
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16, fontSize: 14 }}>Everything your agents and workflows produced, newest first. Each file remembers which run made it.</p>
      {arts.length === 0 && <div className="empty">No results yet — run a workflow or an agent and outputs show up here.</div>}
      <div className="rows">
        {arts.map((a, i) => (
          <div className="row" key={i} style={{ cursor: 'pointer' }} onClick={() => open(a)}>
            <span>{/\.(png|jpg|jpeg|webp|gif)$/i.test(a.name) ? '🖼' : '📄'}</span>
            <div style={{ minWidth: 0 }}>
              <div className="name">{a.name}</div>
              <div className="meta">from {a.source} · {(a.size / 1024).toFixed(1)} KB</div>
            </div>
            <span className="meta spacer">open ›</span>
          </div>
        ))}
      </div>
      {view && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 760 }}>
            <h3>📄 {view.a.name}</h3>
            <div className="sub" style={{ marginBottom: 10 }}>from {view.a.source}</div>
            <pre style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, maxHeight: '60vh', overflow: 'auto', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{view.text.slice(0, 20000)}</pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
              <a className="btn" href={`/api/runs/${view.a.runId}/artifact?name=${encodeURIComponent(view.a.name)}`} target="_blank" rel="noreferrer">Open raw</a>
              <button className="btn" onClick={() => setView(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= Video Studio (LTXV) ================= */
function VideoStudio() {
  const [st, setSt] = useState<{ ready: boolean; downloadPct: number | null } | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [video, setVideo] = useState('')
  const [err, setErr] = useState('')
  const refresh = () => api.videoStatus().then(setSt).catch(() => {})
  useEffect(() => { refresh(); const iv = setInterval(refresh, 5000); return () => clearInterval(iv) }, [])

  const generate = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true); setErr(''); setVideo(''); setStatus('submitting…')
    try {
      const { promptId } = await api.generateVideo({ prompt })
      setStatus('rendering… (video is slow on Mac — a few minutes)')
      const t0 = Date.now()
      const poll = async (): Promise<void> => {
        const r = await api.studioResult(promptId)
        if (r.status === 'done' && r.images?.length) { setVideo(r.images[0]); setStatus(`done in ${Math.round((Date.now() - t0) / 1000)}s`); setBusy(false); return }
        if (r.status === 'failed') { setErr('Generation failed — see ComfyUI logs'); setBusy(false); return }
        setStatus(`rendering… ${Math.round((Date.now() - t0) / 1000)}s`); setTimeout(poll, 3000)
      }
      poll()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false); setStatus('') }
  }

  if (!st) return <div className="empty">Checking video engine…</div>
  if (!st.ready) return (
    <div className="card" style={{ marginTop: 4 }}>
      <h3>🎬 Video is getting ready</h3>
      <div className="sub" style={{ marginTop: 6, lineHeight: 1.6 }}>
        The local video model (LTX-Video) is downloading{st.downloadPct != null ? ` — ${st.downloadPct.toFixed(1)}%` : ''}. This is a one-time ~9&nbsp;GB download.
        <br /><br />Heads-up: video generation runs on Apple's GPU and is <b>much slower than images</b> — expect a few minutes per short clip. It'll light up here automatically when the model is ready.
      </div>
    </div>
  )
  return (<>
    {err && <div className="error-banner">{err}</div>}
    <label className="f">Describe the video
      <textarea rows={4} placeholder="e.g. a golden retriever running on a beach at sunset, cinematic" value={prompt} onChange={e => setPrompt(e.target.value)} />
    </label>
    <button className="btn primary" disabled={busy || !prompt.trim()} onClick={generate} style={{ width: '100%', padding: 12 }}>{busy ? `⏳ ${status}` : '🎬 Generate video'}</button>
    <div className="studio-hint">⏱ A few minutes per clip on Mac. Short clips (~4s) work best.</div>
    {video && <video src={video} controls autoPlay loop style={{ width: '100%', borderRadius: 10, marginTop: 12 }} />}
  </>)
}

/* ================= Skills Library ================= */
function Skills({ go }: { go: (p: Page) => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const refresh = () => api.skills().then(setSkills).catch(() => {})
  useEffect(() => { refresh() }, [])
  const create = async () => {
    const name = prompt('Skill name (e.g. write-a-blog-post):'); if (!name) return
    const slug = name.replace(/\.md$/, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
    await api.brainSave(`10-Skills/skill-${slug}.md`, `# ${name}\n\nWhen asked to ${name}:\n\n1. …\n2. …\n`)
    refresh(); go('brain')
  }
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16, fontSize: 14 }}>Skills are reusable playbooks — "how to do X" — that you can attach to any agent. They're plain files in your Agent Brain, so agents follow them automatically.</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><button className="btn primary" onClick={create}>＋ New skill</button></div>
      <div className="grid cols-2">
        {skills.length === 0 && <div className="empty">No skills yet — create one, or the AI Architect can propose them.</div>}
        {skills.map(s => (
          <div className="card" key={s.path}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>📘 {s.title}</div>
            <div className="sub" style={{ marginTop: 6 }}>{s.preview}…</div>
            <div style={{ marginTop: 10 }}><button className="btn" onClick={() => go('brain')}>Edit in Agent Rules</button></div>
          </div>
        ))}
      </div>
      <div className="sub" style={{ marginTop: 16 }}>Tip: attach skills to specific agents in the <b>Agents</b> page so only they use them.</div>
    </div>
  )
}

/* ================= Tools & MCP ================= */
function Tools() {
  const [data, setData] = useState<{ builtin: ToolInfo[]; mcp: ToolInfo[] }>({ builtin: [], mcp: [] })
  const [name, setName] = useState(''); const [cmd, setCmd] = useState(''); const [url, setUrl] = useState(''); const [authRef, setAuthRef] = useState('')
  const [secretReferences, setSecretReferences] = useState<import('./api').SecretReference[]>([])
  const [secretDraft, setSecretDraft] = useState({ id: '', label: '', value: '' }); const [secretError, setSecretError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = () => Promise.all([api.tools(), api.secretReferences()]).then(([tools, references]) => { setData(tools); setSecretReferences(references) }).catch(() => {})
  useEffect(() => { refresh() }, [])
  const add = async () => {
    if (!name.trim() || (!cmd.trim() && !url.trim())) return
    setBusy(true); try { await api.addMcp(name, cmd, url, url.trim() ? authRef : ''); setName(''); setCmd(''); setUrl(''); setAuthRef(''); refresh() } catch (e) { alert('' + e) } setBusy(false)
  }
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16, fontSize: 14 }}>Tools are the abilities your agents can use. Built-in ones are always on. Connect more via MCP (Model Context Protocol) servers — browsers, Gmail, databases, and more.</p>
      <div className="section-title" style={{ marginTop: 0 }}>Built-in — always available</div>
      <div className="grid cols-2">
        {data.builtin.map(t => (
          <div className="card" key={t.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="dot-s loaded" /><b>{t.name}</b><span className="badge done" style={{ marginLeft: 'auto' }}>connected</span></div>
            <div className="sub" style={{ marginTop: 6 }}>{t.desc}</div>
          </div>
        ))}
      </div>
      <div className="section-title">Keychain credential references</div>
      <p className="sub" style={{ marginBottom: 10 }}>HTTP and remote MCP tools can select an opaque credential name. Values stay in macOS Keychain and are resolved only for the outgoing call.</p>
      <div className="rows">{secretReferences.map(reference => <div className="row" key={reference.id}><span className={`dot-s ${reference.configured ? 'loaded' : 'disk'}`} /><div><div className="name">{reference.label}</div><div className="meta">{reference.id} · revision {reference.revision} · {reference.usedByCount} use(s)</div></div><button className="btn" style={{ marginLeft: 'auto' }} onClick={async () => { const value = prompt(`Enter a replacement value for ${reference.id}. It will be written directly to Keychain and cannot be shown again.`); if (!value) return; try { await api.rotateSecretReference(reference.id, reference.revision, value); setSecretError(''); await refresh() } catch (error) { setSecretError(String(error)) } }}>Rotate</button><button className="btn danger" disabled={reference.usedByCount > 0} onClick={async () => { if (!confirm(`Delete ${reference.id}?`)) return; try { await api.deleteSecretReference(reference.id, reference.revision); setSecretError(''); await refresh() } catch (error) { setSecretError(String(error)) } }}>Delete</button></div>)}</div>
      <div className="card" style={{ marginTop: 10 }}><b>Add Keychain reference</b><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}><input placeholder="stable id, e.g. research.api" value={secretDraft.id} onChange={e => setSecretDraft({ ...secretDraft, id: e.target.value })} /><input placeholder="display label" value={secretDraft.label} onChange={e => setSecretDraft({ ...secretDraft, label: e.target.value })} /></div><input type="password" autoComplete="new-password" placeholder="credential value (never shown again)" value={secretDraft.value} onChange={e => setSecretDraft({ ...secretDraft, value: e.target.value })} style={{ width: '100%', marginTop: 8 }} /><button className="btn primary" style={{ marginTop: 8 }} disabled={!secretDraft.id || !secretDraft.value} onClick={async () => { try { await api.createSecretReference(secretDraft.id, secretDraft.label, secretDraft.value); setSecretDraft({ id: '', label: '', value: '' }); setSecretError(''); await refresh() } catch (error) { setSecretError(String(error)) } }}>Store in Keychain</button>{secretError && <div className="error-text" style={{ marginTop: 8 }}>{secretError}</div>}</div>
      <div className="section-title">Connected MCP servers</div>
      {data.mcp.length === 0 && <div className="empty">No MCP servers yet — add one below.</div>}
      <div className="rows">
        {data.mcp.map(t => (
          <div className="row" key={t.key}>
            <span className={`dot-s ${t.status === 'configured' ? 'loaded' : ''}`} /><div><div className="name">{t.name} <span className={`badge ${t.status === 'configured' ? 'done' : 'warn'}`}>{t.status}</span></div><div className="meta">{t.desc}{t.authReference ? ` · bearer credential: ${t.authReference.id}` : ''}</div></div>
            {t.reviewStatus === 'required' && <button className="btn" style={{ marginLeft: 'auto' }} onClick={async () => { if (!confirm(`Trust and enable local MCP server “${t.name}”? Review its launch command first.\n\n${t.desc}`)) return; await api.reviewMcp(t.key, true); refresh() }}>Review & enable</button>}
            <button className="btn danger spacer" style={t.reviewStatus === 'required' ? undefined : { marginLeft: 'auto' }} onClick={async () => { await api.delMcp(t.key); refresh() }}>Remove</button>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Add an MCP server</h3>
        <div className="sub" style={{ marginBottom: 12 }}>Use a stable ID and either a launch command (local server) or a URL (remote). New local commands stay disabled until you review and trust them. The server itself must already be installed or reachable.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
          <label className="f">Stable ID<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. filesystem" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></label>
          <label className="f">Launch command <span style={{ color: 'var(--ink-3)' }}>(local)</span><input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem /path" /></label>
        </div>
        <label className="f" style={{ marginBottom: 12 }}>…or a remote URL<input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
        {url.trim() && <label className="f" style={{ marginBottom: 12 }}>Bearer credential reference<select value={authRef} onChange={e => setAuthRef(e.target.value)}><option value="">No authentication</option>{secretReferences.map(reference => <option key={reference.id} value={reference.id} disabled={!reference.configured}>{reference.label} · {reference.id}{reference.configured ? '' : ' (missing)'}</option>)}</select></label>}
        <button className="btn primary" disabled={busy || !name.trim() || (!cmd.trim() && !url.trim())} onClick={add}>{busy ? '…' : cmd.trim() ? '＋ Add for review' : '＋ Connect'}</button>
      </div>
    </div>
  )
}

/* ================= Knowledge (RAG) ================= */
function Knowledge() {
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const refresh = () => api.knowledge().then(setSources).catch(() => {})
  useEffect(() => { refresh() }, [])

  const addText = async () => {
    if (!name.trim() || !text.trim()) return
    setBusy(true); setErr('')
    try { await api.addKnowledge({ name, text }); setName(''); setText(''); refresh() }
    catch (e) { setErr(String(e)) }
    setBusy(false)
  }
  const addFile = async (f: File) => {
    setBusy(true); setErr('')
    try {
      if (/\.pdf$/i.test(f.name)) {
        const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]); r.onerror = rej; r.readAsDataURL(f) })
        await api.addKnowledge({ name: f.name, pdfBase64: b64 })
      } else {
        const t = await f.text()
        await api.addKnowledge({ name: f.name, text: t })
      }
      refresh()
    } catch (e) { setErr('Could not add file: ' + e) }
    setBusy(false)
  }
  const search = async () => {
    if (!query.trim()) return
    setSearching(true); setHits(null)
    try { setHits(await api.searchKnowledge(query, 5)) } catch (e) { setErr(String(e)) }
    setSearching(false)
  }

  return (
    <div>
      <p className="sub" style={{ marginBottom: 16, fontSize: 14 }}>Give your agents documents to draw on. They stay 100% local — nothing is uploaded anywhere. Add a Search node in a workflow to have agents cite them.</p>
      {err && <div className="error-banner">{err}</div>}
      <div className="grid cols-2">
        <div className="card">
          <h3>Add knowledge</h3>
          <label className="f" style={{ marginBottom: 8 }}>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Product Docs" /></label>
          <label className="f" style={{ marginBottom: 8 }}>Paste text<textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="Paste any notes, docs, facts…" /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={busy || !name.trim() || !text.trim()} onClick={addText}>{busy ? '⏳ Indexing…' : '＋ Add text'}</button>
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>📄 Upload file (txt, md, pdf…)</button>
            <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.html,.csv,.json,.pdf,text/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) addFile(f); e.target.value = '' }} />
          </div>
        </div>
        <div className="card">
          <h3>Test search</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input style={{ flex: 1 }} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Ask something your docs would answer…" />
            <button className="btn primary" disabled={searching || !query.trim()} onClick={search}>{searching ? '⏳' : '🔎 Search'}</button>
          </div>
          {hits && hits.length === 0 && <div className="empty">No matches. Add some knowledge first.</div>}
          {hits && hits.map((h, i) => (
            <div key={i} className="know-hit">
              <div className="know-hit-meta">{(h.score * 100).toFixed(0)}% match · {h.source}</div>
              <div className="know-hit-text">{h.text.slice(0, 260)}{h.text.length > 260 ? '…' : ''}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">Your knowledge ({sources.length})</div>
      <div className="rows">
        {sources.length === 0 && <div className="empty">Nothing yet — add a document above.</div>}
        {sources.map(s => (
          <div className="row" key={s.id}>
            <span>{s.type === 'pdf' ? '📕' : '📄'}</span>
            <div><div className="name">{s.name}</div><div className="meta">{s.chunks} passages · {s.type}</div></div>
            <button className="btn danger spacer" style={{ marginLeft: 'auto' }} onClick={async () => { await api.delKnowledge(s.id); refresh() }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================= Onboarding (first run) ================= */
function Onboarding({ onDone }: { onDone: (mode: Mode | null, page: Page | null) => void }) {
  const [step, setStep] = useState(0)
  const useCases = [
    { icon: '📝', t: 'Write & research documents', page: 'templates' as Page },
    { icon: '💻', t: 'Build software', page: 'templates' as Page },
    { icon: '🖼', t: 'Generate images', page: 'studio' as Page },
    { icon: '🤖', t: 'Automate work with agent teams', page: 'pipelines' as Page },
  ]
  const modes: { m: Mode; t: string; d: string }[] = [
    { m: 'easy', t: 'Easy', d: 'Just describe it and run. No settings.' },
    { m: 'guided', t: 'Guided', d: 'The AI helps you build, step by step.' },
    { m: 'pro', t: 'Pro', d: 'Full canvas and controls.' },
  ]
  const [pick, setPick] = useState<Page | null>(null)
  return (
    <div className="modal-backdrop">
      <div className="modal onboard" onClick={e => e.stopPropagation()} style={{ width: 560 }}>
        {step === 0 && <>
          <h3>👋 Welcome to your AI Command Center</h3>
          <p className="sub" style={{ margin: '8px 0 18px' }}>A local AI workspace — your own team of AI agents that research, write, code, and create, running privately on this Mac. Two quick questions and you're in.</p>
          <div className="onboard-grid">
            {useCases.map(u => <button key={u.t} className={`onboard-opt ${pick === u.page ? 'on' : ''}`} onClick={() => setPick(u.page)}><span>{u.icon}</span>{u.t}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button className="btn primary" onClick={() => setStep(1)}>Next</button>
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => onDone(null, null)}>Skip</button>
          </div>
        </>}
        {step === 1 && <>
          <h3>How much detail do you want to see?</h3>
          <p className="sub" style={{ margin: '8px 0 16px' }}>You can change this any time with the switch at the top — it only changes what's shown, never what your workflows do.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {modes.map(x => (
              <button key={x.m} className="onboard-mode" onClick={() => onDone(x.m, pick)}>
                <b>{x.t}</b><span>{x.d}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}><button className="btn" onClick={() => setStep(0)}>← Back</button></div>
        </>}
      </div>
    </div>
  )
}

function ModeSelector({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="mode-seg" role="tablist" aria-label="Complexity mode" title="Interface complexity — changes what's shown, never what your workflows do">
      {MODES.map(m => (
        <button key={m.key} role="tab" aria-selected={mode === m.key} className={`mode-opt ${mode === m.key ? 'on' : ''}`} onClick={() => onChange(m.key)} title={m.hint}>
          {m.label}
        </button>
      ))}
    </div>
  )
}

/* ================= Home / AI Overview ================= */
function Home({ sys, go }: { sys: SystemInfo | null; go: (p: Page) => void }) {
  const mode = useMode()
  const [cmd, setCmd] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [wfs, setWfs] = useState<WfSummary[]>([])
  useEffect(() => { api.agents().then(setAgents).catch(() => {}); api.workflows().then(setWfs).catch(() => {}) }, [])

  const svc = sys?.services
  const online = [svc?.lmstudio && 'LM Studio', svc?.opencode && 'OpenCode', svc?.comfy && 'ComfyUI'].filter(Boolean)
  const problems: string[] = []
  if (svc && !svc.lmstudio) problems.push('LM Studio is offline — Chat and Agents need it. Open the LM Studio app.')
  if (svc && !svc.comfy) problems.push('ComfyUI is offline — the Images studio needs it.')
  if (sys && sys.loaded.length === 0) problems.push('No model is loaded yet — load one on the Models page, or just run something and it loads automatically.')

  const starters = [
    { icon: '📝', title: 'Write & fact-check an article', go: () => go('pipelines') },
    { icon: '🔎', title: 'Research a topic', go: () => go('pipelines') },
    { icon: '🖼', title: 'Generate an image', go: () => go('studio') },
    { icon: '🤖', title: 'Build an agent team', go: () => go('agents') },
  ]

  return (
    <div className="home">
      <div className="home-hero">
        <h2>What would you like your AI company to do?</h2>
        <div className="home-cmd">
          <input placeholder="Describe a goal… e.g. research electric cars and write a buyer's guide" value={cmd}
            onChange={e => setCmd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && cmd.trim()) { sessionStorage.setItem('cc-goal', cmd); go('pipelines') } }} />
          <button className="btn primary ai-build" disabled={!cmd.trim()} onClick={() => { sessionStorage.setItem('cc-goal', cmd); go('pipelines') }}>✨ Design it</button>
        </div>
        <div className="home-starters">
          {starters.map(s => <button key={s.title} className="starter" onClick={s.go}><span>{s.icon}</span> {s.title}</button>)}
        </div>
      </div>

      {problems.length > 0 && (
        <div className="home-attention">
          <div className="home-attention-title">⚠ Needs attention</div>
          {problems.map((p, i) => <div key={i} className="home-attention-row">{p}</div>)}
        </div>
      )}

      <div className="grid cols-4" style={{ marginTop: 18 }}>
        <button className="card home-stat" onClick={() => go('dashboard')}>
          <h3>Services online</h3>
          <div className="stat">{online.length}<small>/ 3</small></div>
          <div className="sub">{online.join(' · ') || 'starting…'}</div>
        </button>
        <button className="card home-stat" onClick={() => go('models')}>
          <h3>Models ready</h3>
          <div className="stat">{sys?.modelCount ?? '–'}</div>
          <div className="sub">{sys?.loaded.length ? `${sys.loaded.length} loaded now` : 'none loaded'}</div>
        </button>
        <button className="card home-stat" onClick={() => go('agents')}>
          <h3>Your team</h3>
          <div className="stat">{agents.length}</div>
          <div className="sub">{agents.slice(0, 3).map(a => a.avatar).join(' ')} agents ready</div>
        </button>
        <button className="card home-stat" onClick={() => go('pipelines')}>
          <h3>Workflows</h3>
          <div className="stat">{wfs.length}</div>
          <div className="sub">ready to run</div>
        </button>
      </div>

      <AtLeast mode="pro">
        <div className="section-title">Recent workflows</div>
        <div className="rows">
          {wfs.map(w => (
            <button className="row" key={w.id} onClick={() => go('pipelines')} style={{ cursor: 'pointer', textAlign: 'left' }}>
              <span>⛓</span><span className="name">{w.name}</span><span className="meta spacer">{w.nodes} nodes</span>
            </button>
          ))}
        </div>
      </AtLeast>

      <div className="home-mode-note sub" style={{ marginTop: 20 }}>
        You're in <b>{MODES.find(m => m.key === mode)?.label}</b> mode — {MODES.find(m => m.key === mode)?.hint} Change it any time with the switch up top; it only changes what you see, never what your workflows do.
      </div>
    </div>
  )
}

/* ================= Workflow Studio ================= */
// icon + connectable + plain-language "what this does" (shown in Easy/Guided; tooltip everywhere)
const NTYPE_META: Record<string, { icon: string; canIn: boolean; canOut: boolean; plain: string }> = {
  input: { icon: '⬗', canIn: false, canOut: true, plain: 'The information you give the workflow to start' },
  agent: { icon: '🤖', canIn: true, canOut: true, plain: 'One team member does a task' },
  orchestrator: { icon: '🧭', canIn: true, canOut: true, plain: 'A lead figures out the steps and delegates' },
  critic: { icon: '🔁', canIn: true, canOut: true, plain: 'Review and improve until it’s approved' },
  parallel: { icon: '⑂', canIn: true, canOut: true, plain: 'Several models try, then the best is picked' },
  search: { icon: '🔎', canIn: true, canOut: true, plain: 'Find relevant info from your uploaded documents' },
  check: { icon: '✅', canIn: true, canOut: true, plain: 'Check the result meets requirements (no AI needed)' },
  output: { icon: '⬛', canIn: true, canOut: false, plain: 'The final result you get back' },
}
const shortModel = (m?: string) => (m || '').replace(/^lmstudio\//, '').split('/').pop() || m || ''

function CCNode({ data }: { data: any }) {
  const meta = NTYPE_META[data.ntype] || NTYPE_META.agent
  const mode = useMode()
  const showPlain = mode === 'easy' || mode === 'guided'
  return (
    <div className={`wf-node t-${data.ntype} ${data.status ? 's-' + data.status : ''}`} title={meta.plain}>
      {meta.canIn && <Handle type="target" position={Position.Left} />}
      <div className="wf-node-title">{meta.icon} {data.label || data.ntype}</div>
      {showPlain && <div className="wf-node-plain">{meta.plain}</div>}
      {data.ntype === 'agent' || data.ntype === 'orchestrator'
        ? <div className="wf-node-model">{data.model ? (/^lmstudio/.test(data.model) ? '💻 ' : '☁️ ') + shortModel(data.model) : 'no model'}</div>
        : null}
      {data.status && <div className="wf-node-status">{data.status}</div>}
      {meta.canOut && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
const nodeTypes = { cc: CCNode }

// deterministic depth-based auto-layout (mirrors the server)
function autoLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const incoming: Record<string, string[]> = {}
  for (const e of edges) (incoming[e.target] = incoming[e.target] || []).push(e.source)
  const depth: Record<string, number> = {}
  const calc = (id: string, seen = new Set<string>()): number => {
    if (depth[id] != null) return depth[id]
    if (seen.has(id)) return 0
    seen.add(id)
    const ins = incoming[id] || []
    depth[id] = ins.length ? Math.max(...ins.map(s => calc(s, seen))) + 1 : 0
    return depth[id]
  }
  nodes.forEach(n => calc(n.id))
  const perDepth: Record<number, number> = {}
  return nodes.map(n => {
    const d = depth[n.id] || 0
    const y = 40 + (perDepth[d] = (perDepth[d] ?? -1) + 1) * 150
    return { ...n, position: { x: 40 + d * 250, y } }
  })
}

// backend node <-> React Flow node
const toRF = (n: any): Node => ({ id: n.id, type: 'cc', position: n.position || { x: 0, y: 0 }, data: { ntype: n.type, ...(n.data || {}) } })
const fromRF = (n: Node): any => { const { ntype, status, ...rest } = n.data as any; return { id: n.id, type: ntype, position: n.position, data: rest } }

function WorkflowStudio() {
  const [list, setList] = useState<WfSummary[]>([])
  const [wfId, setWfId] = useState('')
  const [wfName, setWfName] = useState('')
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [sel, setSel] = useState<string>('')
  const [models, setModels] = useState<AllModel[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<(RunEvent & { nodeId?: string })[]>([])
  const [showProviders, setShowProviders] = useState(false)
  const [showProfiles, setShowProfiles] = useState(false)
  const [showAiBuild, setShowAiBuild] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileId, setProfileId] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [rf, setRf] = useState<any>(null)
  const [tab, setTab] = useState<'basic' | 'advanced' | 'permissions' | 'testing'>('basic')
  const [past, setPast] = useState<{ nodes: Node[]; edges: Edge[] }[]>([])
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[] }[]>([])
  const snapshot = () => { setPast(p => [...p.slice(-40), { nodes, edges }]); setFuture([]) }
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setFuture(f => [{ nodes, edges }, ...f]); setPast(p => p.slice(0, -1)); setNodes(prev.nodes); setEdges(prev.edges) }
  const redo = () => { if (!future.length) return; const next = future[0]; setPast(p => [...p, { nodes, edges }]); setFuture(f => f.slice(1)); setNodes(next.nodes); setEdges(next.edges) }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        const t = e.target as HTMLElement
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return // don't hijack text editing
        e.preventDefault(); e.shiftKey ? redo() : undo()
      }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })
  const [showArch, setShowArch] = useState(false)
  const [archUndo, setArchUndo] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null)

  const refreshList = () => api.workflows().then(setList)
  const refreshModels = () => api.allModels().then(setModels).catch(() => {})
  const refreshProfiles = () => api.profilesGet().then(r => setProfiles(r.profiles)).catch(() => {})
  useEffect(() => { refreshList(); refreshModels(); refreshProfiles() }, [])
  // goal handed off from the Home command box → open AI Build prefilled
  useEffect(() => { if (sessionStorage.getItem('cc-goal')) setShowAiBuild(true) }, [])
  // a template instantiated from the Template Center → open it
  useEffect(() => { const id = sessionStorage.getItem('cc-open-wf'); if (id) { sessionStorage.removeItem('cc-open-wf'); load(id) } }, [])
  useEffect(() => { if (!wfId && list[0]) load(list[0].id) }, [list])
  useEffect(() => { feedRef.current?.scrollTo(0, 1e9) }, [events])

  const load = async (id: string) => {
    const w = await api.workflow(id)
    setWfId(w.id); setWfName(w.name)
    setNodes(w.nodes.map(toRF)); setEdges(w.edges.map(e => ({ ...e })) as Edge[]); setSel('')
  }
  const onConnect = useCallback((c: Connection) => { snapshot(); setEdges(eds => addEdge({ ...c, id: `e${Date.now()}` }, eds)) }, [setEdges, nodes, edges])

  const addNode = (ntype: string) => {
    snapshot()
    const id = ntype + '-' + Math.random().toString(36).slice(2, 6)
    const firstModel = 'policy:balanced' // beginner-friendly default — resolves automatically
    const data: any = { label: ntype[0].toUpperCase() + ntype.slice(1) }
    if (ntype === 'agent' || ntype === 'orchestrator') { data.model = firstModel; data.instruction = '{{input}}' }
    if (ntype === 'critic') { data.model = firstModel; data.reviewerModel = firstModel; data.maxIters = 2; data.instruction = '{{input}}' }
    if (ntype === 'parallel') { data.models = [firstModel]; data.judgeModel = firstModel; data.instruction = '{{input}}' }
    if (ntype === 'search') { data.label = 'Find info'; data.instruction = '{{input}}'; data.k = 4 }
    if (ntype === 'check') { data.label = 'Quality check'; data.checks = { minLength: 50 } }
    setNodes(ns => [...ns, toRF({ id, type: ntype, position: { x: 120 + Math.random() * 200, y: 100 + Math.random() * 160 }, data })])
  }

  const aiBuild = async (goal: string, model: string) => {
    setGenBusy(true)
    try {
      const w = await api.generateWorkflow(goal, model || undefined)
      setWfId(''); setWfName(w.name)
      setNodes(w.nodes.map(toRF)); setEdges(w.edges.map(e => ({ ...e })) as Edge[]); setSel('')
      setShowAiBuild(false)
    } catch (e) { alert('AI build failed: ' + e) }
    setGenBusy(false)
  }
  const doImport = async (file: File) => {
    try {
      const bundle = JSON.parse(await file.text()), staged = await api.bundleImport(bundle)
      const approved = confirm(`Review imported package before installation.\n\nContents: ${JSON.stringify(staged.summary)}\n\nRisks:\n- ${(staged.risks || []).join('\n- ') || 'No executable capability detected'}\n\nInstall with safe default permissions?`)
      if (!approved) { await api.decideBundleImport(staged.proposalId, 'reject'); return }
      try { const installed = await api.decideBundleImport(staged.proposalId, 'approve'); alert('Installed: ' + JSON.stringify(installed.summary)) }
      catch (error) { if (String(error).includes('overwrite') && confirm(`${error}\n\nOverwrite these existing items?`)) { const installed = await api.decideBundleImport(staged.proposalId, 'approve', true); alert('Installed with explicit overwrite: ' + JSON.stringify(installed.summary)) } else throw error }
      refreshList(); refreshProfiles()
    }
    catch (e) { alert('Import failed: ' + e) }
  }
  const patchSel = (patch: any) => setNodes(ns => ns.map(n => n.id === sel ? { ...n, data: { ...n.data, ...patch } } : n))
  const delSel = () => { snapshot(); setNodes(ns => ns.filter(n => n.id !== sel)); setEdges(es => es.filter(e => e.source !== sel && e.target !== sel)); setSel('') }

  const save = async () => {
    const w: Workflow = { id: wfId, name: wfName, nodes: nodes.map(fromRF), edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })) }
    const saved = await api.saveWorkflow(w); setWfId(saved.id); refreshList()
  }
  const newWf = async () => {
    const name = prompt('New workflow name:'); if (!name) return
    const w: Workflow = { id: '', name, nodes: [toRF({ id: 'in', type: 'input', position: { x: 60, y: 140 }, data: { label: 'Input' } }) as any, toRF({ id: 'out', type: 'output', position: { x: 520, y: 140 }, data: { label: 'Output' } }) as any].map(fromRF), edges: [] }
    const saved = await api.saveWorkflow(w); await refreshList(); load(saved.id)
  }

  const setNodeStatus = (nodeId: string, status: string) =>
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status } } : n))

  const [showPreflight, setShowPreflight] = useState(false)
  const [activeRunId, setActiveRunId] = useState('')
  const run = async (safe = false) => {
    await save()
    setShowPreflight(false)
    setEvents([]); setRunning(true)
    setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, status: '' } })))
    const { runId } = await api.runWorkflow(wfId, input, profileId || undefined, safe)
    setActiveRunId(runId)
    subscribeWfRun(runId, ev => {
      setEvents(prev => [...prev, ev])
      if (ev.nodeId) setNodeStatus(ev.nodeId, ev.type === 'done' ? 'done' : ev.type === 'error' ? 'failed' : 'running')
    }, () => setRunning(false))
  }
  // preflight: real, computable readiness checks
  const preflight = (): { level: 'error' | 'warn' | 'ok'; text: string; fix?: () => void }[] => {
    const issues: { level: 'error' | 'warn' | 'ok'; text: string; fix?: () => void }[] = []
    const ns = nodes.map(fromRF)
    const firstLocal = models.find(m => m.kind === 'local')?.ref || models[0]?.ref
    if (!ns.some(n => n.type === 'input')) issues.push({ level: 'error', text: 'No starting Input node.' })
    if (!ns.some(n => n.type === 'output')) issues.push({ level: 'error', text: 'No Output node to collect the result.' })
    const agentish = ns.filter(n => ['agent', 'orchestrator', 'critic', 'parallel'].includes(n.type))
    if (!agentish.length) issues.push({ level: 'warn', text: 'No team members (agent nodes) — the workflow will just pass input to output.' })
    for (const n of agentish) {
      const m = n.data.model
      if (!m) issues.push({ level: 'error', text: `"${n.data.label || n.id}" has no model set.`, fix: firstLocal ? () => patchNodeById(n.id, { model: firstLocal }) : undefined })
      else if (String(m).startsWith('policy:')) { /* auto policy — always resolvable, no issue */ }
      else if (String(m).startsWith('role:') && !profileId) issues.push({ level: 'warn', text: `"${n.data.label || n.id}" uses a role — pick a Tier below or it defaults.` })
      else if (m && !String(m).startsWith('role:') && !models.some(x => x.ref === m)) {
        if (String(m).startsWith('lmstudio/')) issues.push({ level: 'error', text: `"${n.data.label || n.id}" uses a model that isn't installed.`, fix: firstLocal ? () => patchNodeById(n.id, { model: firstLocal }) : undefined })
        else issues.push({ level: 'error', text: `"${n.data.label || n.id}" uses a cloud model but no API key is set. Add one under Providers.` })
      }
    }
    // unreachable nodes (no path from input via edges, excluding input itself)
    const adj: Record<string, string[]> = {}; for (const e of edges) (adj[e.source] = adj[e.source] || []).push(e.target)
    const seen = new Set<string>(); const stack = ns.filter(n => n.type === 'input').map(n => n.id)
    while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); for (const t of adj[id] || []) stack.push(t) }
    for (const n of ns) if (n.type !== 'input' && !seen.has(n.id)) issues.push({ level: 'warn', text: `"${n.data.label || n.id}" isn't connected to the flow — it won't run.` })
    return issues.length ? issues : [{ level: 'ok', text: 'Everything looks ready.' }]
  }
  const patchNodeById = (id: string, patch: any) => setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))

  const doAutoLayout = () => { setNodes(ns => autoLayoutNodes(ns, edges)); setTimeout(() => rf?.fitView({ padding: 0.2, duration: 400 }), 60) }
  const fit = () => rf?.fitView({ padding: 0.2, duration: 300 })
  const currentWf = (): Workflow => ({ id: wfId, name: wfName, nodes: nodes.map(fromRF), edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })) })
  const applyProposal = (w: Workflow) => {
    setArchUndo({ nodes, edges })
    setNodes(w.nodes.map(toRF)); setEdges(w.edges.map(e => ({ ...e })) as Edge[]); setSel('')
    setTimeout(() => rf?.fitView({ padding: 0.2, duration: 400 }), 60)
  }
  const undoArch = () => { if (archUndo) { setNodes(archUndo.nodes); setEdges(archUndo.edges); setArchUndo(null) } }

  const selNode = nodes.find(n => n.id === sel)
  const selData = selNode?.data as any
  const mode = useMode()
  const isAgentish = selData && ['agent', 'orchestrator', 'critic', 'parallel'].includes(selData.ntype)

  return (
    <div className="wf">
      <div className="wf-top">
        <select value={wfId} onChange={e => load(e.target.value)}>
          {list.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className="wf-name" value={wfName} onChange={e => setWfName(e.target.value)} />
        <button className="btn" onClick={newWf}>+ New</button>
        <button className="btn ai-build" disabled={genBusy} onClick={() => setShowAiBuild(true)}>{genBusy ? '⏳ Designing…' : '✨ AI Build'}</button>
        <button className={`btn ${showArch ? 'primary' : ''}`} onClick={() => setShowArch(v => !v)}>🧭 AI Architect</button>
        <button className="btn primary" onClick={save}>💾 Save</button>
        <div className="spacer" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowProfiles(true)}>🎚 Tiers</button>
          <button className="btn" onClick={() => setShowProviders(true)}>☁️ Providers</button>
          <a className="btn" href="/api/bundle/export" download style={{ textDecoration: 'none' }}>⬇ Export</a>
          <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
        </div>
      </div>

      <div className="wf-body">
        <div className="wf-palette">
          <div className="wf-palette-title">Add node</div>
          {Object.keys(NTYPE_META).map(t => (
            <button key={t} className="wf-pal-btn" onClick={() => addNode(t)}>{NTYPE_META[t].icon} {t}</button>
          ))}
          {selNode && (
            <div className="wf-inspect">
              <div className="wf-inspect-head">
                <span>{NTYPE_META[selData.ntype]?.icon} {selData.label || selData.ntype}</span>
              </div>
              <div className="wf-plain-hint">{NTYPE_META[selData.ntype]?.plain}</div>

              {/* tabs appear from Pro up; Easy/Guided see only the essentials */}
              {mode !== 'easy' && mode !== 'guided' && (
                <div className="wf-tabs">
                  <button className={tab === 'basic' ? 'on' : ''} onClick={() => setTab('basic')}>Basic</button>
                  {isAgentish && <button className={tab === 'advanced' ? 'on' : ''} onClick={() => setTab('advanced')}>Advanced</button>}
                  {isAgentish && <button className={tab === 'permissions' ? 'on' : ''} onClick={() => setTab('permissions')}>Permissions</button>}
                  {isAgentish && <button className={tab === 'testing' ? 'on' : ''} onClick={() => setTab('testing')}>Test</button>}
                </div>
              )}
              {(mode === 'easy' || mode === 'guided' || tab === 'basic') && <>
                <label className="f">Name<input value={selData.label || ''} onChange={e => patchSel({ label: e.target.value })} /></label>
                {(selData.ntype === 'agent' || selData.ntype === 'orchestrator') &&
                  <ModelSelect models={models} label={mode === 'easy' ? 'Which brain?' : 'Model'} value={selData.model} onChange={v => patchSel({ model: v })} />}
                {selData.ntype === 'critic' &&
                  <ModelSelect models={models} label="Worker model" value={selData.model} onChange={v => patchSel({ model: v })} />}
                {isAgentish &&
                  <label className="f">{mode === 'easy' ? 'What should it do?' : 'Instruction'} {mode !== 'easy' && <span style={{ color: 'var(--ink-3)' }}>use {'{{input}}'} / {'{{nodeId}}'}</span>}
                    <textarea rows={4} value={selData.instruction || ''} onChange={e => patchSel({ instruction: e.target.value })} />
                  </label>}
                {selData.ntype === 'search' && <>
                  <label className="f">Search query <span style={{ color: 'var(--ink-3)' }}>use {'{{input}}'} / {'{{nodeId}}'}</span>
                    <textarea rows={3} value={selData.instruction || ''} onChange={e => patchSel({ instruction: e.target.value })} />
                  </label>
                  <label className="f">How many passages to pull
                    <input type="number" min={1} max={10} value={selData.k || 4} onChange={e => patchSel({ k: +e.target.value })} />
                  </label>
                </>}
                {selData.ntype === 'check' && <>
                  <label className="f">Must mention (comma-separated, optional)
                    <input value={selData.checks?.contains || ''} onChange={e => patchSel({ checks: { ...selData.checks, contains: e.target.value } })} placeholder="e.g. price, warranty" />
                  </label>
                  <label className="f">Minimum length (characters)
                    <input type="number" min={0} value={selData.checks?.minLength || 0} onChange={e => patchSel({ checks: { ...selData.checks, minLength: +e.target.value } })} />
                  </label>
                  <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={!!selData.checks?.isJson} onChange={e => patchSel({ checks: { ...selData.checks, isJson: e.target.checked } })} />
                    Must be valid JSON
                  </label>
                </>}
              </>}

              {mode !== 'easy' && mode !== 'guided' && tab === 'advanced' && isAgentish && <>
                {selData.ntype === 'critic' && <>
                  <ModelSelect models={models} label="Reviewer model" value={selData.reviewerModel} onChange={v => patchSel({ reviewerModel: v })} />
                  <label className="f">Max review rounds
                    <input type="number" min={1} max={5} value={selData.maxIters || 2} onChange={e => patchSel({ maxIters: +e.target.value })} />
                  </label>
                </>}
                {selData.ntype === 'parallel' && <>
                  <label className="f">Worker models (each runs, judge merges)</label>
                  {(selData.models || []).map((m: string, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <ModelSelect models={models} value={m} onChange={v => patchSel({ models: (selData.models || []).map((x: string, j: number) => j === i ? v : x) })} inline />
                      <button className="btn" onClick={() => patchSel({ models: (selData.models || []).filter((_: string, j: number) => j !== i) })}>×</button>
                    </div>
                  ))}
                  <button className="btn" onClick={() => patchSel({ models: [...(selData.models || []), models[0]?.ref || ''] })}>+ add model</button>
                  <ModelSelect models={models} label="Judge model" value={selData.judgeModel} onChange={v => patchSel({ judgeModel: v })} />
                </>}
                {(selData.ntype === 'agent' || selData.ntype === 'orchestrator') && <div className="sub">No extra settings for this node type yet — retries, timeouts and caching arrive with the durable engine (see roadmap).</div>}
              </>}

              {tab === 'permissions' && isAgentish && mode !== 'easy' && mode !== 'guided' && (
                <div className="perm-summary">
                  <div className="perm-line good">✔ Can read & write files in its working folder</div>
                  <div className="perm-line good">✔ Can run shell commands and use tools (via OpenCode)</div>
                  <div className="perm-line warn">● Currently runs with FULL access (your machine setting)</div>
                  <div className="sub" style={{ marginTop: 8 }}>Per-node scoped permissions (read-only, no-shell, folder limits) are on the roadmap. For now permissions are set globally.</div>
                </div>
              )}

              {tab === 'testing' && isAgentish && mode !== 'easy' && mode !== 'guided' &&
                <NodeTester model={selData.model || models[0]?.ref} instruction={selData.instruction} input={input} />}

              <button className="btn danger" style={{ marginTop: 12 }} onClick={delSel}>Delete node</button>
            </div>
          )}
        </div>

        <div className="wf-canvas">
          <div className="wf-canvas-toolbar">
            <button className="btn" title="Undo (⌘Z)" disabled={!past.length} onClick={undo}>↶</button>
            <button className="btn" title="Redo (⌘⇧Z)" disabled={!future.length} onClick={redo}>↷</button>
            <button className="btn" title="Tidy up the layout automatically" onClick={doAutoLayout}>⌗ Auto-layout</button>
            <button className="btn" title="Fit everything in view" onClick={fit}>⊡ Fit</button>
          </div>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} nodeTypes={nodeTypes} onNodeClick={(_e, n) => setSel(n.id)} onInit={setRf}
            fitView proOptions={{ hideAttribution: true }} colorMode="dark" snapToGrid snapGrid={[16, 16]}>
            <Background color="#232c38" gap={18} />
            <Controls />
            <AtLeast mode="pro"><MiniMap pannable zoomable nodeColor="#1b232e" maskColor="rgba(9,12,17,0.7)" /></AtLeast>
          </ReactFlow>
        </div>
      </div>

      <div className="wf-run">
        <input className="wf-run-input" placeholder="Workflow input (e.g. a topic, a task)…" value={input}
          onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !running && setShowPreflight(true)} />
        <select value={profileId} onChange={e => setProfileId(e.target.value)} title="Tier profile — resolves role: models">
          <option value="">No tier (use node models)</option>
          {profiles.map(p => <option key={p.id} value={p.id}>🎚 {p.name}</option>)}
        </select>
        <button className="btn primary" disabled={running || !wfId} onClick={() => setShowPreflight(true)}>{running ? '⏳ Running…' : '▶ Run'}</button>
      </div>
      {(events.length > 0 || running) && (
        <RunView events={events} nodes={nodes} running={running} feedRef={feedRef} runId={activeRunId}
          onRetry={() => setShowPreflight(true)} onArchitect={() => setShowArch(true)} />
      )}

      {showProviders && <ProvidersModal onClose={() => { setShowProviders(false); refreshModels() }} />}
      {showProfiles && <ProfilesModal models={models} onClose={() => { setShowProfiles(false); refreshProfiles() }} />}
      {showAiBuild && <AiBuildModal models={models} busy={genBusy} onBuild={aiBuild} onClose={() => setShowAiBuild(false)} />}
      {showArch && <ArchitectPanel getWf={currentWf} models={models} selectedId={sel} onApply={applyProposal}
        canUndo={!!archUndo} onUndo={undoArch} onClose={() => setShowArch(false)} />}
      {showPreflight && <PreflightModal issues={preflight()} allLocal={nodes.map(fromRF).every(n => !n.data.model || String(n.data.model).startsWith('lmstudio/') || String(n.data.model).startsWith('role:'))}
        onRun={() => run(false)} onSafe={() => run(true)} onArchitect={() => { setShowPreflight(false); setShowArch(true) }} onClose={() => setShowPreflight(false)} />}
    </div>
  )
}

/* Run view — simple visual story (Easy/Guided) or detailed log (Pro/Dev); switchable */
function RunView({ events, nodes, running, feedRef, runId, onRetry, onArchitect }:
  { events: (RunEvent & { nodeId?: string })[]; nodes: Node[]; running: boolean; feedRef: React.RefObject<HTMLDivElement>; runId?: string; onRetry: () => void; onArchitect: () => void }) {
  const mode = useMode()
  const [view, setView] = useState<'simple' | 'detailed'>(mode === 'pro' || mode === 'developer' ? 'detailed' : 'simple')
  const [paused, setPaused] = useState(false)
  const labelOf = (id?: string) => id ? (nodes.find(n => n.id === id)?.data?.label as string || id) : ''

  // derive stages in execution order from events
  const order: string[] = []; const status: Record<string, string> = {}
  for (const ev of events) {
    if (!ev.nodeId) continue
    if (!order.includes(ev.nodeId)) order.push(ev.nodeId)
    status[ev.nodeId] = ev.type === 'done' ? 'done' : ev.type === 'error' ? 'failed' : 'working'
  }
  const doneCount = order.filter(id => status[id] === 'done').length
  const pct = order.length ? Math.round((doneCount / order.length) * 100) : (running ? 5 : 0)
  const failed = events.find(e => e.type === 'error')
  const complete = events.some(e => e.type === 'done' && !e.nodeId)

  return (
    <div className="runview">
      <div className="runview-head">
        <span className="runview-title">{paused ? '⏸ Paused' : running ? '⏳ Working…' : failed ? '⚠ Stopped' : complete ? '✅ Done' : 'Run'}</span>
        {running && runId && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
            {paused
              ? <button className="btn" onClick={() => { api.resumeRun(runId); setPaused(false) }}>▶ Resume</button>
              : <button className="btn" onClick={() => { api.pauseRun(runId); setPaused(true) }}>⏸ Pause</button>}
            <button className="btn danger" onClick={() => api.stopRun(runId)}>⏹ Stop</button>
          </div>
        )}
        <div className="runview-toggle">
          <button className={view === 'simple' ? 'on' : ''} onClick={() => setView('simple')}>Simple</button>
          <button className={view === 'detailed' ? 'on' : ''} onClick={() => setView('detailed')}>Detailed</button>
        </div>
      </div>

      {failed && !running && (
        <div className="error-card">
          <div className="error-card-title">Something went wrong{failed.nodeId ? ` at "${labelOf(failed.nodeId)}"` : ''}</div>
          <div className="error-card-body">
            <b>What happened:</b> {failed.text}<br />
            <b>Likely why:</b> the model may have been busy, the instruction unclear, or a tool call failed. Nothing on your computer was damaged.<br />
            <b>You can:</b> try again, ask the Architect to fix it, or open the details below.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={onRetry}>↻ Try again</button>
            <button className="btn" onClick={onArchitect}>🧭 Ask AI Architect</button>
            <button className="btn" onClick={() => setView('detailed')}>Show technical details</button>
          </div>
        </div>
      )}

      {view === 'simple' ? (
        <div className="stages">
          <div className="stage-progress"><i style={{ width: pct + '%' }} /></div>
          {order.length === 0 && running && <div className="stage-row working"><span className="stage-dot" /> Understanding your request…</div>}
          {order.map(id => (
            <div key={id} className={`stage-row ${status[id]}`}>
              <span className="stage-dot" />
              <span className="stage-name">{labelOf(id)}</span>
              <span className="stage-status">{status[id] === 'done' ? '✓ done' : status[id] === 'failed' ? '✗ failed' : '… working'}</span>
            </div>
          ))}
          {complete && <div className="stage-row done"><span className="stage-dot" /> <b>Finished — see the result below or in your output node.</b></div>}
        </div>
      ) : (
        <div className="feed wf-feed" ref={feedRef}>
          {events.map((ev, i) => <div key={i} className={`ev-${ev.type}`}>{ev.nodeId ? `[${labelOf(ev.nodeId)}] ` : ''}{ev.text}</div>)}
          {running && <div className="ev-info">⠿ working…</div>}
        </div>
      )}
    </div>
  )
}

function PreflightModal({ issues, allLocal, onRun, onSafe, onArchitect, onClose }:
  { issues: { level: string; text: string; fix?: () => void }[]; allLocal: boolean; onRun: () => void; onSafe: () => void; onArchitect: () => void; onClose: () => void }) {
  const [tick, setTick] = useState(0) // re-render after a fix
  const errors = issues.filter(i => i.level === 'error')
  const warns = issues.filter(i => i.level === 'warn')
  const ready = errors.length === 0
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <h3>{ready ? '✅ Ready to run' : '⚠ Needs attention'}</h3>
        <div className="preflight-facts sub" style={{ margin: '8px 0 14px' }}>
          {allLocal ? '🔒 Everything runs locally on your machine.' : '☁️ This uses at least one cloud model.'} · You approve before anything external happens.
        </div>
        {ready && warns.length === 0 && <div className="perm-line good" style={{ fontSize: 14 }}>Everything looks ready. 🎉</div>}
        {errors.map((i, k) => (
          <div key={'e' + k} className="pf-row err">
            <span>🛑 {i.text}</span>
            {i.fix && <button className="btn" onClick={() => { i.fix!(); setTick(t => t + 1) }}>Fix automatically</button>}
          </div>
        ))}
        {warns.map((i, k) => (
          <div key={'w' + k} className="pf-row warn">
            <span>⚠ {i.text}</span>
            {i.fix && <button className="btn" onClick={() => { i.fix!(); setTick(t => t + 1) }}>Fix</button>}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={!ready} onClick={onRun}>▶ Run</button>
          <button className="btn" disabled={!ready} onClick={onSafe} title="Fast preview: limits review loops and parallel branches">🛡 Safe preview</button>
          <button className="btn" onClick={onArchitect}>🧭 Ask AI Architect</button>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Cancel</button>
        </div>
        <input type="hidden" value={tick} readOnly />
      </div>
    </div>
  )
}

/* AI Architect — context-aware assistant with visible, reversible change diffs */
function diffWf(cur: Workflow, next: Workflow) {
  const curById = Object.fromEntries((cur.nodes || []).map(n => [n.id, n]))
  const nextById = Object.fromEntries((next.nodes || []).map(n => [n.id, n]))
  const label = (n: any) => n.data?.label || n.id
  const added = next.nodes.filter(n => !curById[n.id]).map(n => `+ Add ${n.type} "${label(n)}"`)
  const removed = cur.nodes.filter(n => !nextById[n.id]).map(n => `− Remove ${n.type} "${label(n)}"`)
  const modified = next.nodes.filter(n => curById[n.id] && JSON.stringify(curById[n.id].data) !== JSON.stringify(n.data)).map(n => `~ Change "${label(n)}"`)
  const eKey = (e: any) => `${e.source}→${e.target}`
  const curE = new Set((cur.edges || []).map(eKey)), nextE = new Set((next.edges || []).map(eKey))
  const addedE = [...nextE].filter(k => !curE.has(k)).map(k => `+ Connect ${k}`)
  const removedE = [...curE].filter(k => !nextE.has(k)).map(k => `− Disconnect ${k}`)
  return [...added, ...removed, ...modified, ...addedE, ...removedE]
}

const ARCH_COMMANDS = [
  'Explain this workflow', 'What am I missing?', 'Add a reviewer step',
  'Make it faster', 'Improve the quality', 'Simplify it', 'Keep everything local', 'Add error handling',
]

function ArchitectPanel({ getWf, models, selectedId, onApply, canUndo, onUndo, onClose }:
  { getWf: () => Workflow; models: AllModel[]; selectedId: string; onApply: (w: Workflow) => void; canUndo: boolean; onUndo: () => void; onClose: () => void }) {
  const usable = models.filter(m => m.kind === 'local' || m.kind === 'cloud')
  const [model, setModel] = useState(usable[0]?.ref || '')
  const [msgs, setMsgs] = useState<{ role: 'you' | 'architect'; text: string }[]>([])
  const [pending, setPending] = useState<{ workflow: Workflow; changes: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView() }, [msgs, pending])

  const send = async (command: string) => {
    if (!command.trim() || busy) return
    setMsgs(m => [...m, { role: 'you', text: command }]); setInput(''); setBusy(true); setPending(null)
    try {
      const cur = getWf()
      const r = await api.architect(command, cur, selectedId || null, model || undefined)
      setMsgs(m => [...m, { role: 'architect', text: r.reply || 'Done.' }])
      if (r.workflow) { const changes = diffWf(cur, r.workflow); if (changes.length) setPending({ workflow: r.workflow, changes }) }
    } catch (e) { setMsgs(m => [...m, { role: 'architect', text: 'Sorry, that failed: ' + e }]) }
    setBusy(false)
  }

  return (
    <div className="arch">
      <div className="arch-head">
        <b>🧭 AI Architect</b>
        <div className="spacer" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {canUndo && <button className="btn" onClick={onUndo} title="Undo the last applied change">↶ Undo</button>}
          <button className="btn" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="arch-model">
        <ModelSelect models={models} value={model} onChange={setModel} inline />
      </div>
      <div className="arch-cmds">
        {ARCH_COMMANDS.map(c => <button key={c} className="chip" disabled={busy} onClick={() => send(c)}>{c}</button>)}
      </div>
      <div className="arch-convo">
        {msgs.length === 0 && <div className="empty" style={{ padding: 24 }}>Ask about your workflow, or pick a command. I can explain it, or propose changes you approve before anything happens.</div>}
        {msgs.map((m, i) => <div key={i} className={`arch-msg ${m.role}`}>{m.role === 'architect'
          ? <div dangerouslySetInnerHTML={{ __html: marked.parse(m.text) as string }} /> : m.text}</div>)}
        {busy && <div className="arch-msg architect">⠿ thinking…</div>}
        {pending && (
          <div className="arch-proposal">
            <div className="arch-proposal-title">Proposed changes — nothing is applied yet</div>
            {pending.changes.map((c, i) => <div key={i} className={`arch-change ${c[0] === '+' ? 'add' : c[0] === '−' ? 'rem' : 'mod'}`}>{c}</div>)}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn primary" onClick={() => { onApply(pending.workflow); setMsgs(m => [...m, { role: 'architect', text: '✅ Applied. You can Undo at the top.' }]); setPending(null) }}>Apply</button>
              <button className="btn" onClick={() => { setPending(null); setMsgs(m => [...m, { role: 'architect', text: 'Okay, discarded — nothing changed.' }]) }}>Reject</button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="arch-input">
        <input placeholder="Ask or instruct… e.g. add a fact-checker before publishing" value={input}
          onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(input)} disabled={busy} />
        <button className="btn primary" disabled={busy || !input.trim()} onClick={() => send(input)}>Send</button>
      </div>
    </div>
  )
}

function AiBuildModal({ models, busy, onBuild, onClose }: { models: AllModel[]; busy: boolean; onBuild: (goal: string, model: string) => void; onClose: () => void }) {
  const usable = models.filter(m => m.kind === 'local' || m.kind === 'cloud')
  const [model, setModel] = useState(usable[0]?.ref || '')
  const [goal, setGoal] = useState(() => { const g = sessionStorage.getItem('cc-goal'); if (g) sessionStorage.removeItem('cc-goal'); return g || '' })
  const examples = [
    'Research a topic, write an article, then fact-check it',
    'Analyze a business idea and produce a go-to-market plan',
    'Take a bug report, reproduce it, propose a fix, and review the fix',
  ]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 560 }}>
        <h3>✨ AI Build a workflow</h3>
        <p className="sub" style={{ marginBottom: 16 }}>Describe what you want to happen, pick which model should design it, and it'll lay out the whole workflow for you to review and run.</p>
        <label className="f" style={{ marginBottom: 14 }}>Assistant model <span style={{ color: 'var(--ink-3)' }}>— the AI that designs your workflow</span>
          <select value={model} onChange={e => setModel(e.target.value)}>
            <optgroup label="💻 Local">{usable.filter(m => m.kind === 'local').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup>
            <optgroup label="☁️ Cloud">{usable.filter(m => m.kind === 'cloud').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup>
          </select>
        </label>
        <label className="f" style={{ marginBottom: 12 }}>What should this workflow do?
          <textarea rows={3} placeholder="e.g. Research a topic, write an article, then fact-check it" value={goal} onChange={e => setGoal(e.target.value)} autoFocus />
        </label>
        <div className="ai-examples">
          {examples.map(x => <button key={x} className="chip" onClick={() => setGoal(x)}>{x}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="btn primary ai-build" disabled={busy || !goal.trim() || !model} onClick={() => onBuild(goal, model)} style={{ flex: 1, padding: 12 }}>
            {busy ? '⏳ Designing your workflow…' : '✨ Design workflow'}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function NodeTester({ model, instruction, input }: { model?: string; instruction?: string; input: string }) {
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!instruction?.trim()) { setOut('Add an instruction first.'); return }
    setBusy(true); setOut('')
    try { const r = await api.testNode(model || '', instruction, input); setOut(r.output || '(empty)') }
    catch (e) { setOut('Test failed: ' + e) }
    setBusy(false)
  }
  return (
    <div>
      <div className="sub" style={{ marginBottom: 8 }}>Runs just this node with the current workflow input ({input ? `"${input.slice(0, 30)}…"` : 'empty'}) so you can preview its output.</div>
      <button className="btn primary" disabled={busy} onClick={run}>{busy ? '⏳ Testing…' : '▶ Test this node'}</button>
      {out && <div className="feed" style={{ height: 160, marginTop: 10 }}><div className="ev-log" style={{ whiteSpace: 'pre-wrap' }}>{out}</div></div>}
    </div>
  )
}

function ModelSelect({ models, label, value, onChange, inline }: { models: AllModel[]; label?: string; value?: string; onChange: (v: string) => void; inline?: boolean }) {
  const sel = (
    <select value={value || ''} onChange={e => onChange(e.target.value)} style={inline ? { flex: 1 } : undefined}>
      <option value="">— pick —</option>
      <optgroup label="✨ Auto (recommended — no ID needed)">{models.filter(m => m.kind === 'policy').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup>
      <optgroup label="💻 Local">{models.filter(m => m.kind === 'local').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup>
      <optgroup label="☁️ Cloud">{models.filter(m => m.kind === 'cloud').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup>
      <optgroup label="🎚 Role (tier-swappable)">{models.filter(m => m.kind === 'role').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup>
    </select>
  )
  return inline ? sel : <label className="f">{label}{sel}</label>
}

function ProfilesModal({ models, onClose }: { models: AllModel[]; onClose: () => void }) {
  const [data, setData] = useState<ProfilesResp>({ profiles: [], roles: [] })
  const refresh = () => api.profilesGet().then(setData)
  useEffect(() => { refresh() }, [])
  const patch = (id: string, role: string, ref: string) =>
    setData(d => ({ ...d, profiles: d.profiles.map(p => p.id === id ? { ...p, roles: { ...p.roles, [role]: ref } } : p) }))
  const localModels = models.filter(m => m.kind === 'local' || m.kind === 'cloud')
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 680 }}>
        <h3>🎚 Tier profiles</h3>
        <p className="sub" style={{ marginBottom: 14 }}>A tier maps each <b>role</b> to a real model. Nodes that use a <code>role:</code> model get swapped to the tier you pick at run time — this is how you deploy the same workflow at premium (big) or lite (small) power.</p>
        {data.profiles.map(p => (
          <div key={p.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <b>{p.name}</b>
              <button className="btn danger" style={{ marginLeft: 'auto' }} onClick={async () => { await api.delProfile(p.id); refresh() }}>Delete</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {data.roles.map(role => (
                <label className="f" key={role}>{role}
                  <select value={p.roles[role] || ''} onChange={e => patch(p.id, role, e.target.value)}>
                    <option value="">—</option>
                    {localModels.map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <button className="btn primary" style={{ marginTop: 10 }} onClick={async () => { await api.saveProfile(p); refresh() }}>💾 Save tier</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={async () => { const name = prompt('New tier name:'); if (name) { await api.saveProfile({ id: '', name, roles: {} } as Profile); refresh() } }}>+ New tier</button>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ProvidersModal({ onClose }: { onClose: () => void }) {
  const [provs, setProvs] = useState<Provider[]>([])
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [refs, setRefs] = useState<import('./api').SecretReference[]>([])
  const [refDraft, setRefDraft] = useState({ id: '', label: '', value: '' })
  const [refError, setRefError] = useState('')
  const refresh = () => Promise.all([api.providers(), api.secretReferences()]).then(([providers, references]) => { setProvs(providers); setRefs(references) })
  useEffect(() => { refresh() }, [])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>☁️ Cloud providers</h3>
        <p className="sub" style={{ marginBottom: 14 }}>Add an API key to use cloud models alongside local models. Credential values are stored in macOS Keychain and are never shown back.</p>
        {provs.map(p => (
          <div className="row" key={p.name} style={{ marginBottom: 10 }}>
            <span className={`dot-s ${p.configured ? 'loaded' : 'disk'}`} />
            <span className="name">{p.label}</span>
            <div className="spacer" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {p.configured
                ? <button className="btn danger" onClick={async () => { await api.delProvider(p.name); refresh() }}>Remove</button>
                : <>
                  <input placeholder="paste API key" value={keys[p.name] || ''} onChange={e => setKeys({ ...keys, [p.name]: e.target.value })} style={{ width: 200 }} />
                  <button className="btn primary" onClick={async () => { if (keys[p.name]) { await api.addProvider(p.name, keys[p.name]); setKeys({ ...keys, [p.name]: '' }); refresh() } }}>Add</button>
                </>}
            </div>
          </div>
        ))}
        <div className="section-title">Workflow and tool credentials</div>
        <p className="sub" style={{ marginBottom: 10 }}>These opaque references can authenticate HTTP and remote MCP steps. Workflows store only the reference name; the value is resolved from macOS Keychain during the network call.</p>
        {refs.map(reference => <div className="row" key={reference.id} style={{ marginBottom: 8 }}><span className={`dot-s ${reference.configured ? 'loaded' : 'disk'}`} /><div><div className="name">{reference.label}</div><div className="meta">{reference.id} · revision {reference.revision} · {reference.usedByCount} use(s)</div></div><button className="btn" style={{ marginLeft: 'auto' }} onClick={async () => { const value = prompt(`Enter a replacement value for ${reference.id}. It will be written directly to Keychain and cannot be shown again.`); if (!value) return; try { await api.rotateSecretReference(reference.id, reference.revision, value); await refresh() } catch (error) { setRefError(String(error)) } }}>Rotate</button><button className="btn danger" disabled={reference.usedByCount > 0} onClick={async () => { if (!confirm(`Delete ${reference.id}?`)) return; try { await api.deleteSecretReference(reference.id, reference.revision); await refresh() } catch (error) { setRefError(String(error)) } }}>Delete</button></div>)}
        <div className="card" style={{ marginTop: 10 }}><b>Add Keychain reference</b><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}><input placeholder="stable id, e.g. research.api" value={refDraft.id} onChange={e => setRefDraft({ ...refDraft, id: e.target.value })} /><input placeholder="display label" value={refDraft.label} onChange={e => setRefDraft({ ...refDraft, label: e.target.value })} /></div><input type="password" autoComplete="new-password" placeholder="credential value (never shown again)" value={refDraft.value} onChange={e => setRefDraft({ ...refDraft, value: e.target.value })} style={{ width: '100%', marginTop: 8 }} /><button className="btn primary" style={{ marginTop: 8 }} disabled={!refDraft.id || !refDraft.value} onClick={async () => { try { await api.createSecretReference(refDraft.id, refDraft.label, refDraft.value); setRefDraft({ id: '', label: '', value: '' }); setRefError(''); await refresh() } catch (error) { setRefError(String(error)) } }}>Store in Keychain</button>{refError && <div className="error-text" style={{ marginTop: 8 }}>{refError}</div>}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

/* ================= Studio (image generation) ================= */
const SIZES = [
  { l: 'Square 1024', w: 1024, h: 1024 },
  { l: 'Portrait 832×1216', w: 832, h: 1216 },
  { l: 'Landscape 1216×832', w: 1216, h: 832 },
]

function Studio({ comfy }: { comfy?: boolean }) {
  const [tab, setTab] = useState<'image' | 'video'>('image')
  const [models, setModels] = useState<StudioModel[]>([])
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('blurry, low quality, watermark, text')
  const [size, setSize] = useState(SIZES[0])
  const [steps, setSteps] = useState(0) // 0 = auto by model
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [image, setImage] = useState('')
  const [usedModel, setUsedModel] = useState<{ name: string; label: string } | null>(null)
  const [gallery, setGallery] = useState<string[]>([])
  const [err, setErr] = useState('')

  // NOTE: functional setState — only picks a default if none chosen yet; polling never overrides the user's pick.
  const loadModels = () => api.studioModels().then(ms => {
    setModels(ms)
    setModel(prev => prev || ms.find(m => m.ready)?.name || ms[0]?.name || '')
  }).catch(() => {})
  useEffect(() => { loadModels(); api.studioGallery().then(setGallery).catch(() => {}); const iv = setInterval(loadModels, 8000); return () => clearInterval(iv) }, [])

  const selModel = models.find(m => m.name === model)
  const isFlux = selModel?.type === 'flux'
  const isSchnell = /schnell/i.test(model)

  const generate = async () => {
    if (!prompt.trim() || !model || busy) return
    if (selModel && !selModel.ready) { setErr('That model is still downloading — pick another or wait until it shows as ready.'); return }
    setBusy(true); setErr(''); setImage(''); setStatus('submitting…')
    const picked = { name: model, label: selModel?.label || model }
    try {
      const body: Record<string, unknown> = { model, prompt, negative, width: size.w, height: size.h }
      if (steps > 0) body.steps = steps
      const { promptId } = await api.studioGenerate(body)
      setStatus('generating…')
      // poll for result
      const t0 = Date.now()
      const poll = async (): Promise<void> => {
        const r = await api.studioResult(promptId)
        if (r.status === 'done' && r.images?.length) {
          setImage(r.images[0]); setUsedModel(picked); setStatus(`done in ${Math.round((Date.now() - t0) / 1000)}s`); setBusy(false)
          api.studioGallery().then(setGallery)
          return
        }
        if (r.status === 'failed') { setErr('Generation failed — check ComfyUI'); setBusy(false); return }
        setStatus(r.status === 'running' ? `rendering… ${Math.round((Date.now() - t0) / 1000)}s` : 'queued…')
        setTimeout(poll, 1500)
      }
      poll()
    } catch (e) { setErr(String(e)); setBusy(false); setStatus('') }
  }

  if (comfy === false) return (
    <div className="error-banner">🎨 ComfyUI engine is not running. Start it: open a Terminal and run<br />
      <code style={{ fontFamily: 'var(--mono)' }}>cd ~/ComfyUI &amp;&amp; source venv/bin/activate &amp;&amp; python main.py</code><br />
      (or use the "Start Studio" desktop launcher). This page will light up once it's live.</div>
  )

  const StudioTabs = (
    <div className="runview-toggle" style={{ marginBottom: 10 }}>
      <button className={tab === 'image' ? 'on' : ''} onClick={() => setTab('image')}>🖼 Image</button>
      <button className={tab === 'video' ? 'on' : ''} onClick={() => setTab('video')}>🎬 Video</button>
    </div>
  )
  if (tab === 'video') return <div className="studio"><div className="studio-controls">{StudioTabs}<VideoStudio /></div><div className="studio-canvas" /></div>

  return (
    <div className="studio">
      <div className="studio-controls">
        {StudioTabs}
        {err && <div className="error-banner">{err}</div>}
        <label className="f">Model
          <select value={model} onChange={e => setModel(e.target.value)}>
            {models.length === 0 && <option>— no models yet (downloading?) —</option>}
            {models.map(m => <option key={m.name} value={m.name}>{m.label}{m.tags?.length ? ' — ' + m.tags.join(' · ') : ''}{m.ready ? '' : ' (downloading…)'}</option>)}
          </select>
        </label>
        {selModel && <div className="model-desc">{selModel.desc}{!selModel.ready && <b style={{ color: 'var(--warn)' }}> · still downloading</b>}</div>}
        <label className="f">Prompt
          <textarea rows={4} placeholder="Describe the image…" value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }} />
        </label>
        {!isFlux && (
          <label className="f">Negative prompt
            <textarea rows={2} value={negative} onChange={e => setNegative(e.target.value)} />
          </label>
        )}
        <label className="f">Size
          <select value={size.l} onChange={e => setSize(SIZES.find(s => s.l === e.target.value)!)}>
            {SIZES.map(s => <option key={s.l} value={s.l}>{s.l}</option>)}
          </select>
        </label>
        <label className="f">Steps {steps === 0 && <span style={{ color: 'var(--ink-3)' }}>(auto: {isFlux ? (isSchnell ? 4 : 20) : 28})</span>}
          <input type="range" min={0} max={50} value={steps} onChange={e => setSteps(+e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !prompt.trim() || !model} onClick={generate}
          style={{ width: '100%', padding: 12 }}>
          {busy ? `⏳ ${status}` : '✨ Generate'}
        </button>
        {isFlux && <div className="studio-hint">⚡ Flux ignores negative prompts (guidance-based). Schnell = 4 steps, fast.</div>}
        {!isFlux && <div className="studio-hint">🎨 SDXL — uncensored. More steps = more detail, slower.</div>}
      </div>

      <div className="studio-canvas">
        <div className="studio-stage">
          {image
            ? <img src={image} alt="generated" />
            : <div className="empty">{busy ? `⏳ ${status}` : 'Your image will appear here.\nWrite a prompt and hit Generate.'}</div>}
        </div>
        {image && usedModel && (
          <div className="model-used">
            <span>🎯 Generated with <b>{usedModel.label}</b> <span className="mono">({usedModel.name})</span></span>
            <span className="model-used-verify">The model name is embedded in the PNG itself. Verify independently: <code>python3 ~/command-center/scripts/verify_image_model.py &lt;file.png&gt;</code></span>
          </div>
        )}
        {gallery.length > 0 && (
          <>
            <div className="section-title" style={{ margin: '16px 0 8px' }}>Recent</div>
            <div className="studio-gallery">
              {gallery.map((g, i) => <img key={i} src={g} onClick={() => setImage(g)} alt="" />)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ================= Brain ================= */
const SECTIONS: Record<string, { icon: string; label: string }> = {
  '00-Rules': { icon: '⚖️', label: 'Rules' },
  '10-Skills': { icon: '📘', label: 'Skills' },
  '20-Knowledge': { icon: '📚', label: 'Knowledge' },
  '30-Memory': { icon: '🧠', label: 'Memory' },
  '': { icon: '📄', label: 'Vault' },
}
const SECTION_ORDER = ['00-Rules', '10-Skills', '20-Knowledge', '30-Memory', '']

function Brain() {
  const [tree, setTree] = useState<BrainFile[]>([])
  const [sel, setSel] = useState('')
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [view, setView] = useState<'edit' | 'preview' | 'map'>('edit')
  const [graph, setGraph] = useState<BrainGraph | null>(null)

  const refresh = () => api.brainTree().then(setTree)
  useEffect(() => { refresh() }, [])
  useEffect(() => { if (view === 'map') api.brainGraph().then(setGraph) }, [view, saved])

  const open = async (p: string) => {
    const f = await api.brainFile(p)
    setSel(p); setContent(f.content); setSaved(f.content); setView('edit')
  }
  const save = async () => { await api.brainSave(sel, content); setSaved(content); refresh() }
  const dirty = content !== saved

  const newFile = async (section: string) => {
    const name = prompt(`New file in ${SECTIONS[section]?.label || section} — name (no spaces):`)
    if (!name) return
    const p = `${section}/${name.replace(/\.md$/, '').replace(/[^a-zA-Z0-9-_]/g, '-')}.md`
    await api.brainSave(p, `# ${name}\n\n`)
    refresh(); open(p)
  }
  const del = async (p: string) => {
    if (!confirm(`Delete ${p}? This cannot be undone.`)) return
    await api.brainDelete(p)
    if (sel === p) { setSel(''); setContent(''); setSaved('') }
    refresh()
  }

  return (
    <div className="brain-wrap">
      <div className="brain-tree">
        {SECTION_ORDER.filter(s => s !== '' || tree.some(f => f.section === '')).map(section => (
          <div key={section || 'root'}>
            <div className="brain-section">
              <span>{SECTIONS[section]?.icon} {SECTIONS[section]?.label}</span>
              {section && <button className="brain-add" title="New file" onClick={() => newFile(section)}>+</button>}
            </div>
            {tree.filter(f => f.section === section).map(f => (
              <div key={f.path} className={`brain-file ${sel === f.path ? 'active' : ''}`} onClick={() => open(f.path)}>
                <span className="brain-file-name">{f.name}</span>
                <button className="brain-del" title="Delete" onClick={e => { e.stopPropagation(); del(f.path) }}>×</button>
              </div>
            ))}
            {tree.filter(f => f.section === section).length === 0 && section && <div className="brain-empty">empty</div>}
          </div>
        ))}
      </div>

      <div className="brain-main">
        <div className="brain-toolbar">
          <span className="name" style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
            {sel || 'select a file'}{dirty && <span style={{ color: 'var(--warn)' }}> ● unsaved</span>}
          </span>
          <div className="spacer" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className={`btn ${view === 'edit' ? 'primary' : ''}`} onClick={() => setView('edit')}>✏️ Edit</button>
            <button className={`btn ${view === 'preview' ? 'primary' : ''}`} onClick={() => setView('preview')}>👁 Preview</button>
            <button className={`btn ${view === 'map' ? 'primary' : ''}`} onClick={() => setView('map')}>🕸 Map</button>
            {view !== 'map' && <button className="btn primary" disabled={!sel || !dirty} onClick={save}>💾 Save</button>}
          </div>
        </div>

        {view === 'map' && <BrainMap graph={graph} onOpen={open} />}
        {view === 'edit' && (sel
          ? <textarea className="brain-editor" value={content} onChange={e => setContent(e.target.value)} spellCheck={false} />
          : <div className="empty">Pick a file on the left, or create one with +<br /><br />Tip: link files with [[name]] — links show up in the 🕸 Map.</div>)}
        {view === 'preview' && (sel
          ? <div className="brain-preview msg ai" dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }} />
          : <div className="empty">Pick a file to preview.</div>)}
      </div>
    </div>
  )
}

function BrainMap({ graph, onOpen }: { graph: BrainGraph | null; onOpen: (p: string) => void }) {
  if (!graph) return <div className="empty">Loading map…</div>
  const cols = SECTION_ORDER.filter(s => graph.nodes.some(n => n.section === s))
  const W = 900, COLW = W / Math.max(cols.length, 1), ROWH = 44, PAD = 60
  const pos = new Map<string, { x: number; y: number }>()
  cols.forEach((s, ci) => {
    graph.nodes.filter(n => n.section === s).forEach((n, ri) => {
      pos.set(n.path, { x: ci * COLW + COLW / 2, y: PAD + 30 + ri * ROWH })
    })
  })
  const H = Math.max(320, PAD + 60 + ROWH * Math.max(...cols.map(s => graph.nodes.filter(n => n.section === s).length), 1))
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} className="brain-map">
        {cols.map((s, ci) => (
          <text key={s || 'root'} x={ci * COLW + COLW / 2} y={30} textAnchor="middle" className="map-section">
            {SECTIONS[s]?.icon} {SECTIONS[s]?.label}
          </text>
        ))}
        {graph.links.map((l, i) => {
          const a = pos.get(l.source), b = pos.get(l.target)
          if (!a || !b) return null
          const mx = (a.x + b.x) / 2
          return <path key={i} d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`} className="map-link" />
        })}
        {graph.nodes.map(n => {
          const p = pos.get(n.path)!
          return (
            <g key={n.path} className="map-node" onClick={() => onOpen(n.path)}>
              <circle cx={p.x} cy={p.y} r={7} />
              <text x={p.x} y={p.y + 22} textAnchor="middle">{n.name.length > 20 ? n.name.slice(0, 19) + '…' : n.name}</text>
            </g>
          )
        })}
      </svg>
      {graph.links.length === 0 && <div className="empty">No links yet — write [[filename]] inside a note to connect it to another.</div>}
    </div>
  )
}

/* ================= Dashboard ================= */
function Meter({ pct }: { pct: number }) {
  const cls = pct >= 85 ? 'crit' : pct >= 70 ? 'warn' : ''
  return <div className="meter"><i className={cls} style={{ width: `${Math.min(100, pct)}%` }} /></div>
}

function Dashboard({ sys }: { sys: SystemInfo | null }) {
  if (!sys) return <div className="empty">Connecting…</div>
  const ramPct = (sys.ram.usedGB / sys.ram.totalGB) * 100
  const diskUsed = sys.disk.totalGB - sys.disk.freeGB
  const diskPct = (diskUsed / (sys.disk.totalGB || 1)) * 100
  const dls = Object.entries(sys.downloads).filter(([, d]) => d.status === 'downloading')
  return (
    <>
      <div className="grid cols-4">
        <div className="card">
          <h3>Memory</h3>
          <div className="stat">{sys.ram.usedGB} <small>/ {sys.ram.totalGB} GB</small></div>
          <Meter pct={ramPct} />
          <div className="sub">{Math.round(ramPct)}% in use</div>
        </div>
        <div className="card">
          <h3>Disk</h3>
          <div className="stat">{sys.disk.freeGB} <small>GB free</small></div>
          <Meter pct={diskPct} />
          <div className="sub">{Math.round(diskPct)}% of {sys.disk.totalGB} GB used</div>
        </div>
        <div className="card">
          <h3>Models</h3>
          <div className="stat">{sys.loaded.length} <small>loaded / {sys.modelCount} on disk</small></div>
          <div className="sub">{dls.length ? `⬇ ${dls.length} downloading` : 'no downloads active'}</div>
        </div>
        <div className="card">
          <h3>Agent runs</h3>
          <div className="stat">{sys.activeRuns} <small>active</small></div>
          <div className="sub">models: {sys.modelScheduling.active} active · {sys.modelScheduling.queued} queued</div>
        </div>
      </div>

      <div className="plain-callout">Global model scheduling: {sys.modelScheduling.active}/{sys.modelScheduling.limits.maxConcurrentCalls} calls active. {sys.modelScheduling.limits.memoryBudgetBytes ? `${(sys.modelScheduling.activeEstimatedBytes / 1073741824).toFixed(1)} / ${(sys.modelScheduling.limits.memoryBudgetBytes / 1073741824).toFixed(1)} GB of known estimates reserved.` : 'The optional estimated-memory budget is off.'} {sys.modelScheduling.activeUnknownEstimates || sys.modelScheduling.loadedUnknownEstimates ? `${sys.modelScheduling.activeUnknownEstimates} active and ${sys.modelScheduling.loadedUnknownEstimates} loaded model estimate(s) unavailable; concurrency limits still apply.` : ''}</div>

      <div className="section-title">Services</div>
      <div className="grid cols-2">
        <div className="row">
          <span className={`dot-s ${sys.services.lmstudio ? 'loaded' : 'disk'}`} />
          <span className="name">LM Studio server</span>
          <span className="meta spacer">{sys.services.lmstudio ? '✓ online · localhost:1234' : '✗ offline — open LM Studio or run: lms server start'}</span>
        </div>
        <div className="row">
          <span className={`dot-s ${sys.services.opencode ? 'loaded' : 'disk'}`} />
          <span className="name">OpenCode engine</span>
          <span className="meta spacer">{sys.services.opencode ? '✓ installed' : '✗ not found'}</span>
        </div>
        <div className="row">
          <span className={`dot-s ${sys.services.comfy ? 'loaded' : 'disk'}`} />
          <span className="name">ComfyUI (image/video)</span>
          <span className="meta spacer">{sys.services.comfy ? '✓ online · localhost:8188' : '✗ offline — start it for the Studio page'}</span>
        </div>
      </div>

      <div className="section-title">Loaded in memory</div>
      <div className="rows">
        {sys.loaded.length === 0 && <div className="empty">No models loaded — go to Models and load one.</div>}
        {sys.loaded.map(m => (
          <div className="row" key={m.id}>
            <span className="dot-s loaded" /><span className="name">{m.id}</span>
            <span className="meta spacer">● loaded · context {m.context?.toLocaleString?.() ?? m.context}</span>
          </div>
        ))}
      </div>

      {dls.length > 0 && <>
        <div className="section-title">Downloads</div>
        <div className="rows">
          {dls.map(([name, d]) => (
            <div className="row" key={name}>
              <span className="dot-s dl" /><span className="name">{name}</span>
              <span className="meta spacer">⬇ {d.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </>}
      <AtLeast mode="pro"><AuditTrail /></AtLeast>
    </>
  )
}

function AuditTrail() {
  const [rows, setRows] = useState<{ t: number; action: string; detail: any }[]>([])
  useEffect(() => { api.audit().then(setRows).catch(() => {}) }, [])
  if (!rows.length) return null
  const desc = (a: string, d: any) => a === 'workflow_run' ? `Ran workflow "${d?.workflow}"${d?.safe ? ' (safe preview)' : ''}`
    : a === 'provider_added' ? `Connected cloud provider: ${d?.provider}`
    : a === 'killall' ? `Emergency stop — cancelled ${d?.runs} task(s)` : a
  return (<>
    <div className="section-title">Activity log</div>
    <div className="rows">
      {rows.slice(0, 12).map((r, i) => (
        <div className="row" key={i}>
          <span className="meta" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{new Date(r.t).toLocaleTimeString()}</span>
          <span className="name" style={{ fontWeight: 400 }}>{desc(r.action, r.detail)}</span>
        </div>
      ))}
    </div>
  </>)
}

/* ================= Models ================= */
const CTX = [{ v: 32768, l: '32k' }, { v: 131072, l: '128k' }, { v: 262144, l: '256k' }]

function Models({ sys }: { sys: SystemInfo | null }) {
  const [models, setModels] = useState<Model[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string>('')
  const [ctx, setCtx] = useState<Record<string, number>>({})
  const [dlName, setDlName] = useState('')

  const refresh = () => api.models().then(m => { setModels(m); setErr('') }).catch(e => setErr(String(e)))
  useEffect(() => { refresh(); const iv = setInterval(refresh, 4000); return () => clearInterval(iv) }, [])

  const doLoad = async (id: string) => {
    setBusy(id)
    try { await api.load(id, ctx[id] || 131072) } catch (e) { setErr('Load failed: ' + e) }
    setBusy(''); refresh()
  }
  const doUnload = async (id: string) => {
    setBusy(id)
    try { await api.unload(id) } catch (e) { setErr('Unload failed: ' + e) }
    setBusy(''); refresh()
  }
  const doDownload = async () => {
    if (!dlName.trim()) return
    await api.download(dlName.trim()); setDlName('')
  }

  const dls = Object.entries(sys?.downloads || {}).filter(([, d]) => d.status === 'downloading')
  return (
    <>
      {err && <div className="error-banner">{err}</div>}
      <div className="row" style={{ marginBottom: 16 }}>
        <input placeholder="Download new model… e.g. qwen/qwen3-vl-72b" value={dlName}
          onChange={e => setDlName(e.target.value)} onKeyDown={e => e.key === 'Enter' && doDownload()} style={{ flex: 1 }} />
        <button className="btn primary" onClick={doDownload}>⬇ Download</button>
      </div>
      {dls.map(([name, d]) => (
        <div className="row" key={name} style={{ marginBottom: 10 }}>
          <span className="dot-s dl" /><span className="name">{name}</span>
          <span className="meta spacer">⬇ downloading {d.pct.toFixed(1)}%</span>
        </div>
      ))}
      <div className="rows">
        {!models && !err && <div className="empty">Loading models…</div>}
        {models?.map(m => (
          <div className="row" key={m.id}>
            <span className={`dot-s ${m.state === 'loaded' ? 'loaded' : 'disk'}`} />
            <div>
              <div className="name">{m.id}</div>
              <div className="meta">{m.state === 'loaded' ? `● loaded · ctx ${m.loadedContext?.toLocaleString()}` : '○ on disk'} · {m.arch}{m.quant ? ` · ${m.quant}` : ''} · max ctx {m.maxContext?.toLocaleString()}</div>
            </div>
            <div className="spacer" />
            {m.state !== 'loaded' && (
              <select value={ctx[m.id] || 131072} onChange={e => setCtx({ ...ctx, [m.id]: +e.target.value })}>
                {CTX.filter(c => c.v <= (m.maxContext || 262144)).map(c => <option key={c.v} value={c.v}>{c.l} ctx</option>)}
              </select>
            )}
            {m.state === 'loaded'
              ? <button className="btn danger" disabled={busy === m.id} onClick={() => doUnload(m.id)}>{busy === m.id ? '…' : 'Unload'}</button>
              : <button className="btn primary" disabled={busy === m.id} onClick={() => doLoad(m.id)}>{busy === m.id ? 'Loading…' : 'Load'}</button>}
          </div>
        ))}
      </div>
    </>
  )
}

/* ================= Chat ================= */
type Msg = { role: 'user' | 'assistant'; content: string }

function Chat() {
  const [models, setModels] = useState<Model[]>([])
  const [model, setModel] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.models().then(ms => {
      setModels(ms)
      const loaded = ms.find(m => m.state === 'loaded')
      setModel(loaded?.id || ms[0]?.id || '')
    }).catch(() => setErr('LM Studio unreachable'))
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async () => {
    const text = input.trim()
    if (!text || busy || !model) return
    setInput(''); setErr('')
    const history: Msg[] = [...msgs, { role: 'user', content: text }]
    setMsgs([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    try {
      let acc = ''
      await streamChat(model, history, chunk => {
        acc += chunk
        setMsgs([...history, { role: 'assistant', content: acc }])
      })
    } catch (e) { setErr('Chat failed — is the model loaded? ' + e) }
    setBusy(false)
  }

  return (
    <div className="chat-wrap">
      {err && <div className="error-banner">{err}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="meta">Model</span>
        <select value={model} onChange={e => setModel(e.target.value)} style={{ flex: 1 }}>
          {models.map(m => <option key={m.id} value={m.id}>{m.state === 'loaded' ? '● ' : '○ '}{m.id}</option>)}
        </select>
        <button className="btn" onClick={() => setMsgs([])}>Clear</button>
      </div>
      <div className="chat-msgs">
        {msgs.length === 0 && <div className="empty">Talk to any of your local models. ● = already loaded (instant) · ○ = will load on first message (slower first reply).</div>}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="msg user">{m.content}</div>
          : <div key={i} className="msg ai" dangerouslySetInnerHTML={{ __html: marked.parse(m.content || '…') as string }} />)}
        <div ref={endRef} />
      </div>
      <div className="chat-input">
        <textarea placeholder="Type a message… (Enter to send, Shift+Enter for newline)" value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="btn primary" disabled={busy || !input.trim()} onClick={send}>{busy ? '…' : 'Send ▸'}</button>
      </div>
    </div>
  )
}

/* ================= Agents ================= */
function Agents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [editing, setEditing] = useState<Partial<Agent> | null>(null)
  const [taskFor, setTaskFor] = useState<Agent | null>(null)
  const [task, setTask] = useState('')
  const [runId, setRunId] = useState('')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<RunSummary[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [migrationPreview, setMigrationPreview] = useState<AgentMigrationPreview | null>(null)
  const [migrationChoice, setMigrationChoice] = useState<Record<string, string>>({})
  const [migrationBusy, setMigrationBusy] = useState('')
  const [migrationError, setMigrationError] = useState('')
  const feedRef = useRef<HTMLDivElement>(null)

  const refresh = () => { api.agents().then(setAgents); api.runs().then(setHistory); api.agentMigrationPreview().then(setMigrationPreview).catch(() => {}) }
  useEffect(() => { refresh(); api.models().then(setModels).catch(() => {}); api.skills().then(setSkills).catch(() => {}) }, [])
  useEffect(() => { feedRef.current?.scrollTo(0, 1e9) }, [events])

  const startRun = async () => {
    if (!taskFor || !task.trim()) return
    setEvents([]); setRunning(true)
    const { runId } = await api.runTask(taskFor.id, task)
    setRunId(runId)
    subscribeRun(runId, ev => setEvents(prev => [...prev, ev]), () => { setRunning(false); refresh() })
  }

  const openRun = (id: string) => {
    setTaskFor(null); setEvents([]); setRunId(id); setRunning(false)
    subscribeRun(id, ev => setEvents(prev => [...prev, ev]), () => {})
  }

  const migrateAgent = async (agent: Agent) => {
    const proposal = migrationPreview?.proposals.find(item => item.legacyAgentId === agent.id)
    if (!proposal) return
    const primitiveId = proposal.primitiveId || migrationChoice[agent.id]
    if (!primitiveId) { setMigrationError('Choose the intended primitive before migrating this ambiguous legacy role.'); return }
    if (!confirm(`Create a versioned ${primitiveId} Role Card and Agent Instance for ${agent.name}?\n\nThe legacy agent remains unchanged and rollback stays available.`)) return
    setMigrationBusy(agent.id); setMigrationError('')
    try {
      await api.migrateAgent(agent.id, { ...(proposal.primitiveId ? {} : { primitiveId }), expectedLegacyHash: proposal.legacySnapshotHash, expectedRevision: migrationPreview!.architectureRevision, commandId: crypto.randomUUID() })
      refresh()
    } catch (error) { setMigrationError(String(error)); refresh() }
    finally { setMigrationBusy('') }
  }

  const rollbackAgent = async (agent: Agent) => {
    const proposal = migrationPreview?.proposals.find(item => item.legacyAgentId === agent.id)
    if (!proposal || !confirm(`Return ${agent.name} to legacy fallback?\n\nArchitecture records and receipts remain preserved for audit and exact re-migration.`)) return
    setMigrationBusy(agent.id); setMigrationError('')
    try {
      await api.rollbackAgentMigration(agent.id, { expectedLegacyHash: proposal.legacySnapshotHash, expectedRevision: migrationPreview!.architectureRevision, commandId: crypto.randomUUID() })
      refresh()
    } catch (error) { setMigrationError(String(error)); refresh() }
    finally { setMigrationBusy('') }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setEditing({ avatar: '🤖', permissions: 'standard', department: 'General Operations', model: models.find(m => m.state === 'loaded') ? 'lmstudio/' + models.find(m => m.state === 'loaded')!.id : '' })}>+ New Agent</button>
      </div>

      {migrationPreview && <div className="plain-callout" data-testid="agent-migration-summary" style={{ marginBottom: 14 }}><b>Agent Architecture migration</b><p>{migrationPreview.summary.ready} ready · {migrationPreview.summary.reviewRequired} need an explicit role decision · architecture revision {migrationPreview.architectureRevision}</p><small>Preview and migration are nondestructive. Legacy IDs, prompts, models, folders, permissions, skills, and configuration remain intact.</small></div>}
      {migrationError && <div className="perm-line warn" role="alert" style={{ marginBottom: 12 }}>{migrationError}</div>}

      <div className="grid cols-2">
        {agents.map(a => (
          <div className="card agent-card" key={a.id}>
            <div className="agent-head">
              <span className="agent-avatar">{a.avatar}</span>
              <div>
                <div className="agent-name">{a.name}</div>
                <div className="agent-model">{a.model}</div>
              </div>
              <div className="spacer" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setEditing(a)}>Edit</button>
                <button className="btn primary" onClick={() => { setTaskFor(a); setTask(''); setEvents([]); setRunId('') }}>▶ Run task</button>
              </div>
            </div>
            <div className="agent-prompt">{a.prompt}</div>
            <div className="meta" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>📁 {a.folder}</div>
            {a.architecture ? (
              <details data-testid={`agent-architecture-${a.id}`} style={{ marginTop: 12 }}>
                <summary><b>{a.architecture.primitiveId}</b> primitive · Role Card v{a.architecture.roleCardVersion}</summary>
                <div className="meta" style={{ marginTop: 8 }}>Role Card: {a.architecture.roleCardId}<br />Agent Instance: {a.architecture.agentInstanceId}<br />Class: {a.architecture.organizationalClass}<br />Status: {a.architecture.status}</div>
                <button className="btn" style={{ marginTop: 8 }} disabled={migrationBusy === a.id} onClick={() => rollbackAgent(a)}>Use legacy fallback</button>
              </details>
            ) : (() => {
              const proposal = migrationPreview?.proposals.find(item => item.legacyAgentId === a.id)
              if (!proposal) return null
              return <div data-testid={`agent-migration-${a.id}`} style={{ marginTop: 12 }}>
                <div className="meta"><b>{proposal.status === 'READY' ? `Ready to become ${proposal.primitiveId}` : 'Role decision required'}</b>{proposal.ambiguityReasons.map(reason => <small key={reason} style={{ display: 'block' }}>{reason}</small>)}</div>
                {proposal.status === 'REVIEW_REQUIRED' && <select aria-label={`Primitive for ${a.name}`} value={migrationChoice[a.id] || ''} onChange={event => setMigrationChoice(current => ({ ...current, [a.id]: event.target.value }))}><option value="">Choose primitive…</option>{proposal.primitiveCandidates.map(id => <option key={id} value={id}>{id}</option>)}</select>}
                <button className="btn" style={{ marginTop: 8 }} disabled={migrationBusy === a.id || (!proposal.primitiveId && !migrationChoice[a.id])} onClick={() => migrateAgent(a)}>{migrationBusy === a.id ? 'Migrating…' : 'Create versioned architecture'}</button>
              </div>
            })()}
          </div>
        ))}
      </div>

      {editing && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{editing.id ? 'Edit agent' : 'New agent'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label className="f">Avatar<input value={editing.avatar || ''} onChange={e => setEditing({ ...editing, avatar: e.target.value })} /></label>
            <label className="f">Name<input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
            <label className="f">Model
              <select value={editing.model || ''} onChange={e => setEditing({ ...editing, model: e.target.value })}>
                <option value="">— pick —</option>
                {models.map(m => <option key={m.id} value={'lmstudio/' + m.id}>{m.state === 'loaded' ? '● ' : '○ '}{m.id}</option>)}
              </select>
            </label>
          </div>
          <label className="f" style={{ marginBottom: 12 }}>Role / system prompt
            <textarea rows={3} value={editing.prompt || ''} onChange={e => setEditing({ ...editing, prompt: e.target.value })} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}><label className="f">Role<input value={editing.role || ''} onChange={e => setEditing({ ...editing, role: e.target.value })} placeholder="Research Director" /></label><label className="f">Department<input value={editing.department || ''} onChange={e => setEditing({ ...editing, department: e.target.value })} placeholder="Research" /></label></div>
          <label className="f" style={{ marginBottom: 6 }}>What is this agent allowed to do?
            <select value={editing.permissions || 'standard'} onChange={e => setEditing({ ...editing, permissions: e.target.value })}>
              <option value="full">Full access (read/write/delete anywhere, run anything)</option>
              <option value="standard">Standard (only its own project folder)</option>
              <option value="readonly">Read-only (look but don't change or run)</option>
            </select>
          </label>
          <div className="perm-line warn" style={{ fontSize: 12, marginBottom: 12 }}>
            {editing.permissions === 'readonly' ? '🔒 Safest — cannot change files or run commands.'
              : editing.permissions === 'standard' ? '🛡 Confined to its working folder — cannot touch the rest of your Mac.'
                : '⚠ Full access — powerful, no guardrails. Fine on a dedicated machine.'}
          </div>
          {skills.length > 0 && (
            <div className="f" style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500 }}>Skills to give this agent</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {skills.map(s => {
                  const on = (editing.skills || []).includes(s.path)
                  return <button key={s.path} className={`chip ${on ? '' : ''}`} style={on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                    onClick={() => setEditing({ ...editing, skills: on ? (editing.skills || []).filter(x => x !== s.path) : [...(editing.skills || []), s.path] })}>
                    {on ? '✓ ' : '＋ '}{s.title}</button>
                })}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={async () => { await api.saveAgent(editing); setEditing(null); refresh() }}>Save</button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            {editing.id && <button className="btn danger" style={{ marginLeft: 'auto' }}
              onClick={async () => { await api.deleteAgent(editing.id!); setEditing(null); refresh() }}>Delete</button>}
          </div>
        </div>
      )}

      {taskFor && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>▶ Run task — {taskFor.avatar} {taskFor.name}</h3>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <input style={{ flex: 1 }} placeholder='e.g. "Create a file hello.txt containing WORKS"' value={task}
              onChange={e => setTask(e.target.value)} onKeyDown={e => e.key === 'Enter' && startRun()} disabled={running} />
            <button className="btn primary" disabled={running || !task.trim()} onClick={startRun}>{running ? 'Running…' : 'Launch'}</button>
            {running && runId && <button className="btn danger" onClick={() => api.stopRun(runId)}>⏹ Stop</button>}
          </div>
          {(events.length > 0 || running) && (
            <div className="feed" ref={feedRef}>
              {events.map((ev, i) => <div key={i} className={`ev-${ev.type}`}>{ev.text}</div>)}
              {running && <div className="ev-info">⠿ working…</div>}
            </div>
          )}
        </div>
      )}

      {!taskFor && runId && events.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Run transcript</h3>
          <div className="feed" ref={feedRef}>
            {events.map((ev, i) => <div key={i} className={`ev-${ev.type}`}>{ev.text}</div>)}
          </div>
        </div>
      )}

      <div className="section-title">Run history</div>
      <div className="rows">
        {history.length === 0 && <div className="empty">No runs yet — pick an agent and hit ▶ Run task.</div>}
        {history.map(r => (
          <div className="row" key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRun(r.id)}>
            <span>{r.avatar}</span>
            <div>
              <div className="name">{r.agentName}: {r.task.slice(0, 90)}{r.task.length > 90 ? '…' : ''}</div>
              <div className="meta">{new Date(r.started).toLocaleString()}</div>
            </div>
            <span className={`badge ${r.status} spacer`}>{r.status === 'running' ? '⠿ running' : r.status === 'done' ? '✔ done' : '✘ failed'}</span>
          </div>
        ))}
      </div>
    </>
  )
}
