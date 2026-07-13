# Workflow Studio Architecture

This document defines the durable contract behind Easy, Guided, Pro, and Developer modes. All modes edit the same versioned workflow graph; presentation never changes execution semantics.

## Canonical workflow document

```json
{
  "id": "workflow-id",
  "name": "Human-readable name",
  "project": "Command Center",
  "environment": "development",
  "settings": {
    "localOnly": true,
    "parallelism": 4,
    "maxDuration": 21600000,
    "retries": 1,
    "cache": true,
    "schedule": "manual"
  },
  "variables": { "quality_mode": "premium" },
  "nodes": [],
  "edges": []
}
```

Nodes have stable IDs, a runtime `type`, canvas `position`, and type-specific `data`. Edges have stable IDs and may contain route conditions or future typed field mappings. AI Architect proposals return the complete document and are applied only after a visible diff.

## Runtime invariants

- The server rejects unsafe IDs, missing endpoints, duplicate IDs/connections, unsupported node types, and graph cycles.
- Every run receives an isolated workspace under `~/agents-workspace/pipelines/<runId>`.
- Python, shell, and file nodes operate inside that workspace. File path traversal is rejected.
- Python dependencies require an explicit per-node install permission and use content-addressed cached virtual environments under `data/python-envs`; they never modify the system interpreter.
- `localOnly` blocks resolved cloud models at execution time, not merely in the UI.
- `maxDuration`, model retries, bounded critic loops, bounded mapping, HTTP timeouts, and process timeouts are enforced by the runner.
- Decision routes are deterministic. Inactive branches are recorded as skipped.
- Connection mappings select nested fields from JSON output and construct the destination JSON object using source-to-destination dot paths.
- Human approvals and breakpoints pause an active run without discarding completed work.
- Run state, events, outputs, routes, and checkpoint position are persisted during execution.
- Distinct workflow saves create content-addressed snapshots. Up to 50 versions are retained and restorable.
- Secrets are references only. Secret values never belong in workflow JSON, bundle exports, logs, or model prompts by default.

## Executable primitives

The current runner supports:

- Start/output: `input`, `output`
- External input: `file-input`, `folder-input`
- Agents: `agent`, `orchestrator`, `critic`, `parallel`, `map`
- Knowledge and validation: `search`, `pdf-reader`, `obsidian-read`, `obsidian-write`, `check`
- Control: `if`, `delay`, `human-approval`
- Code and data: `python`, `shell`, `json-transform`
- Files and integrations: `read-file`, `write-file`, `http`

Catalog entries marked **PLANNED** are discoverable design commitments, not fake controls. A planned node becomes executable only after it has schema validation, runner behavior, inspector configuration, permission semantics, error messages, and automated tests.

## Extension contract

When adding a node:

1. Add its catalog definition and professional category identity.
2. Add runtime metadata and concise canvas rendering.
3. Add inspector fields with beginner-facing help.
4. Add the type to server validation.
5. Implement deterministic execution and actionable errors.
6. Define permission and workspace boundaries.
7. Add a smoke or regression test.
8. Update this document and implementation status.

Reusable knowledge should use the smallest correct surface:

- Workflow variables for portable values.
- AgentBrain skills for reusable task playbooks.
- Templates for reusable graphs.
- MCP/tools for live external capabilities.
- Workflow versions and evaluations for controlled improvement.

## Controlled self-improvement

“Self-learning” means collecting evidence and proposing versioned improvements, not silently rewriting production workflows or model weights. The intended loop is:

1. Record run inputs, outputs, errors, timings, approvals, and evaluation scores.
2. Detect repeated successful patterns or failures.
3. Propose a skill, template, prompt, test, or graph change.
4. Show a human-readable diff and expected effect.
5. Run regression evaluations in Testing.
6. Promote an approved version to Production.

Fine-tuning can later consume curated traces, but the orchestration system does not depend on fine-tuning to remain useful as models change.

## Next runtime slices

Highest-value additions are DOCX/spreadsheet extraction, true item-level subgraph mapping, richer typed port schemas and mapping previews, MCP execution nodes, resumable retry-from-node, schedules/webhooks, group/subworkflow organization, and production promotion locks.
