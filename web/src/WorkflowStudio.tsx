import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type OnConnect, type ReactFlowInstance,
} from '@xyflow/react'
import {
  api, subscribeWfRun,
  type AllModel, type Artifact, type ComponentImportProposal, type Profile, type RunDetail, type RunEvent, type SystemInfo, type Skill,
  type NodeContract, type PortDefinition, type Workflow, type WorkflowComment, type WorkflowComponent, type WorkflowVersion, type WfSummary,
} from './api'
import { historyStatus, triggerAvailability, triggerDeletePrompt, triggerSummary, triggerTypeLabel, type TriggerHistoryItem, type WorkflowTrigger } from './workflowTriggerHelpers'
import {
  absoluteCanvasPosition, applyRecursiveVisibility, orderHierarchyNodes, recursiveMemberNodeIds,
  reparentPreservingAbsolute, validateReparent,
} from './workflowGroupHelpers'
import { advanceSubworkflowPin, currentWorkflowVersion, extractedSubworkflowData } from './workflowVersionHelpers'
import { reusableComponentNodeData } from './workflowComponentHelpers'
import { commentAnchorStatus, moveWorkflowComment, visibleWorkflowComments } from './workflowCommentHelpers'

type Mode = 'easy' | 'guided' | 'pro' | 'developer'
type Event = RunEvent & { nodeId?: string }
type InspectorTab = 'basic' | 'advanced' | 'permissions' | 'testing' | 'versions'
type BottomTab = 'timeline' | 'logs' | 'variables' | 'errors' | 'artifacts' | 'resources' | 'console'
type Layout = { left: boolean; right: boolean; bottom: boolean; architect: boolean; leftWidth: number; rightWidth: number; bottomHeight: number }
type SavedLayout = { name: string; value: Layout }
type ContextState = { x: number; y: number; kind: 'node' | 'edge' | 'canvas'; id?: string } | null
type DurableApproval = { id: string; nodeId: string; subjectHash: string; revision: number; state: string }

type CatalogItem = {
  type: string; label: string; description: string; glyph: string; category: string; keywords: string[]; available: boolean
}

const CATEGORY_META: Record<string, { glyph: string; tone: string }> = {
  'Start & Input': { glyph: '↦', tone: 'input' },
  'Agents & Teams': { glyph: '◇', tone: 'agent' },
  'Logic & Decisions': { glyph: '◆', tone: 'logic' },
  'Loops & Parallel': { glyph: '⟳', tone: 'logic' },
  'Code & Scripts': { glyph: '</>', tone: 'code' },
  'Data & Files': { glyph: '▤', tone: 'code' },
  'Knowledge': { glyph: '⌕', tone: 'knowledge' },
  'Tools & APIs': { glyph: '⌁', tone: 'tool' },
  'Review & Quality': { glyph: '✓', tone: 'review' },
  'Media': { glyph: '◫', tone: 'media' },
  'Output': { glyph: '↗', tone: 'output' },
  'Workflow Organization': { glyph: '▣', tone: 'knowledge' },
}

const CATALOG: CatalogItem[] = [
  { type: 'input', label: 'Manual Start', description: 'Start with text or instructions', glyph: '↦', category: 'Start & Input', keywords: ['start input text form manual'], available: true },
  { type: 'file-input', label: 'File Input', description: 'Select one or more files', glyph: '▤', category: 'Start & Input', keywords: ['file pdf document upload'], available: true },
  { type: 'folder-input', label: 'Folder Input', description: 'Process a local folder', glyph: '▱', category: 'Start & Input', keywords: ['folder directory watch files'], available: true },
  { type: 'schedule', label: 'Scheduled Start', description: 'Run on a schedule', glyph: '◷', category: 'Start & Input', keywords: ['schedule cron time trigger'], available: false },
  { type: 'agent', label: 'Agent', description: 'Assign one focused task', glyph: '◇', category: 'Agents & Teams', keywords: ['agent worker writer coder researcher analyst'], available: true },
  { type: 'orchestrator', label: 'Orchestrator', description: 'Plan and delegate flexible work', glyph: '✣', category: 'Agents & Teams', keywords: ['manager planner delegate team lead'], available: true },
  { type: 'parallel', label: 'Multi-model Team', description: 'Generate candidates and judge them', glyph: '⑂', category: 'Agents & Teams', keywords: ['parallel team vote judge compare models'], available: true },
  { type: 'human-approval', label: 'Human Approval', description: 'Pause until a person approves', glyph: '◎', category: 'Agents & Teams', keywords: ['human approval review gate person'], available: true },
  { type: 'if', label: 'If / Else', description: 'Choose a route using a condition', glyph: '◆', category: 'Logic & Decisions', keywords: ['if else decision condition route branch'], available: true },
  { type: 'delay', label: 'Wait', description: 'Pause for a controlled duration', glyph: '◷', category: 'Logic & Decisions', keywords: ['wait delay pause duration time'], available: true },
  { type: 'error-handler', label: 'Error Handler', description: 'Route failures to a repair step', glyph: '!', category: 'Logic & Decisions', keywords: ['error catch retry failure repair safely'], available: false },
  { type: 'critic', label: 'Critic Loop', description: 'Draft, review, and improve', glyph: '⟳', category: 'Loops & Parallel', keywords: ['review critic correct verify improve quality loop approved'], available: true },
  { type: 'map', label: 'Map Items', description: 'Run one agent task for every item', glyph: '⑂', category: 'Loops & Parallel', keywords: ['map each item loop repeat batch files'], available: true },
  { type: 'merge', label: 'Merge', description: 'Join parallel branches', glyph: '⋈', category: 'Loops & Parallel', keywords: ['merge join parallel combine'], available: false },
  { type: 'python', label: 'Python Script', description: 'Transform data with tested Python', glyph: 'Py', category: 'Code & Scripts', keywords: ['python code script transform pandas'], available: true },
  { type: 'shell', label: 'Shell Command', description: 'Run a command in the run workspace', glyph: '>_', category: 'Code & Scripts', keywords: ['shell terminal bash zsh command'], available: true },
  { type: 'json-transform', label: 'JSON Transform', description: 'Select or reshape structured data', glyph: '{}', category: 'Code & Scripts', keywords: ['json transform select fields schema data'], available: true },
  { type: 'read-file', label: 'Read File', description: 'Read a file created during the run', glyph: '▤', category: 'Data & Files', keywords: ['read file text data'], available: true },
  { type: 'write-file', label: 'Write File', description: 'Save data as a run artifact', glyph: '□', category: 'Data & Files', keywords: ['write save file artifact output'], available: true },
  { type: 'csv-reader', label: 'CSV Reader', description: 'Read structured CSV data', glyph: '▦', category: 'Data & Files', keywords: ['csv spreadsheet table read'], available: false },
  { type: 'search', label: 'Knowledge Search', description: 'Search local ingested knowledge', glyph: '⌕', category: 'Knowledge', keywords: ['search knowledge rag vector semantic documents obsidian'], available: true },
  { type: 'pdf-reader', label: 'PDF Reader', description: 'Extract text from PDF files', glyph: '▤', category: 'Knowledge', keywords: ['pdf read extract document ocr'], available: true },
  { type: 'obsidian-read', label: 'Obsidian Read', description: 'Read a note from your vault', glyph: '⬡', category: 'Knowledge', keywords: ['obsidian read note vault memory'], available: true },
  { type: 'obsidian-write', label: 'Save to Obsidian', description: 'Create or update a vault note', glyph: '⬡', category: 'Knowledge', keywords: ['obsidian write note vault memory'], available: true },
  { type: 'http', label: 'HTTP Request', description: 'Call a REST API', glyph: '⌁', category: 'Tools & APIs', keywords: ['http api rest request url webhook'], available: true },
  { type: 'mcp', label: 'MCP Tool', description: 'Use a registered MCP tool', glyph: '⊕', category: 'Tools & APIs', keywords: ['mcp tool connection integration'], available: true },
  { type: 'check', label: 'Quality Check', description: 'Deterministic content validation', glyph: '✓', category: 'Review & Quality', keywords: ['check validate correct schema json requirement'], available: true },
  { type: 'reviewer', label: 'Reviewer', description: 'Review another result', glyph: '◇', category: 'Review & Quality', keywords: ['review quality agent verify'], available: false },
  { type: 'image', label: 'Generate Image', description: 'Create an image with ComfyUI', glyph: '◫', category: 'Media', keywords: ['image comfyui picture art generate'], available: false },
  { type: 'video', label: 'Generate Video', description: 'Create local video', glyph: '▷', category: 'Media', keywords: ['video movie animate generate'], available: false },
  { type: 'output', label: 'Display Result', description: 'Collect the final workflow result', glyph: '↗', category: 'Output', keywords: ['output result display final return artifact'], available: true },
  { type: 'save-artifact', label: 'Save Artifact', description: 'Publish a file to Results', glyph: '□', category: 'Output', keywords: ['save artifact file publish result'], available: false },
  { type: 'subworkflow', label: 'Subworkflow', description: 'Run another reusable workflow', glyph: '▣', category: 'Workflow Organization', keywords: ['subworkflow reusable component nested workflow'], available: true },
]

const EXEC_META: Record<string, { glyph: string; tone: string; description: string; in: boolean; out: boolean }> = {
  input: { glyph: '↦', tone: 'input', description: 'The information that starts this workflow', in: false, out: true },
  'file-input': { glyph: '▤', tone: 'input', description: 'Reads configured files from this machine', in: false, out: true },
  'folder-input': { glyph: '▱', tone: 'input', description: 'Lists matching files from a configured folder', in: false, out: true },
  agent: { glyph: '◇', tone: 'agent', description: 'One AI team member completes a focused task', in: true, out: true },
  orchestrator: { glyph: '✣', tone: 'agent', description: 'A lead plans and delegates a flexible task', in: true, out: true },
  critic: { glyph: '⟳', tone: 'review', description: 'A worker and reviewer improve the result together', in: true, out: true },
  parallel: { glyph: '⑂', tone: 'agent', description: 'Several models try; a judge produces the answer', in: true, out: true },
  'human-approval': { glyph: '◎', tone: 'review', description: 'Pauses this run until a person approves or rejects it', in: true, out: true },
  search: { glyph: '⌕', tone: 'knowledge', description: 'Finds relevant passages in local knowledge', in: true, out: true },
  'pdf-reader': { glyph: '▤', tone: 'knowledge', description: 'Extracts text and source labels from PDF files', in: true, out: true },
  'obsidian-read': { glyph: '⬡', tone: 'knowledge', description: 'Reads a Markdown note from an Obsidian-compatible vault', in: false, out: true },
  'obsidian-write': { glyph: '⬡', tone: 'output', description: 'Writes the incoming result to an Obsidian-compatible vault', in: true, out: true },
  check: { glyph: '✓', tone: 'review', description: 'Checks content without calling a model', in: true, out: true },
  if: { glyph: '◆', tone: 'logic', description: 'Selects a Yes or No route using a deterministic condition', in: true, out: true },
  delay: { glyph: '◷', tone: 'logic', description: 'Waits for a controlled duration before continuing', in: true, out: true },
  map: { glyph: '⑂', tone: 'agent', description: 'Runs the same model task for each item in a list', in: true, out: true },
  python: { glyph: 'Py', tone: 'code', description: 'Runs Python with JSON input inside this run workspace', in: true, out: true },
  shell: { glyph: '>_', tone: 'code', description: 'Runs a shell command inside this run workspace', in: true, out: true },
  'json-transform': { glyph: '{}', tone: 'code', description: 'Selects and reshapes JSON without a model', in: true, out: true },
  'read-file': { glyph: '▤', tone: 'code', description: 'Reads a file from this run workspace', in: true, out: true },
  'write-file': { glyph: '□', tone: 'output', description: 'Saves incoming data as a run artifact', in: true, out: true },
  http: { glyph: '⌁', tone: 'tool', description: 'Calls an HTTP API and passes its response onward', in: true, out: true },
  mcp: { glyph: '⊕', tone: 'tool', description: 'Calls a discovered tool on a registered MCP server', in: true, out: true },
  output: { glyph: '↗', tone: 'output', description: 'Collects the final result', in: true, out: false },
  subworkflow: { glyph: '▣', tone: 'knowledge', description: 'Runs a reusable child workflow with recursion protection', in: true, out: true },
}

const DEFAULT_LAYOUT: Layout = { left: true, right: true, bottom: true, architect: false, leftWidth: 248, rightWidth: 306, bottomHeight: 220 }
const shortModel = (m?: string) => (m || '').replace(/^lmstudio\//, '').split('/').pop() || 'Balanced'

function StudioNode({ data, selected }: { data: any; selected?: boolean }) {
  const meta = EXEC_META[data.ntype] || EXEC_META.agent
  const compact = data.displaySize === 'compact'
  const inputPorts: PortDefinition[] = data.ports?.inputs || (meta.in ? [{ id: 'input', type: 'any', label: 'Input' }] : [])
  const outputPorts: PortDefinition[] = data.ports?.outputs || (meta.out ? [{ id: 'output', type: 'any', label: 'Output' }] : [])
  return (
    <div className={`studio-node tone-${meta.tone} state-${data.disabled || data.ancestorDisabled ? 'disabled' : data.status || 'waiting'} ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`}>
      {inputPorts.map((port, index) => <Handle key={port.id} id={port.id} type="target" position={Position.Left} className={`typed-handle port-${port.type}`} style={{ top: `${((index + 1) / (inputPorts.length + 1)) * 100}%` }} title={`${port.label} · ${port.type}${port.required === false ? ' · optional' : ''}`} />)}
      <div className="studio-node-head">
        <span className="studio-node-glyph">{meta.glyph}</span>
        <span className="studio-node-name">{data.label || data.ntype}</span>
        {data.breakpoint && <span className="node-breakpoint" title="Breakpoint">●</span>}
        <span className={`node-state state-${data.status || 'ready'}`}>{data.status || 'Ready'}</span>
      </div>
      {!compact && <>
        <div className="studio-node-desc">{meta.description}</div>
        <div className="studio-node-details">
          {['agent', 'orchestrator', 'critic'].includes(data.ntype) && <span>Model <b>{shortModel(data.model)}</b></span>}
          {data.ntype === 'parallel' && <span><b>{data.models?.length || 1}</b> candidates + judge</span>}
          {data.ntype === 'search' && <span><b>{data.k || 4}</b> passages</span>}
          {data.ntype === 'check' && <span>{data.checks?.isJson ? 'JSON schema' : 'Content rules'}</span>}
          {data.ntype === 'if' && <span><b>{data.operator || 'contains'}</b> {String(data.value || 'value')}</span>}
          {data.ntype === 'python' && <span>Python 3 · <b>{data.timeoutMs / 1000 || 120}s</b></span>}
          {data.ntype === 'shell' && <span><b>{data.command || 'Configure command'}</b></span>}
          {data.ntype === 'map' && <span>Up to <b>{data.maxItems || 25}</b> items</span>}
          {data.ntype === 'http' && <span><b>{data.method || 'GET'}</b> {data.url || 'Configure URL'}</span>}
          {data.ntype === 'write-file' && <span><b>{data.path || 'output.txt'}</b></span>}
        </div>
      </>}
      {!compact && inputPorts.length > 1 && <div className="node-port-labels left">{inputPorts.map(port => <span key={port.id}>{port.label}</span>)}</div>}
      {!compact && outputPorts.length > 1 && <div className="node-port-labels right">{outputPorts.map(port => <span key={port.id}>{port.label}</span>)}</div>}
      {outputPorts.map((port, index) => <Handle key={port.id} id={port.id} type="source" position={Position.Right} className={`typed-handle port-${port.type}`} style={{ top: `${((index + 1) / (outputPorts.length + 1)) * 100}%` }} title={`${port.label} · ${port.type}`} />)}
    </div>
  )
}
function StudioGroupNode({ data, selected }: { data: any; selected?: boolean }) {
  return <div className={`studio-group-node ${selected ? 'selected' : ''} ${data.disabled || data.ancestorDisabled ? 'disabled' : ''}`} style={{ borderColor: data.color || '#56647a', background: `${data.color || '#56647a'}16` }}><div><span>SECTION{data.disabled ? ' · DISABLED' : data.ancestorDisabled ? ' · DISABLED BY PARENT' : ''}{data.collapsed ? ' · COLLAPSED' : ''}</span><b>{data.label || 'Workflow section'}</b><small>{data.description || `${data.nodeCount || 0} grouped steps`}</small></div></div>
}
function StudioCommentNode({ data, selected }: { data: any; selected?: boolean }) {
  return <div className={`studio-comment-node ${selected ? 'selected' : ''} ${data.resolved ? 'resolved' : ''} ${data.anchorState === 'missing' ? 'missing-anchor' : ''}`}><span>REVIEW NOTE{data.resolved ? ' · RESOLVED' : ''}</span><p>{data.text}</p><small>{data.anchorLabel}</small></div>
}
const nodeTypes = { studio: StudioNode, group: StudioGroupNode, comment: StudioCommentNode }

const toRF = (n: any, contract?: NodeContract): Node => ({ id: n.id, type: 'studio', position: n.position || { x: 0, y: 0 }, ...(n.groupId ? { parentId: n.groupId, extent: 'parent' as const } : {}), data: { ntype: n.type, ...(n.data || {}), ports: n.ports || contract, definitionVersion: n.definitionVersion || 1 } })
const groupToRF = (group: any): Node => ({ id: group.id, type: 'group', position: group.position || { x: 0, y: 0 }, ...(group.parentGroupId ? { parentId: group.parentGroupId, extent: 'parent' as const } : {}), style: { width: group.width || 500, height: group.height || 300, zIndex: -1 }, data: { ntype: '__group', label: group.title || group.label || 'Section', description: group.description || '', color: group.color || '#56647a', department: group.department || '', collapsed: !!group.collapsed, disabled: !!group.disabled, order: Number(group.order) || 0, groupRecord: group } })
const commentToRF = (comment: WorkflowComment, targets: Array<{ id: string; type: 'node' | 'group'; label: string }>, selected: boolean): Node => {
  const anchor = commentAnchorStatus(comment, targets)
  return { id: comment.id, type: 'comment', position: comment.position, selected, selectable: true, connectable: false, deletable: false, data: { ntype: '__comment', text: comment.text, resolved: comment.resolved, anchorState: anchor.state, anchorLabel: anchor.label } }
}
const fromRF = (n: Node): any => {
  const { ntype, status, ports, definitionVersion, ancestorDisabled, ...data } = n.data as any
  return { id: n.id, type: ntype, position: n.position, data, ...(ports ? { ports } : {}), definitionVersion: definitionVersion || 1, ...(n.parentId ? { groupId: n.parentId } : {}) }
}
const makeWorkflow = (id: string, name: string, nodes: Node[], edges: Edge[], comments: WorkflowComment[], environment: string, project: string, settings: Record<string, any>, variables: Record<string, any>): Workflow => {
  const executable = nodes.filter(n => (n.data as any).ntype !== '__group')
  const secretReferences = [...new Map(executable.filter(node => String((node.data as any).authRef || '').trim()).map(node => { const data = node.data as any; const reference = String(data.authRef).trim().toLowerCase(); return [reference, { id: reference, purpose: data.ntype === 'http' ? 'http' : data.ntype === 'mcp' ? 'mcp' : 'generic' }] })).values()]
  const groups = nodes.filter(n => (n.data as any).ntype === '__group').map((n, index) => {
    const original = (n.data as any).groupRecord || {}
    const directIds = executable.filter(child => child.parentId === n.id).map(child => child.id)
    const stableIds = [...(Array.isArray(original.nodeIds) ? original.nodeIds.filter((nodeId: string) => directIds.includes(nodeId)) : []), ...directIds.filter(nodeId => !original.nodeIds?.includes(nodeId))]
    return { ...original, id: n.id, title: String(n.data.label || 'Section'), description: String((n.data as any).description || ''), color: (n.data as any).color, department: (n.data as any).department, parentGroupId: n.parentId || null, order: Number((n.data as any).order ?? original.order ?? index), collapsed: !!(n.data as any).collapsed, disabled: !!(n.data as any).disabled, position: n.position, width: Number(n.width || (n.style as any)?.width || 500), height: Number(n.height || (n.style as any)?.height || 300), nodeIds: stableIds }
  })
  return { schemaVersion: 2, id, name, nodes: executable.map(fromRF), edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}), ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}), ...(e.data ? { data: e.data as any } : {}) })), groups, comments, environment, project, settings, variables, secretReferences } as Workflow
}

function clientPortsCompatible(source?: PortDefinition, target?: PortDefinition) {
  if (!source || !target || source.type === 'any' || target.type === 'any' || source.type === target.type) return true
  if (target.type === 'data' && ['object', 'array', 'table', 'data'].includes(source.type)) return true
  if (source.type === 'file' && target.type === 'files') return true
  if (source.type === 'artifact' && ['file', 'files'].includes(target.type)) return true
  if (['memory', 'code'].includes(source.type) && target.type === 'text') return true
  return false
}

function converterSuggestion(source?: PortDefinition, target?: PortDefinition) {
  if (!source || !target) return 'a Data Transformer'
  if (source.type === 'image' && target.type === 'text') return 'an OCR or Vision Model node'
  if (['file', 'files', 'artifact'].includes(source.type) && target.type === 'text') return 'a Document Reader node'
  if (source.type === 'text' && ['object', 'array', 'data'].includes(target.type)) return 'a JSON Transform node'
  return 'a Data Transformer node'
}

function autoLayout(nodes: Node[], edges: Edge[]) {
  const incoming: Record<string, string[]> = {}
  edges.forEach(e => (incoming[e.target] ||= []).push(e.source))
  const depth: Record<string, number> = {}
  const calc = (id: string, seen = new Set<string>()): number => {
    if (depth[id] != null) return depth[id]
    if (seen.has(id)) return 0
    const next = new Set(seen); next.add(id)
    depth[id] = incoming[id]?.length ? Math.max(...incoming[id].map(x => calc(x, next))) + 1 : 0
    return depth[id]
  }
  const rows: Record<number, number> = {}
  return nodes.map(n => {
    if ((n.data as any).ntype === '__group' || n.parentId) return n
    const d = calc(n.id); const row = rows[d] || 0; rows[d] = row + 1
    return { ...n, position: { x: 70 + d * 270, y: 80 + row * 170 } }
  })
}

function createsCycle(edges: Edge[], source: string, target: string) {
  if (source === target) return true
  const adj: Record<string, string[]> = {}
  edges.forEach(e => (adj[e.source] ||= []).push(e.target))
  const todo = [target], seen = new Set<string>()
  while (todo.length) {
    const id = todo.pop()!
    if (id === source) return true
    if (seen.has(id)) continue
    seen.add(id); todo.push(...(adj[id] || []))
  }
  return false
}

export function WorkflowStudioV2({ mode, onModeChange }: { mode: Mode; onModeChange: (mode: Mode) => void }) {
  return <ReactFlowProvider><WorkflowStudio mode={mode} onModeChange={onModeChange} /></ReactFlowProvider>
}

function WorkflowStudio({ mode, onModeChange }: { mode: Mode; onModeChange: (mode: Mode) => void }) {
  const [list, setList] = useState<WfSummary[]>([])
  const [wfId, setWfId] = useState('')
  const [workflowBreadcrumbs, setWorkflowBreadcrumbs] = useState<Array<{ id: string; name: string }>>([])
  const [name, setName] = useState('Untitled Workflow')
  const [project, setProject] = useState('Command Center')
  const [environment, setEnvironment] = useState('development')
  const [workflowSettings, setWorkflowSettings] = useState<Record<string, any>>({ localOnly: true, parallelism: 4, maxDuration: 21600000, retries: 1, cache: true, schedule: 'manual' })
  const [workflowVariables, setWorkflowVariables] = useState<Record<string, any>>({})
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [comments, setComments] = useState<WorkflowComment[]>([])
  const [showResolvedComments, setShowResolvedComments] = useState(false)
  const [selectedNode, setSelectedNode] = useState('')
  const [selectedEdge, setSelectedEdge] = useState('')
  const [selectedComment, setSelectedComment] = useState('')
  const [models, setModels] = useState<AllModel[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [contracts, setContracts] = useState<Record<string, NodeContract>>({})
  const [profileId, setProfileId] = useState('')
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [libraryTab, setLibraryTab] = useState<'nodes' | 'templates' | 'reusable' | 'custom'>('nodes')
  const [customNodes, setCustomNodes] = useState<any[]>([])
  const [workflowComponents, setWorkflowComponents] = useState<WorkflowComponent[]>([])
  const [componentImport, setComponentImport] = useState<ComponentImportProposal | null>(null)
  const [customWizard, setCustomWizard] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('basic')
  const [bottomTab, setBottomTab] = useState<BottomTab>('timeline')
  const [layout, setLayout] = useState<Layout>(() => {
    try { return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem('cc-studio-layout') || '{}') } } catch { return DEFAULT_LAYOUT }
  })
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>(() => {
    try { return JSON.parse(localStorage.getItem('cc-studio-saved-layouts') || '[]') } catch { return [] }
  })
  const [simpleView, setSimpleView] = useState(mode === 'easy')
  const [fullscreen, setFullscreen] = useState(false)
  const [codeFullscreen, setCodeFullscreen] = useState(false)
  const [guidedOpen, setGuidedOpen] = useState(false)
  const [quickSetupNode, setQuickSetupNode] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextState>(null)
  const [rf, setRf] = useState<ReactFlowInstance | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [runId, setRunId] = useState('')
  const [durableApprovals, setDurableApprovals] = useState<DurableApproval[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [notice, setNotice] = useState('')
  const [webhookDisclosure, setWebhookDisclosure] = useState<{ endpoint: string; token: string } | null>(null)
  useEffect(() => setWebhookDisclosure(null), [wfId])
  const [architectInput, setArchitectInput] = useState('')
  const [architectBusy, setArchitectBusy] = useState(false)
  const [architectReply, setArchitectReply] = useState('')
  const [proposal, setProposal] = useState<Workflow | null>(null)
  const [past, setPast] = useState<{ nodes: Node[]; edges: Edge[]; comments: WorkflowComment[] }[]>([])
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[]; comments: WorkflowComment[] }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const componentImportRef = useRef<HTMLInputElement>(null)

  const snapshot = useCallback(() => {
    setPast(p => [...p.slice(-39), { nodes, edges, comments }]); setFuture([])
  }, [nodes, edges, comments])
  const undo = useCallback(() => {
    setPast(p => {
      if (!p.length) return p
      const previous = p[p.length - 1]
      setFuture(f => [{ nodes, edges, comments }, ...f]); setNodes(previous.nodes); setEdges(previous.edges); setComments(previous.comments)
      return p.slice(0, -1)
    })
  }, [nodes, edges, comments, setNodes, setEdges])
  const redo = useCallback(() => {
    setFuture(f => {
      if (!f.length) return f
      const next = f[0]
      setPast(p => [...p, { nodes, edges, comments }]); setNodes(next.nodes); setEdges(next.edges); setComments(next.comments)
      return f.slice(1)
    })
  }, [nodes, edges, comments, setNodes, setEdges])

  const refresh = useCallback(async () => {
    const [workflows, components, allModels, profileData, skillData, contractData, customDefinitions] = await Promise.all([api.workflows(), api.workflowComponents(), api.allModels(), api.profilesGet(), api.skills(), api.workflowNodeContracts(), api.customNodes()])
    const customContracts = Object.fromEntries(contractData.custom.map(item => [`custom:${item.id}`, { inputs: item.inputs, outputs: item.outputs }]))
    setList(workflows); setWorkflowComponents(components); setModels(allModels); setProfiles(profileData.profiles); setSkills(skillData); setCustomNodes(customDefinitions); setContracts({ ...contractData.contracts, ...customContracts })
  }, [])

  const load = useCallback(async (id: string) => {
    const w = await api.workflow(id) as Workflow & { environment?: string; project?: string }
    setWfId(w.id); setName(w.name); setProject(w.project || 'Command Center'); setEnvironment(w.environment || 'development')
    setWorkflowSettings({ localOnly: true, parallelism: 4, maxDuration: 21600000, retries: 1, cache: true, schedule: 'manual', ...(w.settings || {}) }); setWorkflowVariables(w.variables || {})
    setComments(w.comments || [])
    const groupNodes = (w.groups || []).map(groupToRF)
    const workflowNodes = w.nodes.map(n => toRF(n, contracts[n.type === 'custom' ? `custom:${n.data.customNodeId}` : n.type]))
    setNodes(applyRecursiveVisibility(orderHierarchyNodes([...groupNodes, ...workflowNodes])) as Node[]); setEdges(w.edges.map(e => ({ ...e, ...(e.data?.condition ? { label: e.data.condition === 'true' ? 'Yes' : 'No' } : {}) })) as Edge[])
    setSelectedNode(''); setSelectedEdge(''); setSelectedComment(''); setPast([]); setFuture([]); setNotice('')
    setTimeout(() => rf?.fitView({ padding: .2, duration: 300 }), 50)
  }, [rf, setNodes, setEdges, contracts])

  useEffect(() => { refresh().catch(e => setNotice(`Could not load Studio data: ${e}`)) }, [refresh])
  useEffect(() => { if (!wfId && list[0]) load(list[0].id) }, [list, wfId, load])
  useEffect(() => {
    const id = sessionStorage.getItem('cc-open-wf')
    if (id) { sessionStorage.removeItem('cc-open-wf'); load(id) }
    if (sessionStorage.getItem('cc-goal')) { setArchitectInput(sessionStorage.getItem('cc-goal') || ''); sessionStorage.removeItem('cc-goal'); setLayout(l => ({ ...l, architect: true })) }
  }, [load])
  useEffect(() => { localStorage.setItem('cc-studio-layout', JSON.stringify(layout)) }, [layout])
  useEffect(() => { localStorage.setItem('cc-studio-saved-layouts', JSON.stringify(savedLayouts)) }, [savedLayouts])
  useEffect(() => { setSimpleView(mode === 'easy') }, [mode])
  useEffect(() => {
    api.system().then(setSys).catch(() => {})
    const timer = window.setInterval(() => api.system().then(setSys).catch(() => {}), 5000)
    return () => clearInterval(timer)
  }, [])

  const selected = nodes.find(n => n.id === selectedNode)
  const selectedData = selected?.data as any
  const chosenEdge = edges.find(e => e.id === selectedEdge)
  const chosenComment = comments.find(comment => comment.id === selectedComment)
  const commentTargets = useMemo(() => nodes.map(node => ({ id: node.id, type: (node.data as any).ntype === '__group' ? 'group' as const : 'node' as const, label: String(node.data.label || node.id) })), [nodes])
  const commentNodes = useMemo(() => visibleWorkflowComments(comments, showResolvedComments).map(comment => commentToRF(comment, commentTargets, comment.id === selectedComment)), [comments, showResolvedComments, commentTargets, selectedComment])

  const handleCanvasNodesChange = useCallback((changes: any[]) => {
    const commentIds = new Set(comments.map(comment => comment.id))
    const workflowChanges = changes.filter(change => !commentIds.has(change.id))
    if (workflowChanges.length) onNodesChange(workflowChanges)
    const positions = new Map(changes.filter(change => commentIds.has(change.id) && change.type === 'position' && change.position).map(change => [change.id, change.position]))
    if (positions.size) setComments(items => items.map(comment => positions.has(comment.id) ? moveWorkflowComment(comment, positions.get(comment.id) as { x: number; y: number }) : comment))
  }, [comments, onNodesChange])

  const createComment = () => {
    const text = window.prompt('Review comment', 'Review this part of the workflow.')?.trim()
    if (!text) return
    snapshot()
    const selectedTarget = nodes.find(node => node.id === selectedNode)
    const anchor = selectedTarget ? { type: (selectedTarget.data as any).ntype === '__group' ? 'group' as const : 'node' as const, id: selectedTarget.id } : null
    const targetPosition = selectedTarget ? absoluteCanvasPosition(nodes, selectedTarget.id) : rf?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 240, y: 160 }
    const now = Date.now(), comment: WorkflowComment = { id: `comment-${crypto.randomUUID().slice(0, 8)}`, text, position: { x: targetPosition.x + (selectedTarget ? 32 : 0), y: targetPosition.y + (selectedTarget ? 32 : 0) }, anchor, resolved: false, createdAt: now, updatedAt: now }
    setComments(items => [...items, comment]); setSelectedComment(comment.id); setSelectedNode(''); setSelectedEdge(''); setLayout(value => ({ ...value, right: true })); setNotice(anchor ? 'Review comment added with a semantic anchor. It does not participate in execution.' : 'Canvas review comment added. It does not participate in execution.')
  }

  const editComment = (comment: WorkflowComment) => {
    const text = window.prompt('Edit review comment', comment.text)?.trim()
    if (!text || text === comment.text) return
    snapshot(); setComments(items => items.map(item => item.id === comment.id ? { ...item, text, updatedAt: Date.now() } : item))
  }

  const toggleCommentResolved = (comment: WorkflowComment) => {
    snapshot(); setComments(items => items.map(item => item.id === comment.id ? { ...item, resolved: !item.resolved, updatedAt: Date.now() } : item))
    if (!comment.resolved && !showResolvedComments) setSelectedComment('')
    setNotice(comment.resolved ? 'Review comment reopened.' : 'Review comment resolved. Use “Show resolved” to review it again.')
  }

  const deleteComment = (comment: WorkflowComment) => {
    if (!window.confirm('Delete this review comment? You can undo this action until the workflow is closed.')) return
    snapshot(); setComments(items => items.filter(item => item.id !== comment.id)); setSelectedComment(''); setNotice('Review comment deleted. Workflow execution was unchanged.')
  }

  const setCommentAnchor = (comment: WorkflowComment, value: string) => {
    const [type, id] = value.split(':', 2)
    const anchor: WorkflowComment['anchor'] = type === 'node' || type === 'group' ? { type, id } : null
    snapshot(); setComments(items => items.map(item => item.id === comment.id ? { ...item, anchor, updatedAt: Date.now() } : item))
  }

  const patchSelected = (patch: Record<string, unknown>) => {
    snapshot(); setNodes(ns => ns.map(n => n.id === selectedNode ? { ...n, data: { ...n.data, ...patch } } : n))
  }

  const startResize = (kind: 'left' | 'right' | 'bottom', e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY, initial = layout
    const move = (ev: PointerEvent) => setLayout(l => ({ ...l,
      ...(kind === 'left' ? { leftWidth: Math.max(190, Math.min(430, initial.leftWidth + ev.clientX - startX)) } : {}),
      ...(kind === 'right' ? { rightWidth: Math.max(250, Math.min(560, initial.rightWidth + startX - ev.clientX)) } : {}),
      ...(kind === 'bottom' ? { bottomHeight: Math.max(120, Math.min(520, initial.bottomHeight + startY - ev.clientY)) } : {}),
    }))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('studio-resizing') }
    document.body.classList.add('studio-resizing'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const addNode = useCallback((type: string, position?: { x: number; y: number }) => {
    const item = CATALOG.find(i => i.type === type)
    if (!item?.available) { setNotice(`${item?.label || type} is planned but not executable yet.`); return }
    snapshot()
    const id = `${type}-${crypto.randomUUID().slice(0, 6)}`
    const data: any = { label: item.label, description: item.description }
    if (['agent', 'orchestrator'].includes(type)) Object.assign(data, { model: 'policy:balanced', instruction: '{{input}}' })
    if (type === 'critic') Object.assign(data, { model: 'policy:balanced', reviewerModel: 'policy:balanced', maxIters: 2, instruction: '{{input}}' })
    if (type === 'parallel') Object.assign(data, { models: ['policy:balanced'], judgeModel: 'policy:balanced', instruction: '{{input}}' })
    if (type === 'search') Object.assign(data, { label: 'Knowledge Search', instruction: '{{input}}', k: 4 })
    if (type === 'check') Object.assign(data, { label: 'Quality Check', checks: { minLength: 50 } })
    if (type === 'if') Object.assign(data, { label: 'Make a Decision', operator: 'contains', value: '' })
    if (type === 'delay') Object.assign(data, { durationMs: 1000 })
    if (type === 'map') Object.assign(data, { model: 'policy:balanced', instruction: 'Process this item:\n\n{{item}}', maxItems: 25 })
    if (type === 'python') Object.assign(data, { code: 'import json, sys\n\ndata = json.load(sys.stdin)\nresult = {"output": data["input"]}\nprint(json.dumps(result, indent=2))\n', timeoutMs: 120000, codeMode: 'assisted', dependencies: [], allowPackageInstall: false })
    if (type === 'shell') Object.assign(data, { command: 'cat', timeoutMs: 120000 })
    if (type === 'json-transform') Object.assign(data, { selector: '', mode: 'select', pretty: true })
    if (type === 'read-file') Object.assign(data, { path: 'output.txt', encoding: 'utf8' })
    if (type === 'write-file') Object.assign(data, { path: 'output.txt', encoding: 'utf8' })
    if (type === 'http') Object.assign(data, { method: 'GET', url: '', timeoutMs: 30000, failOnError: true })
    if (type === 'human-approval') Object.assign(data, { message: 'Review the result before continuing', timeoutMs: 21600000 })
    if (type === 'file-input') Object.assign(data, { paths: '', readText: false, encoding: 'utf8' })
    if (type === 'folder-input') Object.assign(data, { path: '', extensions: 'pdf,md,txt', recursive: true, maxFiles: 500 })
    if (type === 'pdf-reader') Object.assign(data, { maxFiles: 50 })
    if (type === 'obsidian-read') Object.assign(data, { vaultPath: '~/AgentBrain', notePath: '20-Knowledge/' })
    if (type === 'obsidian-write') Object.assign(data, { vaultPath: '~/AgentBrain', notePath: '20-Knowledge/Workflow Outputs/result.md', append: false })
    if (type === 'subworkflow') Object.assign(data, { workflowId: '' })
    if (type === 'mcp') Object.assign(data, { server: '', tool: '', arguments: {}, timeoutMs: 60000 })
    const node = toRF({ id, type, position: position || { x: 140 + Math.random() * 240, y: 100 + Math.random() * 220 }, data }, contracts[type])
    const insertion = selectedEdge ? edges.find(edge => edge.id === selectedEdge) : null
    const insertionData = (insertion?.data || {}) as Record<string, any>, routeData = insertionData.condition ? { condition: insertionData.condition } : undefined
    const { condition: _condition, ...mappingData } = insertionData
    setNodes(ns => [...ns, node])
    if (insertion) setEdges(current => [...current.filter(edge => edge.id !== insertion.id), { id: `edge-${crypto.randomUUID().slice(0, 8)}`, source: insertion.source, target: id, sourceHandle: insertion.sourceHandle, targetHandle: (node.data as any).ports?.inputs?.[0]?.id, type: 'smoothstep', ...(routeData ? { data: routeData, label: routeData.condition === 'true' ? 'Yes' : 'No' } : {}) }, { id: `edge-${crypto.randomUUID().slice(0, 8)}`, source: id, target: insertion.target, sourceHandle: (node.data as any).ports?.outputs?.[0]?.id, targetHandle: insertion.targetHandle, type: 'smoothstep', ...(Object.keys(mappingData).length ? { data: mappingData } : {}) }])
    setSelectedNode(id); setSelectedEdge(''); setLayout(l => ({ ...l, right: true })); setInspectorTab('basic'); setNotice(insertion ? `${item.label} inserted into the selected connection.` : '')
    if (!['input', 'output'].includes(type)) setQuickSetupNode(id)
  }, [setNodes, setEdges, snapshot, contracts, selectedEdge, edges])

  const addCustomNode = (definition: any) => {
    if (definition.enabled === false) { setNotice(`${definition.name} is disabled.`); return }
    snapshot(); const id = `custom-${crypto.randomUUID().slice(0, 6)}`
    const node = toRF({ id, type: 'custom', position: { x: 180 + Math.random() * 220, y: 120 + Math.random() * 180 }, data: { label: definition.name, customNodeId: definition.id } }, contracts[`custom:${definition.id}`])
    setNodes(current => [...current, node]); setSelectedNode(id); setLayout(current => ({ ...current, right: true })); setInspectorTab('basic')
  }

  const addReusableComponent = (component: WorkflowComponent) => {
    try {
      snapshot()
      const id = `subworkflow-${crypto.randomUUID().slice(0, 6)}`
      const node = toRF({ id, type: 'subworkflow', position: { x: 180 + Math.random() * 220, y: 120 + Math.random() * 180 }, data: reusableComponentNodeData(component) }, contracts.subworkflow)
      setNodes(current => [...current, node]); setSelectedNode(id); setSelectedEdge(''); setLayout(current => ({ ...current, right: true })); setInspectorTab('basic')
      setNotice(`Inserted “${component.name}” pinned to ${component.currentVersionId}. Save this workflow to persist the reference.`)
    } catch (error) { setNotice(`Component could not be inserted: ${error}`) }
  }

  const renameComponent = async (component: WorkflowComponent) => {
    const nextName = window.prompt('Reusable component name', component.name)?.trim()
    if (!nextName || nextName === component.name) return
    try { await api.renameWorkflowComponent(component.id, nextName, component.description); await refresh(); setNotice(`Renamed reusable component to “${nextName}”. Existing pinned references remain unchanged.`) }
    catch (error) { setNotice(`Component could not be renamed: ${error}`) }
  }

  const archiveComponent = async (component: WorkflowComponent) => {
    if (!window.confirm(`Archive “${component.name}”? This is rejected while any parent workflow still references it.`)) return
    try { await api.archiveWorkflowComponent(component.id); await refresh(); setNotice(`Archived “${component.name}”. Its saved workflow and version history were retained.`) }
    catch (error) { setNotice(`Component could not be archived: ${error}`) }
  }

  const exportComponent = async (component: WorkflowComponent) => {
    try {
      const blob = await api.exportWorkflowComponent(component.id), url = URL.createObjectURL(blob), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `${component.id}.component.json`; anchor.click(); URL.revokeObjectURL(url)
      setNotice(`Exported “${component.name}” with its exact pinned dependency closure. Credentials, runs, and audit data are not included.`)
    } catch (error) { setNotice(`Component could not be exported: ${error}`) }
  }

  const stageComponentImport = async (file?: File) => {
    if (!file) return
    try {
      const proposal = await api.stageWorkflowComponentImport(JSON.parse(await file.text()))
      setComponentImport(proposal); setNotice('Import staged for review. Nothing has been installed or enabled.')
    } catch (error) { setComponentImport(null); setNotice(`Component import was rejected: ${error}`) }
    finally { if (componentImportRef.current) componentImportRef.current.value = '' }
  }

  const decideComponentImport = async (decision: 'approve' | 'reject') => {
    if (!componentImport) return
    try {
      await api.decideWorkflowComponentImport(componentImport.proposalId, decision); setComponentImport(null); await refresh()
      setNotice(decision === 'approve' ? 'Reviewed component closure installed in development. Existing components and production locks were not changed.' : 'Component import rejected. No definitions were written.')
    } catch (error) { setNotice(`Component import decision failed: ${error}`) }
  }

  const onConnect: OnConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return
    const source = nodes.find(n => n.id === c.source), target = nodes.find(n => n.id === c.target)
    if ((source?.data as any)?.ntype === 'output') return setNotice('Display Result cannot send data to another node.')
    if ((target?.data as any)?.ntype === 'input') return setNotice('Manual Start cannot receive a connection.')
    if (edges.some(e => e.source === c.source && e.target === c.target)) return setNotice('These nodes are already connected.')
    if (createsCycle(edges, c.source, c.target)) return setNotice('That connection would create a loop. Use a Critic Loop for bounded review cycles.')
    const sourcePorts: PortDefinition[] = (source?.data as any)?.ports?.outputs || [], targetPorts: PortDefinition[] = (target?.data as any)?.ports?.inputs || []
    const sourcePort = sourcePorts.find(port => port.id === c.sourceHandle) || sourcePorts[0], targetPort = targetPorts.find(port => port.id === c.targetHandle) || targetPorts[0]
    if (!clientPortsCompatible(sourcePort, targetPort)) return setNotice(`Cannot connect ${sourcePort?.label || 'this output'} (${sourcePort?.type || 'unknown'}) to ${targetPort?.label || 'this input'} (${targetPort?.type || 'unknown'}). Add ${converterSuggestion(sourcePort, targetPort)} between them.`)
    const sourceRoutes = edges.filter(e => e.source === c.source).map(e => (e.data as any)?.condition).filter(Boolean)
    const condition = (source?.data as any)?.ntype === 'if' ? (['true', 'false'].includes(String(c.sourceHandle)) ? String(c.sourceHandle) : sourceRoutes.includes('true') ? 'false' : 'true') : undefined
    snapshot(); setEdges(es => addEdge({ ...c, id: `edge-${crypto.randomUUID().slice(0, 8)}`, type: 'smoothstep', ...(condition ? { data: { condition }, label: condition === 'true' ? 'Yes' : 'No' } : {}) }, es)); setNotice('')
  }, [nodes, edges, setEdges, snapshot])

  const validate = useCallback(() => {
    const problems: string[] = []
    const raw = nodes.filter(n => (n.data as any).ntype !== '__group').map(fromRF)
    const sourceTypes = ['input', 'file-input', 'folder-input', 'obsidian-read']
    if (!raw.some(n => sourceTypes.includes(n.type))) problems.push('Add a Start or Input node.')
    if (!raw.some(n => n.type === 'output')) problems.push('Add a Display Result node.')
    const reachable = new Set<string>(), todo = raw.filter(n => sourceTypes.includes(n.type)).map(n => n.id)
    while (todo.length) { const id = todo.pop()!; if (reachable.has(id)) continue; reachable.add(id); edges.filter(e => e.source === id).forEach(e => todo.push(e.target)) }
    raw.filter(n => !sourceTypes.includes(n.type) && !reachable.has(n.id)).forEach(n => problems.push(`${n.data.label || n.id} is not connected to an input.`))
    raw.filter(n => ['agent', 'orchestrator', 'critic', 'map'].includes(n.type) && !n.data.model).forEach(n => problems.push(`${n.data.label || n.id} needs a model.`))
    raw.filter(n => n.type === 'python' && !String(n.data.code || '').trim()).forEach(n => problems.push(`${n.data.label || n.id} needs Python code.`))
    raw.filter(n => n.type === 'shell' && !String(n.data.command || '').trim()).forEach(n => problems.push(`${n.data.label || n.id} needs a shell command.`))
    raw.filter(n => n.type === 'http' && !/^https?:\/\//i.test(String(n.data.url || ''))).forEach(n => problems.push(`${n.data.label || n.id} needs an HTTP URL.`))
    raw.filter(n => n.type === 'mcp' && (!String(n.data.server || '').trim() || !String(n.data.tool || '').trim())).forEach(n => problems.push(`${n.data.label || n.id} needs an MCP server and tool.`))
    raw.filter(n => n.type === 'file-input' && !String(n.data.paths || '').trim()).forEach(n => problems.push(`${n.data.label || n.id} needs at least one file path.`))
    raw.filter(n => n.type === 'folder-input' && !String(n.data.path || '').trim()).forEach(n => problems.push(`${n.data.label || n.id} needs a folder path.`))
    raw.filter(n => ['obsidian-read', 'obsidian-write'].includes(n.type) && !String(n.data.notePath || '').trim()).forEach(n => problems.push(`${n.data.label || n.id} needs a note path.`))
    raw.filter(n => n.type === 'subworkflow' && !String(n.data.workflowId || '').trim()).forEach(n => problems.push(`${n.data.label || n.id} needs a child workflow.`))
    raw.filter(n => n.type === 'if').forEach(n => {
      const routes = edges.filter(e => e.source === n.id).map(e => (e.data as any)?.condition)
      if (!routes.includes('true') || !routes.includes('false')) problems.push(`${n.data.label || n.id} needs both a Yes and No connection.`)
    })
    if (!raw.some(n => n.type === 'output' && reachable.has(n.id))) problems.push('No result can be reached from the start.')
    return problems
  }, [nodes, edges])

  const save = useCallback(async () => {
    const saved = await api.saveWorkflow(makeWorkflow(wfId, name, nodes, edges, comments, environment, project, workflowSettings, workflowVariables))
    setWfId(saved.id); await refresh(); setNotice('Saved')
    window.setTimeout(() => setNotice(n => n === 'Saved' ? '' : n), 1800)
    return saved.id
  }, [wfId, name, nodes, edges, comments, environment, project, workflowSettings, workflowVariables, refresh])

  const applyDurableRunState = useCallback((detail: RunDetail) => {
    const approvals = Object.values(detail.control?.approvals || {})
    setDurableApprovals(approvals)
    setPaused(!!detail.control?.manualPause?.paused || !!detail.paused)
    setRunning(['running', 'paused'].includes(detail.status))
    const waiting = new Set(approvals.filter(item => item.state === 'pending').map(item => item.nodeId))
    if (detail.checkpoint?.nodes) setNodes(current => current.map(node => {
      const durable = detail.checkpoint?.nodes?.[node.id]
      if (!durable) return node
      const status = waiting.has(node.id) ? 'awaiting-approval' : durable.state === 'succeeded' ? 'succeeded' : durable.state === 'skipped' ? 'skipped' : ['failed', 'needs_review'].includes(durable.state) ? 'failed' : ['running', 'waiting'].includes(durable.state) ? 'running' : ''
      return { ...node, data: { ...node.data, status } }
    }))
  }, [setNodes])

  const run = useCallback(async (safe = false, inputOverride?: string, options?: { nodeId?: string; nodeIds?: string[]; runMode?: 'full' | 'selected' | 'from' | 'branch' }) => {
    const problems = validate()
    if (problems.length) { setNotice(`Cannot run: ${problems[0]}`); setBottomTab('errors'); setLayout(l => ({ ...l, bottom: true })); return }
    try {
      const savedId = await save()
      setEvents([]); setArtifacts([]); setDurableApprovals([]); setRunning(true); setPaused(false); setBottomTab('timeline'); setLayout(l => ({ ...l, bottom: true }))
      setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, status: '' } })))
      const started = await api.runWorkflow(savedId, inputOverride ?? input, profileId || undefined, safe, options)
      setRunId(started.runId)
      let activeRunId = started.runId
      subscribeWfRun(started.runId, ev => {
        setEvents(old => [...old, ev])
        void api.runDetail(activeRunId).then(applyDurableRunState).catch(() => {})
      }, async () => {
        await api.runDetail(activeRunId).then(applyDurableRunState).catch(() => { setRunning(false); setPaused(false) })
        api.artifacts().then(all => setArtifacts(all.filter(a => a.runId === activeRunId))).catch(() => {})
      }, (recoveredRunId, detail) => {
        activeRunId = recoveredRunId
        setRunId(recoveredRunId)
        applyDurableRunState(detail)
        setNotice(`Recovered durable run ${recoveredRunId.slice(-6)}`)
      })
    } catch (e) { setRunning(false); setNotice(`Run could not start: ${e}`) }
  }, [validate, save, input, profileId, setNodes, applyDurableRunState])

  const newWorkflow = () => {
    snapshot(); setWfId(''); setName('Untitled Workflow'); setProject('Command Center'); setEnvironment('development'); setWorkflowSettings({ localOnly: true, parallelism: 4, maxDuration: 21600000, retries: 1, cache: true, schedule: 'manual' }); setWorkflowVariables({}); setComments([])
    setNodes([toRF({ id: 'in', type: 'input', position: { x: 80, y: 160 }, data: { label: 'Your Request' } }, contracts.input), toRF({ id: 'out', type: 'output', position: { x: 620, y: 160 }, data: { label: 'Result' } }, contracts.output)])
    setEdges([]); setSelectedNode(''); setSelectedComment(''); setEvents([]); setNotice('New workflow — add a step between Start and Result.')
  }

  const deleteSelected = () => {
    if (selectedEdge) { snapshot(); setEdges(es => es.filter(e => e.id !== selectedEdge)); setSelectedEdge(''); return }
    if (!selectedNode) return
    const selectedItem = nodes.find(node => node.id === selectedNode)
    snapshot(); setNodes(current => {
      if ((selectedItem?.data as any)?.ntype !== '__group') return current.filter(node => node.id !== selectedNode)
      const directChildren = current.filter(node => node.parentId === selectedNode).map(node => node.id)
      const unwrapped = reparentPreservingAbsolute(current, directChildren, selectedItem?.parentId).filter(node => node.id !== selectedNode)
      return applyRecursiveVisibility(orderHierarchyNodes(unwrapped)) as Node[]
    }); setEdges(es => es.filter(e => e.source !== selectedNode && e.target !== selectedNode)); setSelectedNode('')
    if ((selectedItem?.data as any)?.ntype === '__group') setNotice('Section removed. Its direct contents were moved to the parent level without changing canvas position.')
  }

  const duplicateNode = (id: string) => {
    const original = nodes.find(n => n.id === id); if (!original) return
    snapshot(); const nextId = `${(original.data as any).ntype}-${crypto.randomUUID().slice(0, 6)}`
    setNodes(ns => [...ns, { ...original, id: nextId, position: { x: original.position.x + 28, y: original.position.y + 28 }, selected: false, data: { ...original.data, label: `${String(original.data.label || 'Node')} copy`, status: '' } }]); setSelectedNode(nextId); setSelectedEdge('')
  }

  const createGroup = () => {
    const selectedGroup = nodes.find(n => n.id === selectedNode && (n.data as any).ntype === '__group')
    const chosen = selectedGroup ? [] : nodes.filter(n => n.selected || n.id === selectedNode)
    if (!selectedGroup && !chosen.length) { setNotice('Select one or more workflow nodes or sections first.'); return }
    snapshot()
    const id = `group-${crypto.randomUUID().slice(0, 6)}`
    if (selectedGroup) {
      const group = groupToRF({ id, title: 'Nested section', description: 'Organize related workflow steps', parentGroupId: selectedGroup.id, order: nodes.filter(n => n.parentId === selectedGroup.id && (n.data as any).ntype === '__group').length, position: { x: 32, y: 72 }, width: 360, height: 220 })
      setNodes(current => applyRecursiveVisibility(orderHierarchyNodes([group, ...current])) as Node[])
      setSelectedNode(id); setNotice('Nested section created inside the selected section.'); return
    }
    const absolute = chosen.map(node => ({ node, point: absoluteCanvasPosition(nodes, node.id) }))
    const minX = Math.min(...absolute.map(item => item.point.x)), minY = Math.min(...absolute.map(item => item.point.y))
    const maxX = Math.max(...absolute.map(item => item.point.x + Number(item.node.measured?.width || item.node.width || 250)))
    const maxY = Math.max(...absolute.map(item => item.point.y + Number(item.node.measured?.height || item.node.height || 150)))
    const commonParent = chosen.every(node => node.parentId === chosen[0].parentId) ? chosen[0].parentId : undefined
    const parentPosition = commonParent ? absoluteCanvasPosition(nodes, commonParent) : { x: 0, y: 0 }
    const group = groupToRF({ id, title: 'New section', description: 'Organize related workflow steps', parentGroupId: commonParent || null, order: nodes.filter(n => n.parentId === commonParent && (n.data as any).ntype === '__group').length, position: { x: minX - parentPosition.x - 36, y: minY - parentPosition.y - 72 }, width: Math.max(360, maxX - minX + 72), height: Math.max(240, maxY - minY + 108) })
    setNodes(current => {
      const withGroup = [group, ...current]
      const moved = reparentPreservingAbsolute(withGroup, chosen.map(node => node.id), id).map(node => chosen.some(child => child.id === node.id) ? { ...node, extent: 'parent' as const, selected: false } : node)
      return applyRecursiveVisibility(orderHierarchyNodes(moved)) as Node[]
    })
    setSelectedNode(id); setNotice(commonParent ? 'Nested section created around the selected items.' : 'Section created. It persists with the canonical workflow.')
  }

  const toggleSelectedGroup = () => {
    const group = nodes.find(n => n.id === selectedNode && (n.data as any).ntype === '__group')
    if (!group) return
    const collapsed = !(group.data as any).collapsed; snapshot()
    setNodes(current => applyRecursiveVisibility(current.map(node => node.id === group.id ? { ...node, data: { ...node.data, collapsed } } : node)) as Node[])
    setNotice(collapsed ? 'Section collapsed. All descendants are hidden on the canvas but remain persisted and executable.' : 'Section expanded. Descendants of any still-collapsed nested section remain hidden.')
  }

  const moveSelectionToGroup = () => {
    const selectedIds = nodes.filter(node => node.selected || node.id === selectedNode).map(node => node.id)
    if (!selectedIds.length) { setNotice('Select one or more workflow nodes or sections first.'); return }
    const destinations = nodes.filter(node => (node.data as any).ntype === '__group' && !selectedIds.includes(node.id))
    const choice = window.prompt(`Move selection into which section? Enter an ID, or leave blank for canvas root.\n${destinations.map(node => `${node.id} — ${String(node.data.label || 'Section')}`).join('\n')}`, '')
    if (choice === null) return
    const targetId = choice.trim() || undefined
    const error = validateReparent(nodes, selectedIds, targetId)
    if (error) { setNotice(error); return }
    snapshot()
    setNodes(current => applyRecursiveVisibility(orderHierarchyNodes(reparentPreservingAbsolute(current, selectedIds, targetId).map(node => selectedIds.includes(node.id) ? { ...node, ...(targetId ? { extent: 'parent' as const } : { extent: undefined }), selected: false } : node))) as Node[])
    setNotice(targetId ? `Selection moved into ${String(nodes.find(node => node.id === targetId)?.data.label || targetId)} without changing its canvas position.` : 'Selection moved to the canvas root without changing its canvas position.')
  }

  const toggleSelectedGroupDisabled = () => {
    const group = nodes.find(node => node.id === selectedNode && (node.data as any).ntype === '__group')
    if (!group) return
    const disabled = !(group.data as any).disabled
    snapshot(); setNodes(current => applyRecursiveVisibility(current.map(node => node.id === group.id ? { ...node, data: { ...node.data, disabled } } : node)) as Node[])
    setNotice(disabled ? 'Section disabled. Its recursive steps will be skipped and produce no output; downstream steps need an alternate input path.' : 'Section enabled. Its recursive steps will run normally unless a parent section is still disabled.')
  }

  const runSelectedGroup = () => {
    const group = nodes.find(node => node.id === selectedNode && (node.data as any).ntype === '__group')
    if (!group) return
    const nodeIds = recursiveMemberNodeIds(nodes, group.id)
    if (!nodeIds.length) { setNotice('This section has no executable steps to run.'); return }
    run(false, undefined, { nodeIds, runMode: 'selected' })
  }

  const extractSubworkflow = async () => {
    const chosen = nodes.filter(n => (n.selected || n.id === selectedNode) && (n.data as any).ntype !== '__group')
    if (!chosen.length) { setNotice('Select one or more workflow nodes first.'); return }
    const ids = new Set(chosen.map(n => n.id))
    if (chosen.some(n => ['input', 'output'].includes(String((n.data as any).ntype)))) { setNotice('Select processing steps only; keep the parent Start and Result nodes.'); return }
    const title = window.prompt('Reusable subworkflow name', `${String(chosen[0].data.label || 'Reusable')} component`)?.trim()
    if (!title) return
    snapshot()
    try {
      const childId = `wf-${crypto.randomUUID().slice(0, 10)}`, inId = 'sub-input', outId = 'sub-output'
      const minX = Math.min(...chosen.map(n => n.position.x)), minY = Math.min(...chosen.map(n => n.position.y))
      const internal = edges.filter(e => ids.has(e.source) && ids.has(e.target))
      const roots = chosen.filter(n => !internal.some(e => e.target === n.id))
      const leaves = chosen.filter(n => !internal.some(e => e.source === n.id))
      const childNodes = chosen.map(n => fromRF({ ...n, parentId: undefined, position: { x: n.position.x - minX + 280, y: n.position.y - minY + 80 } } as Node))
      const farthest = Math.max(...childNodes.map(n => n.position.x)) + 320
      const child: Workflow = { schemaVersion: 2, id: childId, name: title, metadata: { name: title, project, component: { reusable: true, archived: false, description: `Extracted reusable component from ${name}`, sourceWorkflowId: wfId || null } }, project, environment, settings: { ...workflowSettings }, variables: {}, nodes: [{ id: inId, type: 'input', position: { x: 40, y: 120 }, data: { label: 'Subworkflow input' } }, ...childNodes, { id: outId, type: 'output', position: { x: farthest, y: 120 }, data: { label: 'Subworkflow result' } }], edges: [...internal.map(e => ({ id: e.id, source: e.source, target: e.target, data: e.data as any })), ...roots.map((n, i) => ({ id: `sub-in-${i}`, source: inId, target: n.id })), ...leaves.map((n, i) => ({ id: `sub-out-${i}`, source: n.id, target: outId }))] }
      await api.saveWorkflow(child)
      const childVersions = await api.workflowVersions(childId)
      const savedVersion = currentWorkflowVersion(childVersions)
      const incoming = edges.filter(e => !ids.has(e.source) && ids.has(e.target)), outgoing = edges.filter(e => ids.has(e.source) && !ids.has(e.target))
      const replacement = toRF({ id: `subworkflow-${crypto.randomUUID().slice(0, 6)}`, type: 'subworkflow', position: { x: minX, y: minY }, data: extractedSubworkflowData(title, childId, savedVersion) }, contracts.subworkflow)
      setNodes(current => [...current.filter(n => !ids.has(n.id)), replacement])
      setEdges(current => [...current.filter(e => !ids.has(e.source) && !ids.has(e.target)), ...incoming.map((e, i) => ({ ...e, id: `sub-parent-in-${i}`, target: replacement.id, targetHandle: 'input' })), ...outgoing.map((e, i) => ({ ...e, id: `sub-parent-out-${i}`, source: replacement.id, sourceHandle: 'output' }))])
      setSelectedNode(replacement.id); await refresh(); setNotice(`Created reusable subworkflow “${title}” pinned to ${savedVersion.id}.`)
    } catch (error) { setNotice(`Subworkflow could not be created: ${error}`) }
  }

  const architectCommand = async (rawCommand: string) => {
    const command = rawCommand.trim(); if (!command) return
    setArchitectBusy(true); setArchitectReply(''); setProposal(null)
    try {
      if (!nodes.length || /^(build|create|design)\b/i.test(command) && nodes.length <= 2) {
        const w = await api.generateWorkflow(command)
        setArchitectReply('I designed a workflow proposal. Review it before applying it to the canvas.'); setProposal(w)
      } else {
        const result = await api.architect(command, makeWorkflow(wfId, name, nodes, edges, comments, environment, project, workflowSettings, workflowVariables), selectedNode || null)
        setArchitectReply(result.reply); setProposal(result.workflow || null)
      }
    } catch (e) { setArchitectReply(`I could not complete that request: ${e}`) }
    setArchitectBusy(false)
  }
  const architect = () => architectCommand(architectInput)

  const createTrigger = async () => {
    try {
      const savedId = wfId || await save()
      const type = window.prompt('Trigger type: interval, cron, webhook, or folder', 'interval')?.trim().toLowerCase() as 'interval' | 'cron' | 'webhook' | 'folder' | undefined
      if (!type || !['interval', 'cron', 'webhook', 'folder'].includes(type)) return
      let config: Record<string, unknown> = {}
      if (type === 'interval') config = { intervalMs: Math.max(1000, Number(window.prompt('Interval in milliseconds', '60000') || 60000)), input }
      if (type === 'cron') config = { cron: window.prompt('Five-field cron expression', '0 9 * * *') || '0 9 * * *', input }
      if (type === 'folder') config = { path: window.prompt('Absolute folder path to watch', '') || '', pollMs: 3000 }
      const created = await api.createWorkflowTrigger(savedId, type, config)
      if (type === 'webhook') {
        setWebhookDisclosure({ endpoint: created.webhookEndpoint, token: created.webhookToken })
        setNotice('Webhook created. Its credential is shown once in the secure disclosure card.')
      } else setNotice(`${type} trigger created and enabled.`)
    } catch (error) { setNotice(`Trigger could not be created: ${error}`) }
  }
  const openChildWorkflow = async (childId: string) => { if (!childId) return; setWorkflowBreadcrumbs(items => [...items, { id: wfId, name }]); await load(childId) }
  const openParentWorkflow = async () => { const parent = workflowBreadcrumbs[workflowBreadcrumbs.length - 1]; if (!parent) return; setWorkflowBreadcrumbs(items => items.slice(0, -1)); await load(parent.id) }

  const applyProposal = () => {
    if (!proposal) return
    snapshot(); setName(proposal.name || name); setWorkflowSettings(s => ({ ...s, ...(proposal.settings || {}) })); if (proposal.variables) setWorkflowVariables(proposal.variables); if (proposal.comments) setComments(proposal.comments); setNodes(applyRecursiveVisibility(orderHierarchyNodes([...(proposal.groups || []).map(groupToRF), ...proposal.nodes.map(n => toRF(n, contracts[n.type === 'custom' ? `custom:${n.data.customNodeId}` : n.type]))])) as Node[]); setEdges(proposal.edges.map(e => ({ ...e, ...(e.data?.condition ? { label: e.data.condition === 'true' ? 'Yes' : 'No' } : {}) })) as Edge[]); setProposal(null); setArchitectReply('Applied. You can undo this change.'); setTimeout(() => rf?.fitView({ padding: .2, duration: 300 }), 50)
  }

  const executeCommand = () => {
    const q = architectInput.trim().toLowerCase()
    if (!q) return
    if (q.includes('validate')) { const p = validate(); setNotice(p.length ? p.join(' ') : 'Validation passed — ready to run.'); return }
    if (q.includes('fit')) { rf?.fitView({ padding: .2, duration: 300 }); return }
    if (q.includes('local model')) { snapshot(); setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, model: ['agent', 'orchestrator', 'critic'].includes((n.data as any).ntype) ? 'policy:local' : (n.data as any).model } }))); setNotice('Agent model policies changed to Local only.'); return }
    setLayout(l => ({ ...l, architect: true })); architect()
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !typing && selectedNode) { e.preventDefault(); run(false, undefined, { nodeId: selectedNode, runMode: 'selected' }) }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if (e.key === 'Delete' && !typing) deleteSelected()
      else if (!typing && e.key.toLowerCase() === 'f') rf?.fitView({ padding: .2, duration: 300 })
      else if (!typing && e.key.toLowerCase() === 'r') { e.preventDefault(); e.shiftKey ? run(true) : run(false) }
      else if (!typing && e.key.toLowerCase() === 'a') setLayout(l => ({ ...l, architect: !l.architect }))
      else if (!typing && e.key === '/') { e.preventDefault(); setLayout(l => ({ ...l, left: true })); window.setTimeout(() => (document.querySelector('.library-search input') as HTMLInputElement | null)?.focus(), 0) }
      else if (!typing && e.key.toLowerCase() === 'e' && selectedNode) { setArchitectInput(`Explain ${String(nodes.find(node => node.id === selectedNode)?.data.label || 'this node')}`); setLayout(l => ({ ...l, architect: true })) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [save, undo, redo, rf, run, selectedNode, selectedEdge])

  const query = search.toLowerCase().trim()
  const visibleCatalog = useMemo(() => CATALOG.filter(i => !query || `${i.label} ${i.description} ${i.keywords.join(' ')}`.toLowerCase().includes(query)), [query])
  const eventErrors = events.filter(e => e.type === 'error')
  const proposalDiff = useMemo(() => {
    if (!proposal) return []
    const before = new Map(nodes.map(n => [n.id, n]))
    const after = new Map(proposal.nodes.map(n => [n.id, n]))
    const lines: string[] = []
    for (const n of proposal.nodes) {
      const old = before.get(n.id)
      if (!old) lines.push(`+ Added ${n.data?.label || n.id}`)
      else if ((old.data as any).ntype !== n.type || JSON.stringify(fromRF(old).data) !== JSON.stringify(n.data)) lines.push(`~ Updated ${n.data?.label || n.id}`)
    }
    for (const n of nodes) if (!after.has(n.id)) lines.push(`− Removed ${String(n.data.label || n.id)}`)
    const edgeDelta = proposal.edges.length - edges.length
    if (edgeDelta) lines.push(`${edgeDelta > 0 ? '+' : '−'} ${Math.abs(edgeDelta)} connection${Math.abs(edgeDelta) === 1 ? '' : 's'}`)
    return lines.slice(0, 12)
  }, [proposal, nodes, edges])
  const className = `workflow-studio-v2 ${fullscreen ? 'studio-fullscreen' : ''} mode-${mode}`

  return (
    <div className={className}>
      <header className="studio-commandbar">
        <div className="studio-crumbs">
          <select aria-label="Workspace" title="Workspace"><option>Kedabek Technology Labs</option><option>Personal Sandbox</option></select>
          <span>/</span><input aria-label="Project" value={project} onChange={e => setProject(e.target.value)} title="Project" />
          <span>/</span><select aria-label="Workflow" value={wfId} onChange={e => load(e.target.value)}><option value="">Unsaved workflow</option>{list.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </div>
        <div className="studio-global-command">
          <span>✦</span><input aria-label="AI Architect command" value={architectInput} onChange={e => setArchitectInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && executeCommand()} placeholder="Ask AI Architect or search commands…" />
        </div>
        <div className="studio-mode-switch" aria-label="Complexity mode">{(['easy', 'guided', 'pro', 'developer'] as Mode[]).map(m => <button key={m} className={mode === m ? 'active' : ''} onClick={() => onModeChange(m)}>{m}</button>)}</div>
        <div className="studio-actions">
          <select aria-label="Environment" className={`environment env-${environment}`} value={environment} onChange={e => setEnvironment(e.target.value)} title="Environment"><option value="development">Development</option><option value="testing">Testing</option><option value="production">Production</option></select>
          <button title="Undo (⌘Z)" disabled={!past.length} onClick={undo}>↶</button><button title="Redo (⌘⇧Z)" disabled={!future.length} onClick={redo}>↷</button>
          <button onClick={() => { const p = validate(); setNotice(p.length ? p.join(' ') : 'Validation passed — ready to run.') }}>Validate</button>
          <button onClick={() => run(true)} disabled={running}>Safe Test</button><button onClick={save}>Save</button>
          {running ? <><button onClick={() => { paused ? api.resumeRun(runId) : api.pauseRun(runId); setPaused(!paused) }}>{paused ? 'Resume' : 'Pause'}</button><button className="danger" onClick={() => api.stopRun(runId)}>Stop</button></> : <div className="run-split"><button className="run" onClick={() => run(false)}>Run</button><details><summary aria-label="More run options">⌄</summary><div><button onClick={() => run(false)}>Run normally</button><button onClick={() => run(true, input || 'Sample workflow input')}>Run with sample data</button><button onClick={() => run(true)}>Run with safe limits</button><button onClick={() => run(false)}>Run with breakpoints</button><button disabled={!selectedNode} title={selectedNode ? 'Run the selected branch and its dependencies' : 'Select a node first'} onClick={() => selectedNode && run(false, undefined, { nodeId: selectedNode, runMode: 'branch' })}>Run selected branch</button><button onClick={createTrigger}>Schedule or trigger run</button></div></details></div>}
        </div>
      </header>

      {notice && <div className="studio-notice"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}

      <div className="studio-workspace" style={{ gridTemplateColumns: `${layout.left ? layout.leftWidth : 42}px minmax(320px, 1fr) ${layout.right ? layout.rightWidth : 42}px` }}>
        <aside className={`node-library ${layout.left ? '' : 'collapsed'}`}>
          <button className="panel-collapse" onClick={() => setLayout(l => ({ ...l, left: !l.left }))} title={layout.left ? 'Collapse Node Library' : 'Open Node Library'}>{layout.left ? '‹' : '›'}</button>
          {layout.left ? <>
            <div className="panel-heading"><div><span className="eyebrow">BUILD</span><h2>Node Library</h2></div></div>
            <div className="library-tabs"><button className={libraryTab === 'nodes' ? 'active' : ''} onClick={() => setLibraryTab('nodes')}>Nodes</button><button className={libraryTab === 'templates' ? 'active' : ''} onClick={() => setLibraryTab('templates')}>Templates</button><button className={libraryTab === 'reusable' ? 'active' : ''} onClick={() => setLibraryTab('reusable')}>Reusable</button><button className={libraryTab === 'custom' ? 'active' : ''} onClick={() => setLibraryTab('custom')}>My Nodes</button></div>
            {libraryTab === 'nodes' ? <>
              <div className="library-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or purpose" /></div>
              <div className="library-scroll">
                {Object.keys(CATEGORY_META).map(category => {
                  const items = visibleCatalog.filter(i => i.category === category); if (!items.length) return null
                  return <section className="node-category" key={category}><h3><span>{CATEGORY_META[category].glyph}</span>{category}</h3>{items.map(item => <button key={item.type} className={`library-node tone-${CATEGORY_META[category].tone} ${item.available ? '' : 'planned'}`} draggable={item.available} onDragStart={e => { e.dataTransfer.setData('application/cc-node', item.type); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => addNode(item.type)} title={item.available ? `Add ${item.label}` : `${item.label} — planned capability`}><span className="library-node-icon">{item.glyph}</span><span><b>{item.label}</b><small>{item.description}</small></span>{!item.available && <em>PLANNED</em>}</button>)}</section>
                })}
                {!visibleCatalog.length && <div className="library-empty">No node matches that purpose.</div>}
              </div>
            </> : libraryTab === 'templates' ? <TemplateLibrary onUse={async id => { const t = await api.template(id); const saved = await api.saveWorkflow({ ...t.workflow, id: '', name: t.title }); await refresh(); load(saved.id) }} /> : libraryTab === 'reusable' ? <div className="library-scroll custom-node-library">
              <button className="custom-node-create" onClick={() => componentImportRef.current?.click()}>⇩ Import reviewed component manifest</button>
              <input ref={componentImportRef} type="file" accept="application/json,.json" hidden onChange={event => stageComponentImport(event.target.files?.[0])} />
              {componentImport && <div className="component-import-review"><b>Import review required</b><span>{componentImport.review.componentCount} component{componentImport.review.componentCount === 1 ? '' : 's'} · {componentImport.review.dependencyCount} exact dependencies · {componentImport.review.executableNodes} executable nodes</span>{componentImport.review.conflicts.map(conflict => <small key={`${conflict.componentId}-${conflict.type}`}>{conflict.componentId}: {conflict.message}</small>)}<em>Staging made no workflow changes. Approval installs only new IDs in development; replacement is unavailable.</em><div><button disabled={!componentImport.review.approvable} onClick={() => decideComponentImport('approve')}>Approve import</button><button onClick={() => decideComponentImport('reject')}>Reject</button></div></div>}
              {workflowComponents.map(component => <div className={`library-node tone-knowledge ${component.available ? '' : 'planned'}`} key={component.id}><span className="library-node-icon">▣</span><span><b>{component.name}</b><small>{component.available ? `${component.nodeCount} nodes · ${component.description || 'Reusable workflow component'}` : component.unavailableReason}</small><span className="component-actions"><button disabled={!component.available} onClick={() => addReusableComponent(component)}>Insert</button><button onClick={() => openChildWorkflow(component.id)}>Open</button><button disabled={!component.available} onClick={() => exportComponent(component)}>Export</button><button disabled={component.archived} onClick={() => renameComponent(component)}>Rename</button><button disabled={component.archived} onClick={() => archiveComponent(component)}>Archive</button></span></span><em>{component.currentVersionHash || 'UNAVAILABLE'}</em></div>)}
              {!workflowComponents.length && <div className="library-empty">No reusable components yet. Select workflow steps and choose Make subworkflow.</div>}
            </div> : <div className="library-scroll custom-node-library"><button className="custom-node-create" onClick={() => setCustomWizard(true)}>＋ Create a custom node</button>{customNodes.map(definition => <button key={definition.id} className={`library-node tone-code ${definition.enabled === false ? 'planned' : ''}`} onClick={() => addCustomNode(definition)}><span className="library-node-icon">{definition.icon || '◇'}</span><span><b>{definition.name}</b><small>{definition.description || `${definition.implementation?.kind} implementation`}</small></span><em>v{definition.version}</em></button>)}</div>}
            <div className="library-legend"><span><i className="ready-dot" />Executable now</span><span><i className="planned-dot" />Planned runtime</span></div>
          </> : <div className="vertical-label">NODE LIBRARY</div>}
          {layout.left && <div className="panel-resizer panel-resizer-left" onPointerDown={e => startResize('left', e)} />}
        </aside>

        <main className="studio-canvas-region">
          <div className="canvas-titlebar">
            <div><input aria-label="Workflow title" value={name} onChange={e => setName(e.target.value)} /><span>{nodes.filter(node => (node.data as any).ntype !== '__group').length} executable nodes · {edges.length} connections · {comments.length} review comments</span></div>
            <div className="canvas-view-actions">
              {mode === 'guided' && <button className={guidedOpen ? 'active' : ''} onClick={() => setGuidedOpen(!guidedOpen)}>Guided setup</button>}
              {mode === 'easy' && <button className={simpleView ? 'active' : ''} onClick={() => setSimpleView(!simpleView)}>{simpleView ? 'Show full workflow' : 'Show simple view'}</button>}
              {!simpleView && <button title={selectedNode ? 'Adds a non-executable review comment anchored to the selected item' : 'Adds a non-executable review comment to the canvas'} onClick={createComment}>＋ Comment</button>}
              {!simpleView && comments.some(comment => comment.resolved) && <button className={showResolvedComments ? 'active' : ''} onClick={() => { setShowResolvedComments(value => !value); setSelectedComment('') }}>{showResolvedComments ? 'Hide resolved' : 'Show resolved'}</button>}
              <button onClick={() => { snapshot(); setNodes(ns => autoLayout(ns, edges)); setTimeout(() => rf?.fitView({ padding: .2, duration: 300 }), 50) }}>Auto-layout</button>
              <button onClick={createGroup}>Group selection</button>
              <button onClick={moveSelectionToGroup}>Move selection</button>
              <button onClick={extractSubworkflow}>Make subworkflow</button>
              {selectedData?.ntype === '__group' && <><button onClick={toggleSelectedGroup}>{selectedData.collapsed ? 'Expand section' : 'Collapse section'}</button><button disabled={selectedData.disabled || selectedData.ancestorDisabled} title={selectedData.disabled || selectedData.ancestorDisabled ? 'Enable this section and any disabled parent before running it' : 'Runs exactly the executable steps in this section and all nested sections'} onClick={runSelectedGroup}>Run section</button><button title="Disabled section steps are skipped and produce no output" onClick={toggleSelectedGroupDisabled}>{selectedData.disabled ? 'Enable section' : 'Disable section'}</button></>}
              {workflowBreadcrumbs.length > 0 && <button onClick={openParentWorkflow}>← {workflowBreadcrumbs[workflowBreadcrumbs.length - 1].name}</button>}
              {selectedData?.ntype === 'subworkflow' && <button onClick={() => openChildWorkflow(selectedData.workflowId)}>Open child workflow</button>}
              <button onClick={() => rf?.fitView({ padding: .2, duration: 300 })}>Fit</button>
              <button onClick={() => setFullscreen(!fullscreen)}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
              <button className={layout.architect ? 'architect-on' : ''} onClick={() => setLayout(l => ({ ...l, architect: !l.architect }))}>✦ Architect</button>
            </div>
          </div>
          {simpleView ? <><SimpleWorkflow nodes={nodes} edges={edges} onOpen={() => setSimpleView(false)} />{!!comments.length && <div className="simple-comment-notice">{comments.filter(comment => !comment.resolved).length} open review comment{comments.filter(comment => !comment.resolved).length === 1 ? '' : 's'} · Show full workflow to review annotations.</div>}</> : <div className="studio-canvas" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }} onDrop={e => { e.preventDefault(); const type = e.dataTransfer.getData('application/cc-node'); if (type && rf) addNode(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })) }}>
            <ReactFlow nodes={[...nodes, ...commentNodes]} edges={edges} nodeTypes={nodeTypes} onNodesChange={handleCanvasNodesChange} onEdgesChange={onEdgesChange} onNodeDragStart={snapshot} onConnect={onConnect} onInit={setRf} onPaneClick={() => { setSelectedNode(''); setSelectedEdge(''); setSelectedComment(''); setContextMenu(null) }} onNodeClick={(_e, n) => { if ((n.data as any).ntype === '__comment') { setSelectedComment(n.id); setSelectedNode(''); setSelectedEdge('') } else { setSelectedNode(n.id); setSelectedComment(''); setSelectedEdge('') }; setContextMenu(null); setLayout(l => ({ ...l, right: true })) }} onEdgeClick={(_e, edge) => { setSelectedEdge(edge.id); setSelectedNode(''); setSelectedComment(''); setContextMenu(null); setLayout(l => ({ ...l, right: true })) }} onNodeContextMenu={(e, n) => { e.preventDefault(); if ((n.data as any).ntype === '__comment') { setSelectedComment(n.id); setSelectedNode(''); setSelectedEdge(''); setContextMenu(null); setLayout(l => ({ ...l, right: true })); return }; setSelectedNode(n.id); setSelectedComment(''); setSelectedEdge(''); setContextMenu({ x: e.clientX, y: e.clientY, kind: 'node', id: n.id }) }} onEdgeContextMenu={(e, edge) => { e.preventDefault(); setSelectedEdge(edge.id); setSelectedNode(''); setSelectedComment(''); setContextMenu({ x: e.clientX, y: e.clientY, kind: 'edge', id: edge.id }) }} onPaneContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, kind: 'canvas' }) }} fitView snapToGrid snapGrid={[16, 16]} colorMode="dark" proOptions={{ hideAttribution: true }} deleteKeyCode={null} connectionLineStyle={{ stroke: '#8b7cf6', strokeWidth: 2 }}>
              <Background variant={mode === 'developer' ? undefined : 'dots' as any} color="#293344" gap={20} size={1.2} />
              <Controls position="bottom-left" />
              {mode !== 'easy' && <MiniMap pannable zoomable nodeColor={n => `var(--node-${EXEC_META[(n.data as any).ntype]?.tone || 'agent'})`} maskColor="rgba(5,8,13,.72)" />}
            </ReactFlow>
            {!nodes.length && <div className="canvas-empty"><span>✦</span><h3>What would you like to build?</h3><p>Describe the outcome to the AI Architect, or drag a node here.</p><button onClick={() => setLayout(l => ({ ...l, architect: true }))}>Build with AI Architect</button></div>}
            {guidedOpen && <GuidedBuilder onClose={() => setGuidedOpen(false)} onBuild={goal => { setArchitectInput(goal); setLayout(l => ({ ...l, architect: true })); setGuidedOpen(false); architectCommand(goal) }} />}
            {customWizard && <CustomNodeWizard onClose={() => setCustomWizard(false)} onSaved={async definition => { await refresh(); setCustomWizard(false); addCustomNode(definition) }} />}
            {quickSetupNode && nodes.find(n => n.id === quickSetupNode) && <QuickSetupCard node={nodes.find(n => n.id === quickSetupNode)!} models={models} patch={patch => setNodes(ns => ns.map(n => n.id === quickSetupNode ? { ...n, data: { ...n.data, ...patch } } : n))} close={() => setQuickSetupNode('')} />}
          </div>}
        </main>

        <aside className={`node-inspector ${layout.right ? '' : 'collapsed'}`}>
          <button className="panel-collapse right" onClick={() => setLayout(l => ({ ...l, right: !l.right }))} title={layout.right ? 'Collapse Inspector' : 'Open Inspector'}>{layout.right ? '›' : '‹'}</button>
          {layout.right ? (chosenComment ? <CommentInspector comment={chosenComment} targets={commentTargets} onEdit={() => editComment(chosenComment)} onToggle={() => toggleCommentResolved(chosenComment)} onAnchor={value => setCommentAnchor(chosenComment, value)} onDelete={() => deleteComment(chosenComment)} /> : selected || chosenEdge ? <Inspector node={selected} edge={chosenEdge} nodes={nodes} models={models} skills={skills} mode={mode} tab={inspectorTab} setTab={setInspectorTab} patch={patchSelected} remove={deleteSelected} input={input} snapshot={snapshot} setEdges={setEdges} openCode={() => setCodeFullscreen(true)} workflowId={wfId} onRestore={() => wfId && load(wfId)} /> : <WorkflowSettingsPanel workflowId={wfId} name={name} setName={setName} project={project} setProject={setProject} environment={environment} settings={workflowSettings} setSettings={setWorkflowSettings} variables={workflowVariables} setVariables={setWorkflowVariables} mode={mode} />) : <div className="vertical-label">INSPECTOR</div>}
          {layout.right && <div className="panel-resizer panel-resizer-right" onPointerDown={e => startResize('right', e)} />}
        </aside>
      </div>

      <BottomPanel open={layout.bottom} height={layout.bottomHeight} tab={bottomTab} setTab={setBottomTab} toggle={() => setLayout(l => ({ ...l, bottom: !l.bottom }))} onResize={e => startResize('bottom', e)} events={events} nodes={nodes} input={input} setInput={setInput} artifacts={artifacts} sys={sys} running={running} paused={paused} approvals={durableApprovals} errors={eventErrors} profileId={profileId} setProfileId={setProfileId} profiles={profiles} runId={runId} variables={workflowVariables} setVariables={setWorkflowVariables} />

      {layout.architect && <ArchitectDock input={architectInput} setInput={setArchitectInput} busy={architectBusy} reply={architectReply} proposal={proposal} diff={proposalDiff} selected={selectedData?.label} onSend={architect} onApply={applyProposal} onReject={() => { setProposal(null); setArchitectReply('Proposal discarded. Nothing changed.') }} onClose={() => setLayout(l => ({ ...l, architect: false }))} />}
      {codeFullscreen && selectedData?.ntype === 'python' && <PythonWorkspace data={selectedData} onSave={patch => { patchSelected(patch); setCodeFullscreen(false) }} onTest={() => run(true)} onClose={() => setCodeFullscreen(false)} />}
      {contextMenu && <StudioContextMenu state={contextMenu} node={contextMenu.kind === 'node' ? nodes.find(n => n.id === contextMenu.id) : undefined} close={() => setContextMenu(null)} actions={{ runNode: () => contextMenu.id && run(false, undefined, { nodeId: contextMenu.id, runMode: 'selected' }), runFrom: () => contextMenu.id && run(false, undefined, { nodeId: contextMenu.id, runMode: 'from' }), inspect: () => setLayout(l => ({ ...l, right: true })), test: () => { setInspectorTab('testing'); setLayout(l => ({ ...l, right: true })) }, duplicate: () => contextMenu.id && duplicateNode(contextMenu.id), toggleDisabled: () => { if (!contextMenu.id) return; snapshot(); setNodes(ns => applyRecursiveVisibility(ns.map(n => n.id === contextMenu.id ? { ...n, data: { ...n.data, disabled: !(n.data as any).disabled } } : n)) as Node[]); if ((nodes.find(n => n.id === contextMenu.id)?.data as any)?.ntype === '__group') setNotice('Section disabled state updated recursively. Disabled steps are skipped and produce no output.') }, breakpoint: () => { if (!contextMenu.id) return; snapshot(); setNodes(ns => ns.map(n => n.id === contextMenu.id ? { ...n, data: { ...n.data, breakpoint: !(n.data as any).breakpoint } } : n)) }, remove: deleteSelected, architect: () => setLayout(l => ({ ...l, architect: true })), addNode: () => { setLayout(l => ({ ...l, left: true })); setSearch('') }, autoLayout: () => { snapshot(); setNodes(ns => autoLayout(ns, edges)); setTimeout(() => rf?.fitView({ padding: .2, duration: 300 }), 50) }, fit: () => rf?.fitView({ padding: .2, duration: 300 }), mapping: () => setLayout(l => ({ ...l, right: true })) }} />}
      {webhookDisclosure && <WebhookCredentialDisclosure credential={webhookDisclosure} onDismiss={() => setWebhookDisclosure(null)} />}

      <input ref={fileRef} type="file" hidden />
      <div className="studio-layout-menu">
        <select aria-label="Saved workspace layouts" value="" onChange={e => { const saved = savedLayouts.find(x => x.name === e.target.value); if (saved) setLayout(saved.value) }}><option value="">Layouts</option>{savedLayouts.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}</select>
        <button onClick={() => { const name = window.prompt('Name this workspace layout'); if (name?.trim()) setSavedLayouts(xs => [...xs.filter(x => x.name !== name.trim()), { name: name.trim(), value: layout }]) }}>Save layout</button>
        <button title="Restore the default workspace layout" onClick={() => setLayout(DEFAULT_LAYOUT)}>Reset</button>
      </div>
    </div>
  )
}

function TemplateLibrary({ onUse }: { onUse: (id: string) => void }) {
  const [items, setItems] = useState<any[]>([])
  useEffect(() => { api.templates().then(setItems).catch(() => {}) }, [])
  return <div className="library-scroll template-library">{items.map(t => <button key={t.id} onClick={() => onUse(t.id)}><span>✦</span><span><b>{t.title}</b><small>{t.produces} · {t.nodeCount} steps</small></span></button>)}</div>
}

function CustomNodeWizard({ onClose, onSaved }: { onClose: () => void; onSaved: (definition: any) => void }) {
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [kind, setKind] = useState('transform'), [inputType, setInputType] = useState('any'), [outputType, setOutputType] = useState('any'), [implementation, setImplementation] = useState('')
  const saveDefinition = async () => {
    setBusy(true); setError('')
    try {
      const config = kind === 'python' ? { code: implementation || 'import json,sys\ndata=json.load(sys.stdin)\nprint(json.dumps(data["input"]))' } : kind === 'shell' ? { command: implementation || 'cat' } : kind === 'http' ? { method: 'POST', url: implementation } : kind === 'mcp' ? { server: implementation.split('/')[0] || '', tool: implementation.split('/')[1] || '' } : { mode: 'select', selector: implementation }
      const definition = await api.saveCustomNode({ name, description, inputs: [{ id: 'input', label: 'Input', type: inputType }], outputs: [{ id: 'output', label: 'Output', type: outputType }], permissions: kind === 'http' || kind === 'mcp' ? ['network'] : kind === 'python' || kind === 'shell' ? ['execute-code'] : [], implementation: { kind, ...config }, tests: [{ name: 'sample input', input: null }], documentation: `${name}\n\n${description}` })
      onSaved(definition)
    } catch (reason) { setError(String(reason)); setBusy(false) }
  }
  return <aside className="guided-builder custom-node-wizard"><header><div><span>MY NODES</span><b>Create executable node</b></div><button onClick={onClose}>×</button></header><div className="guided-progress">{[1,2,3].map(index => <i key={index} className={index <= step ? 'active' : ''} />)}</div><div className="guided-content">
    {step === 1 && <><span className="guided-step">STEP 1 · PURPOSE</span><h3>What should this node do?</h3><Field label="Node name"><input autoFocus value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Plain-language purpose"><textarea rows={6} value={description} onChange={e => setDescription(e.target.value)} /></Field></>}
    {step === 2 && <><span className="guided-step">STEP 2 · CONTRACT</span><h3>What information moves through it?</h3><Field label="Input type"><select value={inputType} onChange={e => setInputType(e.target.value)}>{['any','text','number','boolean','object','array','table','file','files','artifact','image','audio','video','code'].map(type => <option key={type}>{type}</option>)}</select></Field><Field label="Output type"><select value={outputType} onChange={e => setOutputType(e.target.value)}>{['any','text','number','boolean','object','array','table','file','files','artifact','image','audio','video','code'].map(type => <option key={type}>{type}</option>)}</select></Field></>}
    {step === 3 && <><span className="guided-step">STEP 3 · IMPLEMENTATION</span><h3>How should it execute?</h3><Field label="Implementation"><select value={kind} onChange={e => setKind(e.target.value)}>{['transform','python','shell','http','mcp','agent'].map(type => <option key={type}>{type}</option>)}</select></Field><Field label={kind === 'http' ? 'URL' : kind === 'mcp' ? 'server/tool' : kind === 'transform' ? 'Field selector' : 'Code or command'}><textarea rows={6} value={implementation} onChange={e => setImplementation(e.target.value)} /></Field><div className="plain-callout">Requested permissions, ports, test scaffold, documentation, provenance, and version history will be persisted with this node.</div>{error && <div className="execution-error"><b>Could not create node</b><p>{error}</p></div>}</>}
  </div><footer><button disabled={step === 1 || busy} onClick={() => setStep(value => value - 1)}>Back</button>{step < 3 ? <button className="primary" disabled={(step === 1 && !name.trim()) || busy} onClick={() => setStep(value => value + 1)}>Continue</button> : <button className="primary" disabled={!name.trim() || busy} onClick={saveDefinition}>{busy ? 'Creating…' : 'Create and install'}</button>}</footer></aside>
}

function SimpleWorkflow({ nodes, edges, onOpen }: { nodes: Node[]; edges: Edge[]; onOpen: () => void }) {
  const incoming: Record<string, string[]> = {}; edges.forEach(e => (incoming[e.target] ||= []).push(e.source))
  const executable = nodes.filter(n => (n.data as any).ntype !== '__group')
  const order = autoLayout(executable, edges).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
  return <div className="simple-workflow"><div className="simple-intro"><span>OUTCOME VIEW</span><h2>{nodes.length ? 'Your workflow, in plain language' : 'Start with an outcome'}</h2><p>Each stage expands to the same underlying technical workflow.</p></div><div className="simple-stages">{order.map((n, i) => { const d = n.data as any; const meta = EXEC_META[d.ntype] || EXEC_META.agent; return <div className={`simple-stage state-${d.status || 'waiting'}`} key={n.id}><span className="stage-number">{i + 1}</span><span className={`studio-node-glyph tone-${meta.tone}`}>{meta.glyph}</span><span><b>{d.label || d.ntype}</b><small>{meta.description}</small></span><em>{incoming[n.id]?.length > 1 ? `${incoming[n.id].length} inputs` : d.status || 'Ready'}</em></div> })}</div><button onClick={onOpen}>Open full canvas</button></div>
}

function QuickSetupCard({ node, models, patch, close }: { node: Node; models: AllModel[]; patch: (value: Record<string, any>) => void; close: () => void }) {
  const d = node.data as any
  const meta = EXEC_META[d.ntype] || EXEC_META.agent
  const modelDriven = ['agent', 'orchestrator', 'critic', 'map'].includes(d.ntype)
  return <div className="quick-setup"><header><span className={`tone-${meta.tone}`}>{meta.glyph}</span><div><small>QUICK SETUP</small><b>{d.label}</b></div><button onClick={close}>×</button></header><div className="quick-setup-body"><Field label="Step name"><input autoFocus value={d.label || ''} onChange={e => patch({ label: e.target.value })} /></Field>
    {modelDriven && <><ModelField models={models} value={d.model} onChange={model => patch({ model })} label="Quality preference" /><Field label="What should this worker do?"><textarea rows={5} value={d.instruction || ''} onChange={e => patch({ instruction: e.target.value })} placeholder="Describe the expected result in plain language…" /></Field></>}
    {d.ntype === 'python' && <><Field label="What should this Python step do?"><textarea rows={4} value={d.purpose || ''} onChange={e => patch({ purpose: e.target.value })} placeholder="Clean and structure the incoming records…" /></Field><div className="quick-options"><button onClick={() => patch({ codeMode: 'generated' })} className={d.codeMode === 'generated' ? 'active' : ''}>AI Generated</button><button onClick={() => patch({ codeMode: 'assisted' })} className={d.codeMode === 'assisted' ? 'active' : ''}>AI Assisted</button><button onClick={() => patch({ codeMode: 'manual', code: '' })} className={d.codeMode === 'manual' ? 'active' : ''}>Empty script</button></div></>}
    {d.ntype === 'file-input' && <Field label="File paths"><textarea rows={5} value={d.paths || ''} onChange={e => patch({ paths: e.target.value })} placeholder="~/Documents/source.pdf" /></Field>}
    {d.ntype === 'folder-input' && <Field label="Folder path"><input value={d.path || ''} onChange={e => patch({ path: e.target.value })} placeholder="~/Documents/Research" /></Field>}
    {d.ntype === 'http' && <><Field label="Method"><select value={d.method || 'GET'} onChange={e => patch({ method: e.target.value })}>{['GET','POST','PUT','PATCH','DELETE'].map(x => <option key={x}>{x}</option>)}</select></Field><Field label="API URL"><input value={d.url || ''} onChange={e => patch({ url: e.target.value })} /></Field></>}
    {d.ntype === 'mcp' && <><Field label="Registered MCP server"><input value={d.server || ''} onChange={e => patch({ server: e.target.value })} /></Field><Field label="Discovered tool name"><input value={d.tool || ''} onChange={e => patch({ tool: e.target.value })} /></Field></>}
    {d.ntype === 'subworkflow' && <SubworkflowReferenceEditor data={d} patch={patch} compact />}
    {d.ntype === 'human-approval' && <Field label="What should the reviewer decide?"><textarea rows={4} value={d.message || ''} onChange={e => patch({ message: e.target.value })} /></Field>}
    {['obsidian-read', 'obsidian-write'].includes(d.ntype) && <Field label="Note path"><input value={d.notePath || ''} onChange={e => patch({ notePath: e.target.value })} /></Field>}
    {!modelDriven && !['python','file-input','folder-input','http','mcp','human-approval','obsidian-read','obsidian-write'].includes(d.ntype) && <div className="plain-callout">{meta.description}. Essential defaults are ready; use the Inspector for precise controls.</div>}
  </div><footer><button onClick={close}>Add to workflow</button><small>You can change every setting later.</small></footer></div>
}

function GuidedBuilder({ onClose, onBuild }: { onClose: () => void; onBuild: (goal: string) => void }) {
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState('Website')
  const [goal, setGoal] = useState('')
  const [inputs, setInputs] = useState<string[]>(['Typed instructions'])
  const [quality, setQuality] = useState(75)
  const [localOnly, setLocalOnly] = useState(true)
  const [humanReview, setHumanReview] = useState(true)
  const [team, setTeam] = useState(['Planner', 'Specialist', 'Reviewer'])
  const kinds = ['Website', 'Research report', 'Software', 'Document', 'Data analysis', 'Media', 'Custom']
  const inputOptions = ['Typed instructions', 'Files', 'Folder', 'Website', 'Obsidian knowledge']
  const suggested: Record<string, string[]> = { Website: ['Creative Director', 'UI Designer', 'Frontend Engineer', 'Visual Reviewer'], 'Research report': ['Researcher', 'Analyst', 'Fact Checker', 'Editor'], Software: ['Planner', 'Software Engineer', 'Test Engineer', 'Code Reviewer'], Document: ['Researcher', 'Writer', 'Editor'], 'Data analysis': ['Data Analyst', 'Python Engineer', 'Reviewer'], Media: ['Creative Director', 'Producer', 'Reviewer'], Custom: ['Planner', 'Specialist', 'Reviewer'] }
  useEffect(() => setTeam(suggested[kind] || suggested.Custom), [kind])
  const compiled = `Build a ${kind.toLowerCase()} workflow. Goal: ${goal || `Create a high-quality ${kind.toLowerCase()}`}. Inputs: ${inputs.join(', ')}. Quality priority: ${quality} out of 100. ${localOnly ? 'Use local models and local tools only.' : 'Cloud models are allowed when useful.'} ${humanReview ? 'Add human approval before the final output.' : 'No human approval is required.'} Recommended team: ${team.join(', ')}. Include deterministic validation, bounded retries, and clear error handling where appropriate.`
  return <aside className="guided-builder"><header><div><span>GUIDED BUILD</span><b>Design your workflow</b></div><button onClick={onClose}>×</button></header><div className="guided-progress">{[1,2,3,4,5].map(i => <i key={i} className={i <= step ? 'active' : ''} />)}</div><div className="guided-content">
    {step === 1 && <><span className="guided-step">STEP 1 · GOAL</span><h3>What do you want to create?</h3><div className="guided-choice-grid">{kinds.map(x => <button className={kind === x ? 'active' : ''} key={x} onClick={() => setKind(x)}>{x}</button>)}</div><Field label="Describe the outcome"><textarea rows={5} value={goal} onChange={e => setGoal(e.target.value)} placeholder="What should the finished result accomplish?" /></Field></>}
    {step === 2 && <><span className="guided-step">STEP 2 · INPUTS</span><h3>What information should be used?</h3><div className="guided-checks">{inputOptions.map(x => <label key={x}><input type="checkbox" checked={inputs.includes(x)} onChange={e => setInputs(v => e.target.checked ? [...v, x] : v.filter(y => y !== x))} />{x}</label>)}</div></>}
    {step === 3 && <><span className="guided-step">STEP 3 · PRIORITIES</span><h3>How should the workflow operate?</h3><Field label={`Quality priority · ${quality}%`}><input type="range" min="0" max="100" value={quality} onChange={e => setQuality(+e.target.value)} /></Field><label className="toggle-row"><input type="checkbox" checked={localOnly} onChange={e => setLocalOnly(e.target.checked)} />Keep models and tools local</label><label className="toggle-row"><input type="checkbox" checked={humanReview} onChange={e => setHumanReview(e.target.checked)} />Require human review</label></>}
    {step === 4 && <><span className="guided-step">STEP 4 · TEAM</span><h3>Recommended workers</h3><div className="guided-team">{team.map((x, i) => <div key={i}><span>◇</span><input value={x} onChange={e => setTeam(v => v.map((y, j) => i === j ? e.target.value : y))} /><button onClick={() => setTeam(v => v.filter((_y, j) => j !== i))}>×</button></div>)}<button onClick={() => setTeam(v => [...v, 'New specialist'])}>+ Add worker</button></div></>}
    {step === 5 && <><span className="guided-step">STEP 5 · PLAN</span><h3>Ready for the AI Architect</h3><div className="guided-summary"><b>{kind}</b><p>{goal || `Create a high-quality ${kind.toLowerCase()}`}</p><span>{team.length} workers · {localOnly ? 'Local only' : 'Hybrid models'} · {humanReview ? 'Human approval' : 'Automatic completion'}</span></div><div className="plain-callout">The Architect will create a visual proposal first. Nothing changes until you apply it.</div></>}
  </div><footer><button disabled={step === 1} onClick={() => setStep(s => s - 1)}>Back</button>{step < 5 ? <button className="primary" onClick={() => setStep(s => s + 1)}>Continue</button> : <button className="primary" onClick={() => onBuild(compiled)}>Create proposal</button>}</footer></aside>
}

function CommentInspector({ comment, targets, onEdit, onToggle, onAnchor, onDelete }: { comment: WorkflowComment; targets: Array<{ id: string; type: 'node' | 'group'; label: string }>; onEdit: () => void; onToggle: () => void; onAnchor: (value: string) => void; onDelete: () => void }) {
  const status = commentAnchorStatus(comment, targets)
  const value = comment.anchor ? `${comment.anchor.type}:${comment.anchor.id}` : 'none'
  return <><div className="panel-heading inspector-title"><div><span className="eyebrow">NON-EXECUTABLE</span><h2><i>✎</i> Review Comment</h2></div></div><div className="inspector-scroll comment-inspector"><div className={`comment-inspector-status ${comment.resolved ? 'resolved' : ''}`}>{comment.resolved ? 'Resolved review context' : 'Open review context'}</div><p>{comment.text}</p><button className="inspector-secondary" onClick={onEdit}>Edit comment</button><label className="inspector-field">Semantic anchor<select value={value} onChange={event => onAnchor(event.target.value)}><option value="none">Canvas (no anchor)</option>{targets.map(target => <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>{target.type === 'group' ? 'Section' : 'Node'} · {target.label}</option>)}</select><small>Anchors identify review context only. They do not create edges, inputs, dependencies, or execution context.</small></label><div className={`comment-anchor-state ${status.state}`}>{status.label}</div><div className="plain-callout"><b>Review-only annotation</b><p>This comment is stored with the workflow and its versions, but never enters the executable graph or run records.</p></div></div><div className="inspector-footer"><button onClick={onToggle}>{comment.resolved ? 'Reopen' : 'Resolve'}</button><button className="danger" onClick={onDelete}>Delete</button></div></>
}

function WorkflowSettingsPanel({ workflowId, name, setName, project, setProject, environment, settings, setSettings, variables, setVariables, mode }: { workflowId: string; name: string; setName: (v: string) => void; project: string; setProject: (v: string) => void; environment: string; settings: Record<string, any>; setSettings: React.Dispatch<React.SetStateAction<Record<string, any>>>; variables: Record<string, any>; setVariables: React.Dispatch<React.SetStateAction<Record<string, any>>>; mode: Mode }) {
  const [tab, setTab] = useState<'overview' | 'execution' | 'models' | 'permissions' | 'schedule' | 'variables'>('overview')
  const tabs = mode === 'easy' ? ['overview', 'variables'] as const : ['overview', 'execution', 'models', 'permissions', 'schedule', 'variables'] as const
  const patch = (next: Record<string, any>) => setSettings(s => ({ ...s, ...next }))
  return <><div className="panel-heading"><div><span className="eyebrow">WORKFLOW</span><h2>Settings</h2></div></div><div className="inspector-tabs">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div><div className="inspector-scroll">
    {tab === 'overview' && <><Field label="Name"><input aria-label="Workflow name" value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Project"><input aria-label="Workflow project" value={project} onChange={e => setProject(e.target.value)} /></Field><Field label="Environment"><input aria-label="Workflow environment" value={environment} readOnly /></Field><div className="plain-callout">Select a node to inspect its configuration. Click a connection to control routing and data flow.</div></>}
    {tab === 'execution' && <><label className="toggle-row"><input type="checkbox" checked={settings.localOnly !== false} onChange={e => patch({ localOnly: e.target.checked })} />Keep execution local-only</label><Field label="Maximum concurrent work"><input type="number" min="1" max="32" value={settings.parallelism || 4} onChange={e => patch({ parallelism: +e.target.value })} /></Field><Field label="Maximum run duration (ms)"><input type="number" min="60000" value={settings.maxDuration || 21600000} onChange={e => patch({ maxDuration: +e.target.value })} /></Field><Field label="Default retries"><input type="number" min="0" max="5" value={settings.retries || 0} onChange={e => patch({ retries: +e.target.value })} /></Field><label className="toggle-row"><input type="checkbox" checked={settings.cache !== false} onChange={e => patch({ cache: e.target.checked })} />Reuse safe cached outputs</label></>}
    {tab === 'models' && <div className="plain-callout"><b>Balanced routing</b><br />Nodes use their own model policy. The selected execution profile can override role-based policies for a run.</div>}
    {tab === 'permissions' && <div className="permission-list"><Permission yes text="Run approved workflow nodes" /><Permission yes={settings.localOnly !== false} text="Keep model and tool activity local" /><Permission yes text="Write inside isolated run workspaces" /><Permission yes={false} text="Expose secret values in workflow files" /></div>}
    {tab === 'schedule' && <><Field label="Preferred trigger"><select value={settings.schedule || 'manual'} onChange={e => patch({ schedule: e.target.value })}><option value="manual">Manual</option><option value="scheduled">Scheduled</option><option value="webhook">Webhook</option><option value="folder">Watched folder</option></select></Field><div className="plain-callout">Persistent trigger services are active. Use <b>Run → Schedule or trigger run</b> to add an interval, cron, secure webhook, or watched-folder trigger.</div><WorkflowTriggerManager workflowId={workflowId} /></>}
    {tab === 'variables' && <VariableEditor variables={variables} setVariables={setVariables} />}
  </div></>
}

function WebhookCredentialDisclosure({ credential, onDismiss }: { credential: { endpoint: string; token: string }; onDismiss: () => void }) {
  const command = `curl -X POST http://localhost:1717${credential.endpoint} -H 'Authorization: Bearer ${credential.token}' -H 'Idempotency-Key: replace-with-unique-key' -H 'Content-Type: application/json' -d '{}'`
  return <div className="webhook-disclosure" role="dialog" aria-modal="true" aria-label="One-time webhook credential"><div><b>Copy this webhook credential now</b><p>It is never stored in workflow JSON and cannot be shown again. Rotate the credential if it is lost.</p><code>{command}</code><span>Rotation invalidates new requests using the previous credential. A request already authenticated may still finish.</span><footer><button onClick={() => navigator.clipboard.writeText(command)}>Copy command</button><button onClick={onDismiss}>Dismiss permanently</button></footer></div></div>
}

function WorkflowTriggerManager({ workflowId }: { workflowId: string }) {
  const [items, setItems] = useState<WorkflowTrigger[]>([]), [history, setHistory] = useState<TriggerHistoryItem[]>([])
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [credential, setCredential] = useState<{ endpoint: string; token: string } | null>(null)
  const refresh = async () => {
    if (!workflowId) { setItems([]); setHistory([]); return }
    setLoading(true); setError('')
    try {
      const [definitions, deliveries] = await Promise.all([api.workflowTriggers(workflowId), api.workflowTriggerHistory(workflowId)])
      setItems(definitions); setHistory(deliveries.items)
    } catch (value) { setError(String(value)) }
    finally { setLoading(false) }
  }
  useEffect(() => { setCredential(null); setError(''); refresh() }, [workflowId])
  const change = async (id: string, operation: () => Promise<unknown>) => {
    setBusy(id); setError('')
    try { await operation(); await refresh() } catch (value) { setError(String(value)) }
    finally { setBusy('') }
  }
  const rotate = (trigger: WorkflowTrigger) => {
    if (!window.confirm('Rotate this webhook credential? New requests using the old credential will be rejected.')) return
    change(trigger.id, async () => {
      const result = await api.rotateWorkflowWebhookSecret(trigger.id, trigger.secretRevision || 1, crypto.randomUUID())
      if (!result.webhookEndpoint || !result.webhookToken) throw new Error(result.duplicate ? 'This rotation was already applied; rotate again to disclose a new credential.' : 'The new credential was not disclosed.')
      setCredential({ endpoint: result.webhookEndpoint, token: result.webhookToken })
    })
  }
  const revoke = (trigger: WorkflowTrigger) => {
    if (!window.confirm('Revoke this webhook credential? Re-enabling the trigger will not restore it.')) return
    change(trigger.id, async () => { await api.revokeWorkflowWebhookSecret(trigger.id, trigger.secretRevision || 1); setCredential(null) })
  }
  const remove = (trigger: WorkflowTrigger) => {
    if (!window.confirm(triggerDeletePrompt(trigger))) return
    change(trigger.id, () => api.deleteWorkflowTrigger(trigger.id))
  }
  const formatTime = (value: unknown) => Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString() : 'Time unavailable'
  return <section className="trigger-manager"><header><div><b>Configured triggers</b><small>Canonical server-managed definitions · persisted history</small></div><button disabled={!workflowId || loading} onClick={refresh}>{loading ? 'Loading…' : 'Refresh'}</button></header>
    {!workflowId && <p>Save the workflow to inspect and manage its triggers.</p>}
    {workflowId && !loading && !items.length && <p>No triggers are configured. Add one from Run → Schedule or trigger run.</p>}
    <div className="trigger-manager-list">{items.map(trigger => { const availability = triggerAvailability(trigger); const count = history.filter(item => item.triggerId === trigger.id).length; return <article key={trigger.id} className={!availability.available ? 'unavailable' : ''}>
      <div className="trigger-manager-title"><span><b>{triggerTypeLabel(trigger.type)}</b><small>{triggerSummary(trigger)}</small></span><i className={availability.available ? 'ready' : ''}>{availability.label}</i></div>
      <p>{availability.reason} · {count} recent {count === 1 ? 'delivery' : 'deliveries'} shown.</p>
      <footer><button disabled={busy === trigger.id || trigger.folderStatus === 'needs-review'} onClick={() => change(trigger.id, () => api.updateWorkflowTrigger(trigger.id, !trigger.enabled))}>{trigger.enabled ? 'Disable' : 'Enable'}</button>{trigger.type === 'webhook' && <><button disabled={busy === trigger.id} onClick={() => rotate(trigger)}>Rotate credential</button><button disabled={busy === trigger.id || trigger.webhookCredentialStatus === 'revoked'} onClick={() => revoke(trigger)}>Revoke</button></>}<button className="danger" disabled={busy === trigger.id} onClick={() => remove(trigger)}>Delete</button></footer>
    </article> })}</div>
    {!!history.length && <div className="trigger-history"><b>Recent delivery history</b>{history.map(item => { const state = historyStatus(item); const trigger = items.find(candidate => candidate.id === item.triggerId); return <div key={item.id}><span><i className={state.status}>{state.label}</i><b>{trigger ? triggerTypeLabel(trigger.type) : 'Deleted trigger'}</b><small>{formatTime(item.updatedAt || item.createdAt || item.scheduledAt)}</small></span>{item.runId ? <code>{item.runId}</code> : <em>No run linked</em>}</div> })}</div>}
    {error && <p className="error-text">{error}</p>}{credential && <WebhookCredentialDisclosure credential={credential} onDismiss={() => setCredential(null)} />}
  </section>
}

function VariableEditor({ variables, setVariables }: { variables: Record<string, any>; setVariables: React.Dispatch<React.SetStateAction<Record<string, any>>> }) {
  const entries = Object.entries(variables)
  return <div className="workflow-variable-editor"><div className="plain-callout">Reference values in prompts and settings as <b>{'{{vars.variable_name}}'}</b>.</div>{entries.map(([key, value]) => <div className="workflow-variable-row" key={key}><input aria-label={`Variable name ${key}`} value={key} onChange={e => { const nextKey = e.target.value.replace(/[^a-zA-Z0-9_]/g, ''); setVariables(v => { const next = { ...v }; delete next[key]; next[nextKey] = value; return next }) }} /><input aria-label={`Variable value ${key}`} value={typeof value === 'string' ? value : JSON.stringify(value)} onChange={e => setVariables(v => ({ ...v, [key]: e.target.value }))} /><button aria-label={`Remove variable ${key}`} onClick={() => setVariables(v => { const next = { ...v }; delete next[key]; return next })}>×</button></div>)}<button className="inspector-secondary" onClick={() => { let i = 1; while (`variable_${i}` in variables) i++; setVariables(v => ({ ...v, [`variable_${i}`]: '' })) }}>+ Add variable</button></div>
}

function SubworkflowReferenceEditor({ data, patch, compact = false }: { data: Record<string, any>; patch: (p: Record<string, any>) => void; compact?: boolean }) {
  const [childName, setChildName] = useState('')
  const [versions, setVersions] = useState<Array<{ id: string; hash: string; name: string; savedAt: number; current?: boolean }>>([])
  const [loading, setLoading] = useState(false)
  const childId = String(data.workflowId || '').trim()
  const pin = String(data.workflowVersion || '').trim()

  useEffect(() => {
    let active = true
    if (!childId) { setChildName(''); setVersions([]); return () => { active = false } }
    setLoading(true)
    Promise.all([api.workflow(childId), api.workflowVersions(childId)]).then(([workflow, saved]) => {
      if (!active) return
      setChildName(workflow.name); setVersions(saved); setLoading(false)
    }).catch(() => { if (active) { setChildName('Unavailable child'); setVersions([]); setLoading(false) } })
    return () => { active = false }
  }, [childId, pin])

  const latest = currentWorkflowVersion(versions)
  const pinned = versions.find(version => version.id === pin)
  const updatePin = () => {
    if (!latest) return
    const action = pin ? `Update “${childName || childId}” from ${pin} to ${latest.id}?` : `Pin “${childName || childId}” to ${latest.id}?`
    if (!window.confirm(`${action}\n\nThis changes only this parent node and can be undone before saving.`)) return
    patch(advanceSubworkflowPin(data, latest))
  }

  return <div className="subworkflow-reference-editor">
    <Field label="Child workflow ID"><input value={data.workflowId || ''} onChange={event => patch({ workflowId: event.target.value, workflowVersion: '' })} placeholder="wf-..." /></Field>
    {!compact && <div className={`plain-callout ${pin && !pinned && !loading ? 'warning' : ''}`}>
      <b>{pinned?.name || childName || (loading ? 'Loading child…' : childId || 'No child selected')}</b><br />
      {pin ? `Pinned version: ${pin}${pinned ? ` · ${pinned.hash}` : loading ? '' : ' · unavailable'}` : 'Unpinned legacy reference — runs the current child draft.'}
    </div>}
    <button className="inspector-secondary" disabled={!latest || latest.id === pin || loading} onClick={updatePin}>{pin ? latest?.id === pin ? 'Pin is current' : 'Review and update pin' : 'Review and pin current version'}</button>
  </div>
}

function SecretReferenceSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [items, setItems] = useState<import('./api').SecretReference[]>([])
  const [error, setError] = useState('')
  useEffect(() => { api.secretReferences().then(setItems).catch(reason => setError(String(reason))) }, [])
  const selected = items.find(item => item.id === value)
  return <Field label="Bearer credential" hint="Only the opaque reference is saved. The value stays in macOS Keychain and is resolved when this step runs."><select value={value} onChange={event => onChange(event.target.value)}><option value="">No authentication</option>{value && !selected && <option value={value}>{value} (unavailable)</option>}{items.map(item => <option key={item.id} value={item.id} disabled={!item.configured}>{item.label} · {item.id}{item.configured ? '' : ` (${item.status})`}</option>)}</select>{error && <small className="error-text">Credential status unavailable</small>}</Field>
}

function Inspector({ node, edge, nodes, models, skills, mode, tab, setTab, patch, remove, input, snapshot, setEdges, openCode, workflowId, onRestore }: { node?: Node; edge?: Edge; nodes: Node[]; models: AllModel[]; skills: Skill[]; mode: Mode; tab: InspectorTab; setTab: (t: InspectorTab) => void; patch: (p: Record<string, unknown>) => void; remove: () => void; input: string; snapshot: () => void; setEdges: React.Dispatch<React.SetStateAction<Edge[]>>; openCode: () => void; workflowId: string; onRestore: () => void }) {
  const d = node?.data as any
  if (edge) {
    return <ConnectionInspector edge={edge} nodes={nodes} mode={mode} snapshot={snapshot} setEdges={setEdges} remove={remove} />
  }
  if (!node) return <><div className="panel-heading"><div><span className="eyebrow">WORKFLOW</span><h2>Inspector</h2></div></div><div className="inspector-empty"><span>◇</span><b>Select a node or connection</b><p>Its settings, permissions, tests, and execution details will appear here.</p></div></>
  const meta = EXEC_META[d.ntype] || EXEC_META.agent
  const tabs: InspectorTab[] = mode === 'easy' ? ['basic'] : mode === 'guided' ? ['basic', 'testing'] : ['basic', 'advanced', 'permissions', 'testing', 'versions']
  const isModel = ['agent', 'orchestrator', 'critic', 'parallel', 'map'].includes(d.ntype)
  return <>
    <div className="panel-heading inspector-title"><div><span className="eyebrow">{d.ntype.toUpperCase()}</span><h2><i className={`tone-${meta.tone}`}>{meta.glyph}</i>{d.label || d.ntype}</h2></div><span className={`node-state state-${d.status || 'ready'}`}>{d.status || 'Ready'}</span></div>
    <div className="inspector-tabs">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
    <div className="inspector-scroll">
      {tab === 'basic' && <>
        <Field label="Name"><input value={d.label || ''} onChange={e => patch({ label: e.target.value })} /></Field>
        <div className="field-help">{meta.description}</div>
        {['agent', 'orchestrator'].includes(d.ntype) && <><ModelField models={models} value={d.model} onChange={v => patch({ model: v })} label={mode === 'easy' ? 'Quality preference' : 'Model policy'} /><Field label="Main instruction" hint={mode === 'easy' ? 'Describe the result this team member should produce.' : 'Use {{input}} or {{nodeId}} to reference data.'}><textarea rows={7} value={d.instruction || ''} onChange={e => patch({ instruction: e.target.value })} /></Field></>}
        {d.ntype === 'critic' && <><ModelField models={models} value={d.model} onChange={v => patch({ model: v })} label="Worker model" /><Field label="Task to improve"><textarea rows={6} value={d.instruction || ''} onChange={e => patch({ instruction: e.target.value })} /></Field></>}
        {d.ntype === 'parallel' && <><Field label="Shared task"><textarea rows={6} value={d.instruction || ''} onChange={e => patch({ instruction: e.target.value })} /></Field><div className="plain-callout">This node runs {d.models?.length || 1} candidate model(s), then asks a judge to produce one result.</div></>}
        {d.ntype === 'search' && <><Field label="Search query" hint="Use {{input}} to search using the workflow request."><textarea rows={5} value={d.instruction || ''} onChange={e => patch({ instruction: e.target.value })} /></Field><Field label="Passages to retrieve"><input type="number" min="1" max="10" value={d.k || 4} onChange={e => patch({ k: +e.target.value })} /></Field></>}
        {d.ntype === 'check' && <><Field label="Must mention" hint="Comma-separated words or phrases."><input value={d.checks?.contains || ''} onChange={e => patch({ checks: { ...d.checks, contains: e.target.value } })} /></Field><Field label="Minimum characters"><input type="number" min="0" value={d.checks?.minLength || 0} onChange={e => patch({ checks: { ...d.checks, minLength: +e.target.value } })} /></Field><label className="toggle-row"><input type="checkbox" checked={!!d.checks?.isJson} onChange={e => patch({ checks: { ...d.checks, isJson: e.target.checked } })} />Require valid JSON</label></>}
        {d.ntype === 'if' && <><Field label="JSON field (optional)" hint="Example: quality.score. Leave empty to inspect the complete text."><input value={d.selector || ''} onChange={e => patch({ selector: e.target.value })} /></Field><Field label="Condition"><select value={d.operator || 'contains'} onChange={e => patch({ operator: e.target.value })}><option value="contains">Contains</option><option value="equals">Equals</option><option value="not-equals">Does not equal</option><option value="matches">Matches regular expression</option><option value="greater">Is greater than</option><option value="less">Is less than</option><option value="exists">Exists</option></select></Field>{d.operator !== 'exists' && <Field label="Value"><input value={d.value ?? ''} onChange={e => patch({ value: e.target.value })} /></Field>}</>}
        {d.ntype === 'delay' && <Field label="Wait duration (milliseconds)"><input type="number" min="0" max="300000" value={d.durationMs || 1000} onChange={e => patch({ durationMs: +e.target.value })} /></Field>}
        {d.ntype === 'map' && <><ModelField models={models} value={d.model} onChange={v => patch({ model: v })} label="Worker model" /><Field label="Task for each item" hint="Use {{item}} and {{index}}."><textarea rows={6} value={d.instruction || ''} onChange={e => patch({ instruction: e.target.value })} /></Field><Field label="Maximum items"><input type="number" min="1" max="100" value={d.maxItems || 25} onChange={e => patch({ maxItems: +e.target.value })} /></Field></>}
        {d.ntype === 'python' && <><Field label="Editing mode"><select value={d.codeMode || 'assisted'} onChange={e => patch({ codeMode: e.target.value })}><option value="generated">AI Generated</option><option value="assisted">AI Assisted</option><option value="manual">Manual</option><option value="locked">Locked</option></select></Field><Field label="Python code" hint={'Read JSON from stdin. Input shape: { input, workflowInput, outputs }. Print the node output to stdout.'}><textarea className="code-editor-mini" rows={12} spellCheck={false} readOnly={d.codeMode === 'locked'} value={d.code || ''} onChange={e => patch({ code: e.target.value })} /></Field><button className="open-code-workspace" onClick={openCode}>Open full code workspace</button></>}
        {d.ntype === 'shell' && <Field label="Command" hint="Runs with zsh inside the isolated run folder. Incoming text is available on stdin."><textarea className="code-editor-mini" rows={7} spellCheck={false} value={d.command || ''} onChange={e => patch({ command: e.target.value })} /></Field>}
        {d.ntype === 'json-transform' && <><Field label="Select field" hint="Dot path such as records.items. Leave empty to pass all JSON."><input value={d.selector || ''} onChange={e => patch({ selector: e.target.value })} /></Field><label className="toggle-row"><input type="checkbox" checked={d.pretty !== false} onChange={e => patch({ pretty: e.target.checked })} />Pretty-print output</label></>}
        {['read-file', 'write-file'].includes(d.ntype) && <Field label="Workspace-relative path" hint="File access is contained inside the current run workspace."><input value={d.path || ''} onChange={e => patch({ path: e.target.value })} /></Field>}
        {d.ntype === 'http' && <><Field label="Method"><select value={d.method || 'GET'} onChange={e => patch({ method: e.target.value })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(x => <option key={x}>{x}</option>)}</select></Field><Field label="URL" hint="Use {{input}} or an upstream node reference in the URL."><input value={d.url || ''} onChange={e => patch({ url: e.target.value })} placeholder="https://api.example.com/resource" /></Field><SecretReferenceSelect value={d.authRef || ''} onChange={authRef => patch({ authRef: authRef || undefined, authMode: authRef ? 'bearer' : undefined })} /><label className="toggle-row"><input type="checkbox" checked={d.failOnError !== false} onChange={e => patch({ failOnError: e.target.checked })} />Stop on non-success response</label></>}
        {d.ntype === 'mcp' && <><Field label="Registered MCP server"><input value={d.server || ''} onChange={e => patch({ server: e.target.value })} /></Field><Field label="Tool name"><input value={d.tool || ''} onChange={e => patch({ tool: e.target.value })} /></Field><Field label="Arguments (JSON)"><textarea rows={6} value={JSON.stringify(d.arguments || {}, null, 2)} onChange={e => { try { patch({ arguments: JSON.parse(e.target.value) }) } catch {} }} /></Field><div className="plain-callout">Tool schemas can be discovered and tested in the Tool Control Center before this workflow runs.</div></>}
        {d.ntype === 'subworkflow' && <><SubworkflowReferenceEditor data={d} patch={patch} /><div className="plain-callout">The exact pinned child snapshot runs with stricter inherited resource, permission, and local-only limits. Parent pause/stop propagates, and recursive or over-depth calls are rejected. Legacy unpinned references run the current draft until you explicitly pin them.</div></>}
        {d.ntype === 'human-approval' && <><Field label="Message for reviewer"><textarea rows={5} value={d.message || ''} onChange={e => patch({ message: e.target.value })} /></Field><div className="plain-callout">The workflow keeps completed work safe while it waits. Approve or reject from the Timeline panel.</div></>}
        {d.ntype === 'file-input' && <><Field label="File paths" hint="One absolute path per line. ~ expands to your home folder."><textarea rows={7} value={d.paths || ''} onChange={e => patch({ paths: e.target.value })} placeholder="~/Documents/example.pdf" /></Field><label className="toggle-row"><input type="checkbox" checked={!!d.readText} onChange={e => patch({ readText: e.target.checked })} />Read files as text immediately</label></>}
        {d.ntype === 'folder-input' && <><Field label="Folder path"><input value={d.path || ''} onChange={e => patch({ path: e.target.value })} placeholder="~/Documents/Research" /></Field><Field label="File extensions" hint="Comma-separated; leave empty for every file."><input value={d.extensions || ''} onChange={e => patch({ extensions: e.target.value })} /></Field><label className="toggle-row"><input type="checkbox" checked={d.recursive !== false} onChange={e => patch({ recursive: e.target.checked })} />Include subfolders</label><Field label="Maximum files"><input type="number" min="1" max="5000" value={d.maxFiles || 500} onChange={e => patch({ maxFiles: +e.target.value })} /></Field></>}
        {d.ntype === 'pdf-reader' && <><Field label="Maximum PDFs"><input type="number" min="1" max="200" value={d.maxFiles || 50} onChange={e => patch({ maxFiles: +e.target.value })} /></Field><div className="plain-callout">Connect a File Input or Folder Input. Extracted text retains a source heading for each PDF.</div></>}
        {['obsidian-read', 'obsidian-write'].includes(d.ntype) && <><Field label="Vault folder"><input value={d.vaultPath || ''} onChange={e => patch({ vaultPath: e.target.value })} /></Field><Field label="Vault-relative note path"><input value={d.notePath || ''} onChange={e => patch({ notePath: e.target.value })} /></Field>{d.ntype === 'obsidian-write' && <label className="toggle-row"><input type="checkbox" checked={!!d.append} onChange={e => patch({ append: e.target.checked })} />Append instead of replace</label>}</>}
        {['input', 'output'].includes(d.ntype) && <div className="plain-callout">{meta.description}. It has no model or prompt settings.</div>}
      </>}
      {tab === 'advanced' && <>
        <Field label="Canvas display"><select value={d.displaySize || 'standard'} onChange={e => patch({ displaySize: e.target.value })}><option value="compact">Compact</option><option value="standard">Standard</option></select></Field>
        {d.ntype === 'critic' && <><ModelField models={models} value={d.reviewerModel} onChange={v => patch({ reviewerModel: v })} label="Reviewer model" /><Field label="Maximum review rounds"><input type="number" min="1" max="5" value={d.maxIters || 2} onChange={e => patch({ maxIters: +e.target.value })} /></Field></>}
        {d.ntype === 'parallel' && <><ModelField models={models} value={d.judgeModel} onChange={v => patch({ judgeModel: v })} label="Judge model" />{(d.models || []).map((m: string, i: number) => <ModelField key={i} models={models} value={m} onChange={v => patch({ models: d.models.map((x: string, j: number) => i === j ? v : x) })} label={`Candidate ${i + 1}`} />)}<button className="inspector-secondary" onClick={() => patch({ models: [...(d.models || []), 'policy:balanced'] })}>+ Add candidate</button></>}
        {isModel && <Field label="Retries on model failure"><input type="number" min="0" max="5" value={d.retries ?? ''} placeholder="Use workflow default" onChange={e => patch({ retries: e.target.value === '' ? undefined : +e.target.value })} /></Field>}
        {isModel && skills.length > 0 && <div className="skill-picker"><span>Installed skills</span>{skills.map(skill => { const active = (d.skills || []).includes(skill.path); return <label key={skill.path}><input type="checkbox" checked={active} onChange={e => patch({ skills: e.target.checked ? [...(d.skills || []), skill.path] : (d.skills || []).filter((x: string) => x !== skill.path) })} /><span><b>{skill.title}</b><small>{skill.preview}</small></span></label> })}</div>}
        {isModel && <div className="plain-callout">Node retries override the workflow default. Context limits are enforced before model calls; caching and per-node memory limits remain roadmap controls.</div>}
        {['agent', 'orchestrator'].includes(d.ntype) && <Field label="Context character limit" hint="Longer resolved instructions are truncated before the model call. Set 0 for unlimited."><input type="number" min="0" step="1000" value={d.contextLimit || 0} onChange={e => patch({ contextLimit: +e.target.value })} /></Field>}
        {['python', 'shell', 'http'].includes(d.ntype) && <Field label="Timeout (milliseconds)"><input type="number" min="1000" max="300000" step="1000" value={d.timeoutMs || (d.ntype === 'http' ? 30000 : 120000)} onChange={e => patch({ timeoutMs: +e.target.value })} /></Field>}
        {d.ntype === 'python' && <><Field label="Python dependencies" hint="One approved PyPI package specification per line, for example pydantic==2.8.2."><textarea rows={6} value={(d.dependencies || []).join('\n')} onChange={e => patch({ dependencies: e.target.value.split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean) })} /></Field><label className="toggle-row permission-install"><input type="checkbox" checked={!!d.allowPackageInstall} onChange={e => patch({ allowPackageInstall: e.target.checked })} />Allow this node to install the listed packages into its isolated cached environment</label></>}
      </>}
      {tab === 'permissions' && <div className="permission-list"><div className="permission-intro">Executable nodes enforce workflow and node denials for code, shell, workspace files, network, and MCP tools.</div><Permission yes text="Keep file operations inside the isolated run workspace" /><Permission yes text="Apply code, shell, file, network, and tool denials before side effects" /><Permission yes text="Pass stricter permission and local-only ceilings into child workflows" /><Permission yes={false} text="Grant a child capability denied by its parent" /><div className="permission-warning">General path allowlists and a complete editable permission matrix are not available yet.</div></div>}
      {tab === 'testing' && <NodeTest data={d} input={input} models={models} />}
      {tab === 'versions' && <VersionPanel workflowId={workflowId} onRestore={onRestore} />}
    </div>
    <div className="inspector-footer"><button onClick={() => patch({ breakpoint: !d.breakpoint })}>{d.breakpoint ? 'Remove breakpoint' : 'Add breakpoint'}</button><button className="danger" onClick={remove}>Delete node</button></div>
  </>
}

function ConnectionInspector({ edge, nodes, mode, snapshot, setEdges, remove }: { edge: Edge; nodes: Node[]; mode: Mode; snapshot: () => void; setEdges: React.Dispatch<React.SetStateAction<Edge[]>>; remove: () => void }) {
  const source = nodes.find(n => n.id === edge.source), target = nodes.find(n => n.id === edge.target)
  const sourceIsDecision = (source?.data as any)?.ntype === 'if'
  const sourcePorts: PortDefinition[] = (source?.data as any)?.ports?.outputs || [], targetPorts: PortDefinition[] = (target?.data as any)?.ports?.inputs || []
  const sourcePort = sourcePorts.find(port => port.id === edge.sourceHandle) || sourcePorts[0], targetPort = targetPorts.find(port => port.id === edge.targetHandle) || targetPorts[0]
  const [sample, setSample] = useState('{\n  "summary": "Example",\n  "score": 90\n}')
  const [preview, setPreview] = useState('')
  const patchEdge = (data: Record<string, unknown>) => {
    snapshot(); setEdges(es => es.map(e => e.id === edge.id ? { ...e, data: { ...(e.data || {}), ...data }, ...(data.condition ? { label: data.condition === 'true' ? 'Yes' : 'No' } : {}) } : e))
  }
  const runPreview = async () => {
    try { const result = await api.previewConnection({ value: sample, parseJson: true, mapping: (edge.data as any)?.mapping || {}, coercion: (edge.data as any)?.coercion, schema: (edge.data as any)?.schema || targetPort?.schema }); setPreview(JSON.stringify(result, null, 2)) }
    catch (error) { setPreview(`Preview failed: ${error}`) }
  }
  return <><div className="panel-heading"><div><span className="eyebrow">DATA FLOW</span><h2>Connection</h2></div></div><div className="connection-summary"><label>From<b>{String(source?.data.label || edge.source)} → {sourcePort?.label || edge.sourceHandle || 'output'} <em>{sourcePort?.type || 'any'}</em></b></label><span>↓</span><label>To<b>{String(target?.data.label || edge.target)} → {targetPort?.label || edge.targetHandle || 'input'} <em>{targetPort?.type || 'any'}</em></b></label></div><div className="inspector-scroll">{sourceIsDecision && <><Field label="Run this path when"><select value={String((edge.data as any)?.condition || 'true')} onChange={e => patchEdge({ condition: e.target.value })}><option value="true">Condition is Yes</option><option value="false">Condition is No</option></select></Field><div className="plain-callout">Only this matching route will run. Nodes on the other route are marked as skipped.</div></>}{(mode === 'pro' || mode === 'developer') && <><MappingEditor mapping={(edge.data as any)?.mapping || {}} onChange={mapping => patchEdge({ mapping })} /><Field label="Explicit safe coercion"><select value={(edge.data as any)?.coercion || ''} onChange={e => patchEdge({ coercion: e.target.value || undefined })}><option value="">No coercion</option>{['text','number','boolean','object','array','code','files'].map(type => <option key={type} value={type}>Convert to {type}</option>)}</select></Field><Field label="Sample source value"><textarea rows={5} value={sample} onChange={e => setSample(e.target.value)} /></Field><button className="inspector-secondary" onClick={runPreview}>Preview transferred data</button>{preview && <pre className="connection-preview">{preview}</pre>}</>}</div><div className="plain-callout">{mode === 'easy' ? <>The result from <b>{String(source?.data.label || edge.source)}</b> will be passed to <b>{String(target?.data.label || edge.target)}</b>.</> : <>Mappings, coercion, and the destination schema are revalidated by the runtime before this value enters the next node.</>}</div><button className="inspector-delete" onClick={remove}>Delete connection</button></>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="inspector-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label> }

function MappingEditor({ mapping, onChange }: { mapping: Record<string, string>; onChange: (mapping: Record<string, string>) => void }) {
  const entries = Object.entries(mapping)
  return <div className="mapping-editor"><div><span>FIELD MAPPING</span><button onClick={() => onChange({ ...mapping, source_field: 'destination_field' })}>+ Add</button></div>{entries.length === 0 && <p>Pass the complete output, or map selected JSON fields.</p>}{entries.map(([source, destination], index) => <div className="mapping-row" key={`${source}-${index}`}><input aria-label="Source field" value={source} onChange={e => { const next = { ...mapping }; delete next[source]; next[e.target.value] = destination; onChange(next) }} placeholder="summary" /><span>→</span><input aria-label="Destination field" value={destination} onChange={e => onChange({ ...mapping, [source]: e.target.value })} placeholder="research_summary" /><button onClick={() => { const next = { ...mapping }; delete next[source]; onChange(next) }}>×</button></div>)}{entries.length > 0 && <small>Dot paths are supported, for example <b>claims.0.text → review.primary_claim</b>.</small>}</div>
}
function ModelField({ models, value, onChange, label }: { models: AllModel[]; value?: string; onChange: (v: string) => void; label: string }) { return <Field label={label}><select value={value || ''} onChange={e => onChange(e.target.value)}><optgroup label="Automatic">{models.filter(m => m.kind === 'policy').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup><optgroup label="Local">{models.filter(m => m.kind === 'local').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup><optgroup label="Cloud">{models.filter(m => m.kind === 'cloud').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup><optgroup label="Tier role">{models.filter(m => m.kind === 'role').map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}</optgroup></select></Field> }
function Permission({ yes, text }: { yes: boolean; text: string }) { return <div className={yes ? 'permission-yes' : 'permission-no'}><span>{yes ? '✓' : '—'}</span>{text}</div> }

function VersionPanel({ workflowId, onRestore }: { workflowId: string; onRestore: () => void }) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [busy, setBusy] = useState('')
  useEffect(() => { if (workflowId) api.workflowVersions(workflowId).then(setVersions).catch(() => setVersions([])) }, [workflowId])
  if (!workflowId) return <div className="version-card"><span>UNSAVED DRAFT</span><b>Save the workflow to create version history</b><p>Each distinct save creates a durable snapshot.</p></div>
  return <div className="version-list"><div className="version-card"><span>CURRENT DRAFT</span><b>Automatic saved snapshots</b><p>Up to 50 unreferenced versions are retained. Versions pinned by parent workflows are retained until those references are updated.</p></div>{versions.map((v, i) => <div className="version-row" key={v.id}><div><b>{v.current ? 'Current saved version' : i === 0 ? 'Latest saved version' : new Date(v.savedAt).toLocaleString()}</b><small>{v.nodes} nodes · {v.hash}</small></div><button disabled={busy === v.id} onClick={async () => { if (!confirm('Restore this workflow version? Your saved history will remain available.')) return; setBusy(v.id); try { await api.restoreWorkflowVersion(workflowId, v.id); onRestore() } finally { setBusy('') } }}>{busy === v.id ? 'Restoring…' : 'Restore'}</button></div>)}</div>
}

function NodeTest({ data, input, models }: { data: any; input: string; models: AllModel[] }) {
  const [sample, setSample] = useState(input)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const supported = ['agent', 'orchestrator', 'critic'].includes(data.ntype)
  return <div className="node-test"><Field label="Sample input"><textarea rows={5} value={sample} onChange={e => setSample(e.target.value)} placeholder="Enter a realistic test input" /></Field>{supported ? <button disabled={busy || !data.instruction} onClick={async () => { setBusy(true); setResult(''); try { const r = await api.testNode(data.model || models[0]?.ref || '', data.instruction, sample); setResult(r.output) } catch (e) { setResult(`Test failed: ${e}`) } setBusy(false) }}>{busy ? 'Testing…' : 'Run isolated test'}</button> : <div className="plain-callout">Isolated testing is currently available for model-driven nodes. Run a Safe Test to exercise this node in its real workflow context.</div>}{result && <pre>{result}</pre>}</div>
}

function PythonWorkspace({ data, onSave, onTest, onClose }: { data: any; onSave: (patch: Record<string, unknown>) => void; onTest: () => void; onClose: () => void }) {
  const [code, setCode] = useState(data.code || '')
  const [tab, setTab] = useState<'output' | 'tests' | 'logs' | 'dependencies' | 'versions' | 'permissions'>('output')
  const [assistant, setAssistant] = useState('')
  const inputs = data.inputs || [{ name: 'input', type: 'string | object', required: true, source: 'Previous node' }, { name: 'workflowInput', type: 'string', required: true, source: 'Workflow start' }, { name: 'outputs', type: 'object', required: true, source: 'Completed nodes' }]
  const outputs = data.outputs || [{ name: 'stdout', type: 'string', description: 'Everything printed by the script' }]
  const locked = data.codeMode === 'locked'
  return <div className="python-workspace-backdrop"><section className="python-workspace"><header><div><span>Py</span><div><small>CODE WORKSPACE</small><b>Python: {data.label}</b></div></div><div><button onClick={onTest}>Safe test</button><button className="primary" disabled={locked} onClick={() => onSave({ code })}>Save changes</button><button onClick={onClose}>×</button></div></header><div className="python-workspace-main"><aside><h3>Inputs</h3>{inputs.map((x: any) => <div className="python-schema-row" key={x.name}><b>{x.name}</b><span>{x.type}</span><small>{x.source}{x.required ? ' · required' : ''}</small></div>)}<h3>Outputs</h3>{outputs.map((x: any) => <div className="python-schema-row" key={x.name}><b>{x.name}</b><span>{x.type}</span><small>{x.description}</small></div>)}</aside><main><div className="code-toolbar"><span>process.py</span><em>{locked ? 'LOCKED' : String(data.codeMode || 'assisted').toUpperCase()}</em></div><textarea value={code} onChange={e => setCode(e.target.value)} readOnly={locked} spellCheck={false} aria-label="Python code editor" /></main><aside className="python-assistant"><div><span>✦</span><b>AI Assistant</b></div><p>Describe a change. The AI Architect can prepare a reviewable code diff without directly changing production code.</p><div className="python-suggestions"><button onClick={() => setAssistant('Add input validation and clear error messages.')}>Add validation</button><button onClick={() => setAssistant('Generate unit tests for every branch.')}>Generate tests</button><button onClick={() => setAssistant('Explain this script in plain language.')}>Explain code</button></div><textarea value={assistant} onChange={e => setAssistant(e.target.value)} placeholder="Ask for a code change…" /><button disabled={!assistant.trim()}>Prepare diff</button><small>AI code diffs are staged for review. Direct generation will be connected to the Architect code endpoint.</small></aside></div><footer><nav>{(['output', 'tests', 'logs', 'dependencies', 'versions', 'permissions'] as const).map(x => <button className={tab === x ? 'active' : ''} onClick={() => setTab(x)} key={x}>{x}</button>)}</nav><div>{tab === 'output' && <span>Run a Safe Test to inspect stdout and downstream behavior in the execution panel.</span>}{tab === 'tests' && <span>Regression tests run with the node's sample inputs before production promotion.</span>}{tab === 'logs' && <span>Python stderr and process diagnostics appear in the workflow Logs tab.</span>}{tab === 'dependencies' && <span>{(data.dependencies || []).length ? `Isolated cached environment: ${(data.dependencies || []).join(', ')}${data.allowPackageInstall ? ' · installation approved' : ' · awaiting installation approval'}` : 'No additional packages. Uses the system Python 3 interpreter.'}</span>}{tab === 'versions' && <span>Code is stored with the versioned workflow definition.</span>}{tab === 'permissions' && <span>The script can read and write only inside its isolated run workspace. Package installation is an explicit per-node permission.</span>}</div></footer></section></div>
}

function BottomPanel({ open, height, tab, setTab, toggle, onResize, events, nodes, input, setInput, artifacts, sys, running, paused, approvals, errors, profileId, setProfileId, profiles, runId, variables, setVariables }: { open: boolean; height: number; tab: BottomTab; setTab: (t: BottomTab) => void; toggle: () => void; onResize: (e: React.PointerEvent) => void; events: Event[]; nodes: Node[]; input: string; setInput: (s: string) => void; artifacts: Artifact[]; sys: SystemInfo | null; running: boolean; paused: boolean; approvals: DurableApproval[]; errors: Event[]; profileId: string; setProfileId: (s: string) => void; profiles: Profile[]; runId: string; variables: Record<string, any>; setVariables: React.Dispatch<React.SetStateAction<Record<string, any>>> }) {
  const tabs: { id: BottomTab; label: string; count?: number }[] = [{ id: 'timeline', label: 'Timeline' }, { id: 'logs', label: 'Logs' }, { id: 'variables', label: 'Variables' }, { id: 'errors', label: 'Errors', count: errors.length }, { id: 'artifacts', label: 'Artifacts', count: artifacts.length }, { id: 'resources', label: 'Resources' }, { id: 'console', label: 'Console' }]
  const label = (id?: string) => String(nodes.find(n => n.id === id)?.data.label || id || 'Workflow')
  const [recovery, setRecovery] = useState('')
  const retry = async (nodeId?: string, scope: 'node' | 'branch' = 'branch') => { if (!runId) return; try { const result = await api.retryWorkflowRun(runId, nodeId, scope); setRecovery(`Recovery run ${result.runId} started. Open Run Center to monitor it.`) } catch (error) { setRecovery(`Retry could not start: ${error}`) } }
  return <section className={`execution-panel ${open ? 'open' : 'closed'}`} style={open ? { height } : undefined}>{open && <div className="bottom-resizer" onPointerDown={onResize} />}<div className="execution-tabs">{tabs.map(t => <button key={t.id} className={tab === t.id && open ? 'active' : ''} onClick={() => { setTab(t.id); if (!open) toggle() }}>{t.label}{t.count ? <em>{t.count}</em> : null}</button>)}<span className={`run-health ${running ? 'running' : errors.length ? 'failed' : ''}`}><i />{paused ? 'Paused' : running ? 'Running' : errors.length ? 'Needs attention' : 'Ready'}</span><button className="panel-toggle" onClick={toggle}>{open ? '⌄' : '⌃'}</button></div>{open && <div className="execution-content">
    {tab === 'timeline' && <div className="timeline-list">{events.length ? events.filter(e => e.type !== 'log').map((e, i) => { const approval = e.nodeId ? approvals.find(item => item.nodeId === e.nodeId && item.state === 'pending') : null; return <div key={i} className={`timeline-event ${e.type} ${approval ? 'approval-event' : ''}`}><time>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span className="timeline-dot" /><b>{label(e.nodeId)}</b><span>{e.text}{approval && <span className="approval-actions" data-approval-id={approval.id}><button onClick={() => { const comment = prompt('Optional direction for the next steps (for example, “Use concept 2”):') || ''; void api.approveWorkflowNode(runId, approval.nodeId, 'approved', comment, approval) }}>Approve</button><button onClick={() => { const comment = prompt('Why are you rejecting this result?') || ''; void api.approveWorkflowNode(runId, approval.nodeId, 'rejected', comment, approval) }}>Reject</button></span>}</span></div> }) : <div className="panel-empty">Run the workflow to see a chronological execution timeline.</div>}</div>}
    {tab === 'logs' && <pre className="execution-log">{events.map(e => `${new Date(e.t).toISOString()} ${e.nodeId ? `[${label(e.nodeId)}] ` : ''}${e.text}`).join('\n') || 'No logs yet.'}</pre>}
    {tab === 'variables' && <div className="variables-grid"><Field label="workflow_input"><textarea value={input} onChange={e => setInput(e.target.value)} placeholder="The request or data that starts this workflow" /></Field><Field label="model_tier"><select value={profileId} onChange={e => setProfileId(e.target.value)}><option value="">Use node policies</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><VariableEditor variables={variables} setVariables={setVariables} /><div className="secret-row"><span>Secrets</span><b>Secret references are selected by name; values are never stored in workflow JSON.</b></div></div>}
    {tab === 'errors' && <div>{errors.length ? errors.map((e, i) => <div className="execution-error" key={i}><b>{label(e.nodeId)} failed</b><p>{e.text}</p><span>Your workflow workspace and completed files are preserved. Completed checkpoints can be reused.</span><div className="error-recovery-actions"><button onClick={() => retry(e.nodeId, 'node')}>Retry node</button><button onClick={() => retry(e.nodeId, 'branch')}>Retry branch</button><button onClick={() => setTab('variables')}>Edit input</button><button onClick={() => setTab('logs')}>Technical details</button></div></div>) : <div className="panel-empty">No execution errors.</div>}{recovery && <div className="plain-callout">{recovery}</div>}</div>}
    {tab === 'artifacts' && <div className="artifact-list">{artifacts.length ? artifacts.map(a => <div key={a.name}><span>□</span><b>{a.name}</b><small>{Math.ceil(a.size / 1024)} KB</small></div>) : <div className="panel-empty">Files created by this run will appear here.</div>}</div>}
    {tab === 'resources' && <div className="resource-grid"><Resource label="Memory" value={sys ? `${sys.ram.usedGB.toFixed(1)} / ${sys.ram.totalGB.toFixed(0)} GB` : '—'} /><Resource label="Loaded models" value={String(sys?.loaded.length ?? '—')} /><Resource label="Disk free" value={sys ? `${sys.disk.freeGB.toFixed(0)} GB` : '—'} /><Resource label="Active runs" value={String(sys?.activeRuns ?? '—')} /><Resource label="Global model calls" value={sys ? `${sys.modelScheduling.active}/${sys.modelScheduling.limits.maxConcurrentCalls}` : '—'} /><Resource label="Global model queue" value={String(sys?.modelScheduling.queued ?? '—')} /><Resource label="Known model estimate" value={sys ? `${(sys.modelScheduling.activeEstimatedBytes / 1073741824).toFixed(1)} GB` : '—'} /><Resource label="Unknown estimates" value={String(sys?.modelScheduling.activeUnknownEstimates ?? '—')} /></div>}
    {tab === 'console' && <pre className="execution-log">{events.filter(e => e.type === 'log').map(e => e.text).join('\n') || 'Technical process output will appear here during a run.'}</pre>}
  </div>}</section>
}
function Resource({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div> }

function ArchitectDock({ input, setInput, busy, reply, proposal, diff, selected, onSend, onApply, onReject, onClose }: { input: string; setInput: (s: string) => void; busy: boolean; reply: string; proposal: Workflow | null; diff: string[]; selected?: string; onSend: () => void; onApply: () => void; onReject: () => void; onClose: () => void }) {
  const suggestions = selected ? [`Explain ${selected}`, 'Improve this step', 'Add a quality check'] : ['Explain this workflow', 'Find missing steps', 'Make everything local']
  return <aside className="architect-dock"><div className="architect-head"><span>✦</span><div><b>AI Architect</b><small>{selected ? `Focused on ${selected}` : 'Workflow context active'}</small></div><button onClick={onClose}>×</button></div><div className="architect-body">{!reply && <div className="architect-welcome"><span>✦</span><h3>Build, explain, or improve</h3><p>I review the current canvas and show a proposal before making changes.</p></div>}{reply && <div className="architect-message">{reply}</div>}{proposal && <div className="architect-proposal"><span>PROPOSED CHANGE</span><b>{proposal.name}</b><p>{proposal.nodes.length} nodes · {proposal.edges.length} connections. Nothing has changed yet.</p>{diff.length > 0 && <ul>{diff.map(line => <li key={line}>{line}</li>)}</ul>}<div><button onClick={onApply}>Apply proposal</button><button onClick={onReject}>Discard</button></div></div>}</div><div className="architect-suggestions">{suggestions.map(s => <button key={s} onClick={() => setInput(s)}>{s}</button>)}</div><div className="architect-compose"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend() }} placeholder="Ask, build, explain, or fix…" /><button disabled={busy || !input.trim()} onClick={onSend}>{busy ? '…' : '↑'}</button></div></aside>
}

function StudioContextMenu({ state, node, close, actions }: { state: NonNullable<ContextState>; node?: Node; close: () => void; actions: Record<string, () => void> }) {
  const run = (name: string) => { actions[name]?.(); close() }
  const disabled = !!(node?.data as any)?.disabled, breakpoint = !!(node?.data as any)?.breakpoint
  const style = { left: Math.min(state.x, window.innerWidth - 205), top: Math.min(state.y, window.innerHeight - 330) }
  if (state.kind === 'canvas') return <div className="studio-context-menu" style={style}><button onClick={() => run('addNode')}>＋ Add node</button><button onClick={() => run('autoLayout')}>⌘ Auto-layout</button><button onClick={() => run('fit')}>⌗ Fit workflow</button><hr /><button onClick={() => run('architect')}>✦ Ask AI to build here</button></div>
  if (state.kind === 'edge') return <div className="studio-context-menu" style={style}><button onClick={() => run('mapping')}>↔ View mapping</button><button onClick={() => run('addNode')}>＋ Insert node</button><button disabled title="Data monitoring is not available yet">◇ Monitor data · unavailable</button><hr /><button className="danger" onClick={() => run('remove')}>× Delete connection</button></div>
  return <div className="studio-context-menu" style={style}><button onClick={() => run('runNode')}>▶ Run this node</button><button onClick={() => run('runFrom')}>↦ Run from here</button><button onClick={() => run('test')}>✓ Test</button><button onClick={() => run('inspect')}>⚙ Edit</button><button onClick={() => run('duplicate')}>⧉ Duplicate</button><button onClick={() => run('toggleDisabled')}>{disabled ? '○ Enable' : '○ Disable'}</button><button onClick={() => run('breakpoint')}>{breakpoint ? '● Remove breakpoint' : '● Add breakpoint'}</button><hr /><button onClick={() => run('architect')}>✦ Ask AI Architect</button><button className="danger" onClick={() => run('remove')}>× Delete</button></div>
}
