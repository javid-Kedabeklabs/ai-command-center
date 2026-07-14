export type SystemInfo = {
  ram: { totalGB: number; usedGB: number }
  disk: { totalGB: number; freeGB: number }
  services: { lmstudio: boolean; opencode: boolean; comfy?: boolean }
  loaded: { id: string; context: number; estimatedBytes?: number | null }[]
  modelCount: number
  activeRuns: number
  modelScheduling: {
    limits: { maxConcurrentCalls: number; memoryBudgetBytes: number | null }
    active: number; queued: number; activeEstimatedBytes: number; queuedEstimatedBytes: number
    activeUnknownEstimates: number; queuedUnknownEstimates: number
    loadedKnownEstimatedBytes: number; loadedUnknownEstimates: number
  }
  downloads: Record<string, { status: string; pct: number }>
}
export type Model = {
  id: string; state: 'loaded' | 'not-loaded'; arch: string; quant?: string
  maxContext: number; loadedContext: number | null; downloading: boolean
  estimatedBytes?: number | null
}
export type AgentArchitectureIdentity = { primitiveId: string; roleCardId: string; roleCardVersion: number; agentInstanceId: string; organizationalClass: string; status: string }
export type Agent = { id: string; avatar: string; name: string; model: string; prompt: string; folder: string; permissions?: string; skills?: string[]; role?: string; department?: string; manager?: string; contextLimit?: number; tokenBudget?: number; timeBudget?: number; retryBudget?: number; architecture?: AgentArchitectureIdentity | null }
export type AgentMigrationProposal = { legacyAgentId: string; status: 'READY' | 'REVIEW_REQUIRED'; confidence: string; primitiveId: string | null; primitiveCandidates: string[]; ambiguityReasons: string[]; legacySnapshotHash: string; proposedRoleCard: Record<string, unknown> | null; preservedLegacyConfiguration: Agent }
export type AgentMigrationPreview = { schemaVersion: number; mode: 'preview-only'; mutationPerformed: false; architectureRevision: number; summary: { total: number; ready: number; reviewRequired: number }; proposals: AgentMigrationProposal[] }
export type AgentArchitectureState = { schemaVersion: number; revision: number; roleCards: Record<string, any>; instructionProfiles: Record<string, any>; agentInstances: Record<string, any>; workflowAssignments: Record<string, any>; migrationReceipts: any[]; primitives: any[] }
export type Skill = { path: string; name: string; title: string; preview: string }
export type PermInfo = { key: string; summary: string }
export type AuditEntry = { t: number; action: string; detail: unknown }
export type ToolInfo = { key: string; name: string; desc: string; status: string; mcp?: boolean; type?: string; trustStatus?: string; reviewStatus?: string; authReference?: { id: string; mode: string } | null }
export type SecretReference = { id: string; label: string; revision: number; createdAt: number; updatedAt: number; configured: boolean; status: 'connected' | 'missing' | 'denied'; secretStore: string; usedByCount: number }
export type RunSummary = { id: string; type?: string; title?: string; agentName?: string; avatar: string; task: string; status: string; started: number; ended?: number; workflowId?: string | null; workflowVersion?: string | null; candidateId?: string | null; environment?: string | null }
export type RunArtifact = { name: string; size: number; isDir?: boolean }
export type RunDetail = { id: string; type?: string; title?: string; workflowName?: string; agentName?: string; avatar?: string; task?: string; status: string; paused?: boolean; recoveredBy?: string; started?: number; ended?: number; result?: string; events?: RunEvent[]; artifacts?: RunArtifact[]; control?: { manualPause?: { paused: boolean; generation: number }; approvals?: Record<string, { id: string; nodeId: string; subjectHash: string; revision: number; state: string }> }; checkpoint?: { schemaVersion?: number; revision?: number; nodes?: Record<string, { state: string; attemptsStarted: number }> } }
export type RunEvidence = { schemaVersion: number; evidenceId: string; run: { id: string; logicalRunId: string; workflowId: string | null; workflowVersion: string | null; workflowVersionHash: string | null; status: string; started: number | null; ended: number | null; resumedFrom: string | null; recoveredBy: string | null }; triggerReceipt: { receiptRef: string; deliveryId: string; triggerId: string; workflowVersion: string } | null; manualPause: { paused: boolean; generation: number } | null; approvals: Array<{ id: string; nodeId: string; subjectHash: string; revision: number; state: string }>; checkpoint: { schemaVersion: number | null; revision: number | null; nodes: Record<string, { state: string; attemptsStarted: number; inputHash: string | null; outputHash: string | null; effect: { operationKey: string; requestHash: string; state: string; receiptRef: string | null } | null }> }; events: RunEvent[]; artifacts: RunArtifact[] }
export type Artifact = { runId: string; name: string; size: number; mtime: number; source: string; type: string; status: string }
export type KnowledgeSource = { id: string; name: string; type: string; chunks: number; addedAt: number }
export type KnowledgeHit = { text: string; source: string; score: number }
export type RunEvent = { t: number; type: 'info' | 'log' | 'done' | 'error'; text: string }
export type BrainFile = { path: string; section: string; name: string; size: number; mtime: number }
export type BrainGraph = { nodes: BrainFile[]; links: { source: string; target: string }[] }
export type StudioModel = { name: string; type: 'flux' | 'sdxl'; label: string; desc: string; tags: string[]; ready: boolean }
export type Provider = { name: string; label: string; configured: boolean }
export type AllModel = { ref: string; provider: string; label: string; kind: 'local' | 'cloud' | 'role' | 'policy' }
export type PortType = 'any' | 'text' | 'number' | 'boolean' | 'object' | 'array' | 'table' | 'file' | 'files' | 'control' | 'error' | 'approval' | 'artifact' | 'memory' | 'image' | 'audio' | 'video' | 'code' | 'stream' | 'data'
export type PortDefinition = { id: string; type: PortType; label: string; required?: boolean; schema?: Record<string, any> }
export type NodeContract = { inputs: PortDefinition[]; outputs: PortDefinition[] }
export type NodeContractsResponse = { portTypes: PortType[]; contracts: Record<string, NodeContract>; custom: Array<Record<string, any> & { id: string; inputs: PortDefinition[]; outputs: PortDefinition[] }> }
export type WfNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, any> & { label?: string; model?: string; instruction?: string }; ports?: NodeContract; definitionVersion?: number; groupId?: string; permissions?: Record<string, boolean> }
export type WfEdge = { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data?: { condition?: 'true' | 'false'; mapping?: Record<string, string>; label?: string; coercion?: PortType; schema?: Record<string, any> } }
export type WorkflowGroup = { id: string; title?: string; label?: string; description?: string; color?: string; department?: string; parentGroupId?: string | null; order: number; collapsed: boolean; disabled: boolean; position: { x: number; y: number }; width?: number; height?: number; nodeIds: string[]; [key: string]: any }
export type WorkflowComment = { id: string; text: string; position: { x: number; y: number }; anchor?: { type: 'node' | 'group'; id: string; [key: string]: any } | null; resolved: boolean; createdAt?: number; updatedAt?: number; [key: string]: any }
export type Workflow = { schemaVersion?: number; id: string; name: string; metadata?: Record<string, any>; nodes: WfNode[]; edges: WfEdge[]; environment?: string; project?: string; settings?: Record<string, any>; variables?: Record<string, any>; groups?: WorkflowGroup[]; comments?: WorkflowComment[]; secretReferences?: any[]; triggers?: any[]; evaluations?: any[]; governance?: Record<string, any> }
export type TriggerHistoryPage = { items: any[]; nextCursor: string | null }
export type WfSummary = { id: string; name: string; nodes: number }
export type WorkflowVersion = { id: string; savedAt: number; hash: string; name: string; nodes: number; current?: boolean }
export type GovernanceCandidate = { schemaVersion: number; id: string; workflowId: string; workflowVersion: string; sourceHash: string; operationalHash: string; permissionHash: string; secretManifestHash: string; dependencyHash: string; environment: 'development' | 'testing'; status: string; createdBy: string; createdAt: number; recordHash: string }
export type GovernanceRecord = { id: string; type: string; workflowId: string; workflowVersion: string; workflowHash: string; operationalHash: string; candidateId: string; selectedGateResultIds: string[]; actor: string; reason: string; createdAt: number; recordHash: string; [key: string]: any }
export type WorkflowLifecycle = { workflowId: string; migration: { changed: boolean; reviewRequired: boolean; lifecycle: { state: string; reviewRequired: boolean; testingCandidateId?: string; testingApprovalId?: string; productionCandidateId?: string; productionApprovalId?: string; deploymentId?: string; rollbackId?: string; testingGateResultIds?: string[]; productionGateResultIds?: string[] } }; approvals: GovernanceRecord[]; deployments: GovernanceRecord[]; rollbacks: GovernanceRecord[] }
export type PluginReviewReceipt = { schemaVersion: number; id: string; pluginId: string; pluginVersion: string; manifestHash: string; decision: 'approved'; reviewedBy: string; reviewedAt: number; receiptHash: string }
export type PluginInfo = { id: string; name: string; version: string; description?: string; publisher?: string; license?: string; verified?: boolean; installed?: boolean; enabled?: boolean; permissions?: string[]; dependencies?: string[]; provenance?: Record<string, any>; signatureStatus?: string; trustStatus?: string; manifestHash?: string; reviewReceipt?: PluginReviewReceipt }
export type WorkflowComponent = { id: string; name: string; description: string; nodeCount: number; currentVersionId: string | null; currentVersionHash: string | null; available: boolean; archived: boolean; unavailableReason: string | null }
export type ComponentImportReview = { rootComponentId: string; componentCount: number; dependencyCount: number; executableNodes: number; conflicts: { componentId: string; type: string; message: string }[]; approvable: boolean }
export type ComponentImportProposal = { status: string; proposalId: string; review: ComponentImportReview }
export type Template = { id: string; category: string; title: string; produces: string; needs: string; complexity: string; localOnly: boolean; beginner: boolean; note?: string; nodeCount: number }
export type Profile = { id: string; name: string; roles: Record<string, string> }
export type ProfilesResp = { profiles: Profile[]; roles: string[] }
export type LocalFactoryStatus = { enabled: boolean; model: string; endpoint: string; concurrency: number; maxQueue: number; queued: number; active: number; completed: number; closed: boolean }
export type LocalFactoryTaskSummary = { taskId: string; status: string; relativePath: string; createdAt: number; updatedAt: number }
export type CollaborationStatus = {
  enabled: boolean; worktreeEnabled: boolean; worktreeUnavailableReason: string | null; dispatchEnabled: boolean; dispatchUnavailableReason: string | null
  dispatchContract: { schemaVersion: number; verified: boolean; prerequisites: string[] }
  taskPacketContract: { currentSchemaVersion: number; legacyReadOnlyCompatibility: boolean; newLegacyPacketsAccepted: boolean; contractComplete: number; upgradeRequired: number }
  metrics: { schemaVersion: number; mode: string; observations: number; defects: number; byTaskClass: { taskType: string; worker: string; observations: number; accepted: number; firstPassRate: number | null; medianCalendarLeadSeconds: number | null; medianCodexBaselineSeconds: number | null; medianReviewSeconds: number | null; medianReworkSeconds: number | null; boundaryViolations: number; criticalDefects: number; recommendation: string; automaticAuthority: false }[]; qwen: { observations: number; acceptedFindingRate: number | null; falseBlockingFindings: number; medianReviewSeconds: number | null; recommendation: string; automaticAuthority: false } }
  policy: { centralRuntimeWriter: string; modifyingWorker: string; reviewer: string; automaticIntegration: boolean }
  counts: Record<string, number>; activeLeases: number; blockedLeases: number
  leaseRecovery: { recovered: string[]; blocked: string[]; missing: string[] }
}
export type CollaborationTaskSummary = { taskId: string; status: string; relativePath: string; createdAt: number; updatedAt: number; dispatchId?: string | null }
export type CollaborationLease = { taskId: string; state: string; reason: string | null; branch: string; baseSha: string; createdAt: number; updatedAt: number; endedAt: number | null }

const j = async (r: Response) => {
  if (r.ok) return r.json()
  let message = `${r.status} ${r.statusText}`.trim()
  try {
    const body = await r.json()
    if (body?.error) message = body.error
  } catch {}
  throw new Error(message)
}

export const api = {
  system: (): Promise<SystemInfo> => fetch('/api/system').then(j),
  localFactoryStatus: (): Promise<LocalFactoryStatus> => fetch('/api/local-factory/status').then(j),
  localFactoryTasks: (): Promise<LocalFactoryTaskSummary[]> => fetch('/api/local-factory/tasks').then(j),
  localFactoryTask: (taskId: string): Promise<any> => fetch(`/api/local-factory/tasks/${encodeURIComponent(taskId)}`).then(j),
  cancelLocalFactoryTask: (taskId: string): Promise<{ ok: boolean; taskId: string }> => fetch(`/api/local-factory/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }).then(j),
  collaborationStatus: (): Promise<CollaborationStatus> => fetch('/api/collaboration/status', { cache: 'no-store' }).then(j),
  collaborationTasks: (): Promise<CollaborationTaskSummary[]> => fetch('/api/collaboration/tasks', { cache: 'no-store' }).then(j),
  collaborationLeases: (): Promise<CollaborationLease[]> => fetch('/api/collaboration/leases', { cache: 'no-store' }).then(j),
  collaborationTask: (taskId: string): Promise<any> => fetch(`/api/collaboration/tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store' }).then(j),
  collaborationMetrics: (): Promise<any> => fetch('/api/collaboration/metrics', { cache: 'no-store' }).then(j),
  saveCollaborationTask: (packet: Record<string, unknown>): Promise<any> => fetch('/api/collaboration/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'collaboration-task-change' }, body: JSON.stringify(packet) }).then(j),
  models: (): Promise<Model[]> => fetch('/api/models').then(j),
  load: (id: string, context: number) =>
    fetch('/api/models/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, context }) }).then(j),
  unload: (id: string) =>
    fetch('/api/models/unload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).then(j),
  download: (name: string) =>
    fetch('/api/models/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(j),
  agents: (): Promise<Agent[]> => fetch('/api/agents').then(j),
  agentArchitecture: (): Promise<AgentArchitectureState> => fetch('/api/agent-architecture', { cache: 'no-store' }).then(j),
  agentMigrationPreview: (): Promise<AgentMigrationPreview> => fetch('/api/agents/migration-preview', { cache: 'no-store' }).then(j),
  migrateAgent: (id: string, body: { primitiveId?: string; expectedLegacyHash: string; expectedRevision: number; commandId: string }): Promise<any> => fetch(`/api/agents/${encodeURIComponent(id)}/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'agent-architecture-change' }, body: JSON.stringify(body) }).then(j),
  rollbackAgentMigration: (id: string, body: { expectedLegacyHash: string; expectedRevision: number; commandId: string }): Promise<any> => fetch(`/api/agents/${encodeURIComponent(id)}/migration-rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'agent-architecture-change' }, body: JSON.stringify(body) }).then(j),
  saveAgent: (a: Partial<Agent>) =>
    fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).then(j),
  deleteAgent: (id: string) => fetch(`/api/agents/${id}`, { method: 'DELETE' }).then(j),
  runTask: (agentId: string, task: string): Promise<{ runId: string }> =>
    fetch(`/api/agents/${agentId}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) }).then(j),
  stopRun: (runId: string) => fetch(`/api/runs/${runId}/stop`, { method: 'POST' }).then(j),
  pauseRun: (runId: string) => fetch(`/api/runs/${runId}/pause`, { method: 'POST' }).then(j),
  resumeRun: (runId: string) => fetch(`/api/runs/${runId}/resume`, { method: 'POST' }).then(j),
  runs: (): Promise<RunSummary[]> => fetch('/api/runs').then(j),
  companyWorld: (): Promise<any> => fetch('/api/company-world/state').then(j),
  createDepartment: (name: string, color: string): Promise<any> => fetch('/api/company-world/departments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'organization-change' }, body: JSON.stringify({ name, color }) }).then(j),
  deleteDepartment: (id: string, revision: number): Promise<any> => fetch(`/api/company-world/departments/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE', headers: { 'X-Command-Center-Intent': 'organization-change' } }).then(j),
  runDetail: (id: string): Promise<RunDetail> => fetch(`/api/runs/${id}/detail`).then(j),
  runEvidence: (id: string): Promise<RunEvidence> => fetch(`/api/runs/${id}/evidence`).then(j),
  artifacts: (): Promise<Artifact[]> => fetch('/api/artifacts').then(j),
  artifactText: (runId: string, name: string): Promise<string> => fetch(`/api/runs/${runId}/artifact?name=${encodeURIComponent(name)}`).then(r => r.text()),
  brainTree: (): Promise<BrainFile[]> => fetch('/api/brain/tree').then(j),
  brainFile: (p: string): Promise<{ path: string; content: string }> =>
    fetch(`/api/brain/file?path=${encodeURIComponent(p)}`).then(j),
  brainSave: (p: string, content: string) =>
    fetch('/api/brain/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, content }) }).then(j),
  brainDelete: (p: string) => fetch(`/api/brain/file?path=${encodeURIComponent(p)}`, { method: 'DELETE' }).then(j),
  brainGraph: (): Promise<BrainGraph> => fetch('/api/brain/graph').then(j),
  studioModels: (): Promise<StudioModel[]> => fetch('/api/studio/models').then(j),
  studioGenerate: (body: Record<string, unknown>): Promise<{ promptId: string; seed: number }> =>
    fetch('/api/studio/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  studioResult: (id: string): Promise<{ status: string; images?: string[] }> =>
    fetch(`/api/studio/result/${id}`).then(j),
  studioGallery: (): Promise<string[]> => fetch('/api/studio/gallery').then(j),
  videoStatus: (): Promise<{ ready: boolean; model: string | null; encoder: string | null; downloadPct: number | null }> => fetch('/api/studio/video/status').then(j),
  generateVideo: (body: Record<string, unknown>): Promise<{ promptId: string }> =>
    fetch('/api/studio/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  providers: (): Promise<Provider[]> => fetch('/api/providers').then(j),
  addProvider: (provider: string, apiKey: string) =>
    fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, apiKey }) }).then(j),
  delProvider: (name: string) => fetch(`/api/providers/${name}`, { method: 'DELETE' }).then(j),
  secretReferences: (): Promise<SecretReference[]> => fetch('/api/secret-references', { cache: 'no-store' }).then(j),
  createSecretReference: (id: string, label: string, value: string): Promise<SecretReference> => fetch('/api/secret-references', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'secret-reference-change' }, body: JSON.stringify({ id, label, value }) }).then(j),
  rotateSecretReference: (id: string, expectedRevision: number, value: string): Promise<SecretReference> => fetch(`/api/secret-references/${encodeURIComponent(id)}/value`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'secret-reference-change' }, body: JSON.stringify({ expectedRevision, value }) }).then(j),
  deleteSecretReference: (id: string, expectedRevision: number): Promise<{ ok: boolean }> => fetch(`/api/secret-references/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'secret-reference-change' }, body: JSON.stringify({ expectedRevision }) }).then(j),
  allModels: (): Promise<AllModel[]> => fetch('/api/allmodels').then(j),
  workflows: (): Promise<WfSummary[]> => fetch('/api/workflows').then(j),
  workflowComponents: (): Promise<WorkflowComponent[]> => fetch('/api/workflow-components').then(j),
  renameWorkflowComponent: (id: string, name: string, description?: string): Promise<WorkflowComponent> => fetch(`/api/workflow-components/${encodeURIComponent(id)}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) }).then(j),
  archiveWorkflowComponent: (id: string): Promise<WorkflowComponent> => fetch(`/api/workflow-components/${encodeURIComponent(id)}/archive`, { method: 'POST' }).then(j),
  exportWorkflowComponent: (id: string): Promise<Blob> => fetch(`/api/workflow-components/${encodeURIComponent(id)}/manifest`).then(async response => { if (!response.ok) return j(response); return response.blob() }),
  stageWorkflowComponentImport: (manifest: unknown): Promise<ComponentImportProposal> => fetch('/api/workflow-components/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manifest) }).then(j),
  decideWorkflowComponentImport: (proposalId: string, decision: 'approve' | 'reject'): Promise<{ ok: boolean; status: string; review?: ComponentImportReview }> => fetch(`/api/workflow-components/imports/${encodeURIComponent(proposalId)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }).then(j),
  workflow: (id: string): Promise<Workflow> => fetch(`/api/workflows/${id}`).then(j),
  saveWorkflow: (w: Workflow): Promise<Workflow> =>
    fetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w) }).then(j),
  workflowVersions: (id: string): Promise<WorkflowVersion[]> => fetch(`/api/workflows/${id}/versions`).then(j),
  workflowLifecycle: (id: string): Promise<WorkflowLifecycle> => fetch(`/api/workflows/${encodeURIComponent(id)}/lifecycle`).then(j),
  workflowCandidates: (id: string): Promise<GovernanceCandidate[]> => fetch(`/api/workflows/${encodeURIComponent(id)}/candidates`).then(j),
  createWorkflowCandidate: (id: string, by = 'local-owner'): Promise<GovernanceCandidate> => fetch(`/api/workflows/${encodeURIComponent(id)}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ by }) }).then(j),
  transitionWorkflowLifecycle: (id: string, body: Record<string, unknown>): Promise<{ workflow: Workflow; lifecycle: WorkflowLifecycle['migration']['lifecycle'] }> => fetch(`/api/workflows/${encodeURIComponent(id)}/lifecycle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  workflowNodeContracts: (): Promise<NodeContractsResponse> => fetch('/api/workflow-node-contracts').then(j),
  customNodes: (): Promise<any[]> => fetch('/api/custom-nodes').then(j),
  saveCustomNode: (definition: Record<string, unknown>): Promise<any> => fetch('/api/custom-nodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(definition) }).then(j),
  deleteCustomNode: (id: string) => fetch(`/api/custom-nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j),
  plugins: (): Promise<PluginInfo[]> => fetch('/api/plugins').then(j),
  installPlugin: (id: string): Promise<any> => fetch('/api/plugins/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).then(j),
  installPluginBundle: (plugin: Record<string, unknown>): Promise<any> => fetch('/api/plugins/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plugin }) }).then(j),
  togglePlugin: (id: string, enabled: boolean): Promise<any> => fetch(`/api/plugins/${encodeURIComponent(id)}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }).then(j),
  reviewPlugin: (id: string, expectedManifestHash: string): Promise<PluginInfo> => fetch(`/api/plugins/${encodeURIComponent(id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', by: 'owner', expectedManifestHash }) }).then(j),
  uninstallPlugin: (id: string) => fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j),
  testPlugin: (id: string): Promise<any> => fetch(`/api/plugins/${encodeURIComponent(id)}/test`, { method: 'POST' }).then(j),
  exportPlugin: (id: string): Promise<any> => fetch(`/api/plugins/${encodeURIComponent(id)}/export`).then(j),
  previewConnection: (body: Record<string, unknown>): Promise<{ value: unknown; valid: boolean; errors: string[] }> => fetch('/api/workflow-connections/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  restoreWorkflowVersion: (id: string, versionId: string): Promise<Workflow> => fetch(`/api/workflows/${id}/versions/${versionId}/restore`, { method: 'POST' }).then(j),
  delWorkflow: (id: string) => fetch(`/api/workflows/${id}`, { method: 'DELETE' }).then(j),
  runWorkflow: (id: string, input: string, profileId?: string, safe?: boolean, options?: { nodeId?: string; nodeIds?: string[]; runMode?: 'full' | 'selected' | 'from' | 'branch'; resumeRunId?: string; fromNodeId?: string; candidateId?: string; workflowVersion?: string }): Promise<{ runId: string }> =>
    fetch(`/api/workflows/${id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, profileId, safe, ...(options || {}) }) }).then(j),
  retryWorkflowRun: (runId: string, nodeId?: string, scope: 'node' | 'branch' = 'branch', input?: string): Promise<{ runId: string }> => fetch(`/api/workflows/runs/${runId}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId, scope, input }) }).then(j),
  workflowCheckpoint: (runId: string): Promise<Record<string, any>> => fetch(`/api/workflows/runs/${runId}/checkpoint`).then(j),
  workflowTriggers: (workflowId: string): Promise<any[]> => fetch(`/api/triggers?workflowId=${encodeURIComponent(workflowId)}`).then(j),
  workflowTriggerHistory: (workflowId: string, limit = 50): Promise<TriggerHistoryPage> => fetch(`/api/triggers/history?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}`).then(j),
  createWorkflowTrigger: (workflowId: string, type: 'interval' | 'cron' | 'webhook' | 'folder', config: Record<string, unknown>): Promise<any> => fetch(`/api/workflows/${encodeURIComponent(workflowId)}/triggers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, config }) }).then(j),
  rotateWorkflowWebhookSecret: (id: string, expectedRevision: number, idempotencyKey: string): Promise<any> => fetch(`/api/triggers/${encodeURIComponent(id)}/webhook-secret/rotate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'webhook-credential-change', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expectedRevision }) }).then(j),
  revokeWorkflowWebhookSecret: (id: string, expectedRevision: number): Promise<any> => fetch(`/api/triggers/${encodeURIComponent(id)}/webhook-secret/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Center-Intent': 'webhook-credential-change' }, body: JSON.stringify({ expectedRevision }) }).then(j),
  updateWorkflowTrigger: (id: string, enabled: boolean): Promise<any> => fetch(`/api/triggers/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }).then(j),
  deleteWorkflowTrigger: (id: string) => fetch(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j),
  testWorkflowTrigger: (id: string, input = ''): Promise<{ runId: string }> => fetch(`/api/triggers/${encodeURIComponent(id)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) }).then(j),
  evaluations: (): Promise<any[]> => fetch('/api/evaluations').then(j),
  evaluationDatasets: (): Promise<any[]> => fetch('/api/evaluation-datasets').then(j),
  saveEvaluationDataset: (dataset: Record<string, unknown>): Promise<any> => fetch('/api/evaluation-datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dataset) }).then(j),
  deleteEvaluationDataset: (id: string): Promise<any> => fetch(`/api/evaluation-datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j),
  saveEvaluation: (suite: Record<string, unknown>): Promise<any> => fetch('/api/evaluations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(suite) }).then(j),
  runEvaluation: (id: string, body: { runId?: string; output?: string }): Promise<any> => fetch(`/api/evaluations/${encodeURIComponent(id)}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  runDatasetEvaluation: (id: string, body: { candidateId?: string; cases: Array<{ caseId: string; runId: string }> }): Promise<any> => fetch(`/api/evaluations/${encodeURIComponent(id)}/dataset-run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  setEvaluationBaseline: (id: string, recordId: string): Promise<any> => fetch(`/api/evaluations/${encodeURIComponent(id)}/baseline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId }) }).then(j),
  deleteEvaluation: (id: string) => fetch(`/api/evaluations/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j),
  learningProposals: (): Promise<any[]> => fetch('/api/learning/proposals').then(j),
  analyzeLearning: (workflowId: string): Promise<any[]> => fetch('/api/learning/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowId }) }).then(j),
  decideLearningProposal: (id: string, decision: 'approved' | 'rejected'): Promise<any> => fetch(`/api/learning/proposals/${encodeURIComponent(id)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, commandId: crypto.randomUUID(), actor: 'local-owner' }) }).then(j),
  verifyLearningProposal: (id: string, recordId: string): Promise<any> => fetch(`/api/learning/proposals/${encodeURIComponent(id)}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId, commandId: crypto.randomUUID(), actor: 'local-owner' }) }).then(j),
  approveWorkflowNode: (runId: string, nodeId: string, decision: 'approved' | 'rejected', comment = '', approval?: { id: string; revision: number; subjectHash: string }) => fetch(`/api/workflows/runs/${runId}/nodes/${nodeId}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, comment, ...(approval ? { commandId: `ui-${approval.id}-${decision}`, expectedRevision: approval.revision, expectedSubjectHash: approval.subjectHash } : {}) }) }).then(j),
  generateWorkflow: (goal: string, model?: string): Promise<Workflow> =>
    fetch('/api/workflows/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal, model }) }).then(j),
  testNode: (model: string, instruction: string, input: string): Promise<{ output: string }> =>
    fetch('/api/workflows/testnode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, instruction, input }) }).then(j),
  architect: (command: string, workflow: unknown, selectedNodeId?: string | null, model?: string): Promise<{ reply: string; workflow?: Workflow | null }> =>
    fetch('/api/architect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, workflow, selectedNodeId, model }) }).then(j),
  profilesGet: (): Promise<ProfilesResp> => fetch('/api/profiles').then(j),
  saveProfile: (p: Profile): Promise<Profile> =>
    fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(j),
  delProfile: (id: string) => fetch(`/api/profiles/${id}`, { method: 'DELETE' }).then(j),
  bundleImport: (bundle: unknown): Promise<{ ok: boolean; status: string; proposalId: string; summary: Record<string, number>; risks: string[] }> =>
    fetch('/api/bundle/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) }).then(j),
  decideBundleImport: (proposalId: string, decision: 'approve' | 'reject', overwrite = false): Promise<{ ok: boolean; status: string; summary?: Record<string, number> }> => fetch(`/api/bundle/import/${encodeURIComponent(proposalId)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, overwrite }) }).then(j),
  templates: (): Promise<Template[]> => fetch('/api/templates').then(j),
  template: (id: string): Promise<Template & { workflow: Workflow }> => fetch(`/api/templates/${id}`).then(j),
  knowledge: (): Promise<KnowledgeSource[]> => fetch('/api/knowledge').then(j),
  addKnowledge: (body: { name: string; text?: string; pdfBase64?: string }): Promise<{ id: string; chunks: number }> =>
    fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  delKnowledge: (id: string) => fetch(`/api/knowledge/${id}`, { method: 'DELETE' }).then(j),
  searchKnowledge: (query: string, k = 4): Promise<KnowledgeHit[]> =>
    fetch('/api/knowledge/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, k }) }).then(j),
  tools: (): Promise<{ builtin: ToolInfo[]; mcp: ToolInfo[] }> => fetch('/api/tools').then(j),
  addMcp: (name: string, command: string, url: string, authRef = '') =>
    fetch('/api/tools/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, command, url, ...(authRef ? { authRef, authMode: 'bearer' } : {}) }) }).then(j),
  discoverMcp: (name: string): Promise<{ server: string; tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }> => fetch(`/api/tools/mcp/${encodeURIComponent(name)}/discover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(j),
  updateMcp: (name: string, enabled: boolean) => fetch(`/api/tools/mcp/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }).then(j),
  reviewMcp: (name: string, approved: boolean) => fetch(`/api/tools/mcp/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: approved, enabled: approved }) }).then(j),
  delMcp: (name: string) => fetch(`/api/tools/mcp/${name}`, { method: 'DELETE' }).then(j),
  killAll: (): Promise<{ ok: boolean; stopped: number }> => fetch('/api/killall', { method: 'POST', headers: { 'X-Command-Center-Intent': 'emergency-stop' } }).then(j),
  audit: (): Promise<AuditEntry[]> => fetch('/api/audit').then(j),
  permsInfo: (): Promise<PermInfo[]> => fetch('/api/permissions').then(j),
  skills: (): Promise<Skill[]> => fetch('/api/skills').then(j),
}

export function subscribeWfRun(runId: string, onEvent: (e: RunEvent & { nodeId?: string }) => void, onEnd: () => void, onRecovery?: (runId: string, detail: RunDetail) => void): () => void {
  let currentRunId = runId, es: EventSource | null = null, closed = false
  const connect = () => {
    if (closed) return
    es = new EventSource(`/api/workflows/runs/${currentRunId}/events`)
    es.onmessage = e => { try { onEvent(JSON.parse(e.data)) } catch {} }
    es.onerror = () => { es?.close(); es = null; void inspect(0) }
  }
  const inspect = async (attempt: number) => {
    if (closed) return
    try {
      const detail = await api.runDetail(currentRunId)
      if (detail.recoveredBy) {
        currentRunId = detail.recoveredBy
        const recovered = await api.runDetail(currentRunId)
        onRecovery?.(currentRunId, recovered)
        connect()
        return
      }
      if (['running', 'paused'].includes(detail.status)) { window.setTimeout(connect, 350); return }
      if (detail.status === 'interrupted' && attempt < 20) { window.setTimeout(() => void inspect(attempt + 1), 250); return }
    } catch {
      if (attempt < 20) { window.setTimeout(() => void inspect(attempt + 1), 250); return }
    }
    onEnd()
  }
  connect()
  return () => { closed = true; es?.close() }
}

export async function streamChat(model: string, messages: { role: string; content: string }[], onChunk: (s: string) => void) {
  const r = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
  })
  if (!r.ok || !r.body) throw new Error(await r.text())
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk(dec.decode(value, { stream: true }))
  }
}

export function subscribeEvents(onData: (s: SystemInfo) => void): () => void {
  const es = new EventSource('/api/events')
  es.onmessage = e => { try { onData(JSON.parse(e.data)) } catch {} }
  return () => es.close()
}

export function subscribeRun(runId: string, onEvent: (e: RunEvent) => void, onEnd: () => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`)
  es.onmessage = e => { try { onEvent(JSON.parse(e.data)) } catch {} }
  es.onerror = () => { es.close(); onEnd() }
  return () => es.close()
}
