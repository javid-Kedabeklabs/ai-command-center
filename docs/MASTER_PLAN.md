# AI Command Center Master Plan

Status: authoritative implementation contract
Updated: 2026-07-13
Repository: `/Users/kedabektechlabs/command-center`
Runtime: `http://localhost:1717`

## 1. Executive assessment

AI Command Center is a working local-first orchestration prototype with an unusually complete Studio shell and a meaningful runtime vertical slice. Its strongest assets are the shared multi-mode graph, AI proposal workflow, Python isolation, observable execution, local model integration, approvals, artifacts, and version history. Its critical weaknesses are the monolithic runner, incomplete canonical schemas, limited permission enforcement, JSON stores without transactional event semantics, incomplete graph-level parallelism/recovery, and an executable catalog substantially narrower than the product vision.

The evidence-weighted baseline estimate was **62% of the original 26-part Workflow Studio blueprint at the beginning of this contract**. It is retained as the audited starting point, not silently revised after each feature and not presented as an enterprise-readiness score. Current implementation evidence is maintained in `docs/IMPLEMENTATION_STATUS.md` and `state/last-run-summary.md`. Phase 0 and the latest regression gate include the original 30-check live smoke suite plus 26 focused interrupted-capability checks, TypeScript, production build, Node syntax, and live server startup.

## 2. Current maturity audit

| # | Blueprint area | Weight | Status | Evidence and remaining work |
|---:|---|---:|---|---|
| 1 | Product experience | 4 | Mostly complete | Conversational, visual, and Python-oriented technical editing share one graph. Broader code/database surfaces remain. |
| 2 | Five-region Studio | 5 | Mostly complete | All regions, resizing, collapse, fullscreen, layouts, and Architect docking work. Free-form docking remains. |
| 3 | Command bar | 4 | Mostly complete | Workspace/project/workflow/mode/environment/run controls exist. Versions, selected-run actions, and scheduling need completion. |
| 4 | Node Library | 5 | Partial | Search, categories, templates, executable/planned truth labels, custom nodes, and a reusable-component tab exist. Favorites, recent, plugin breadth, and catalog breadth remain. |
| 5 | Node design | 4 | Mostly complete | Consistent professional cards, statuses, breakpoint, compact mode. Expanded cards and real multi-port rendering remain. |
| 6 | Drag/drop | 4 | Partial | Drop, quick setup, and selected-edge smart insertion work. Recommendations and contextual plus-menu breadth remain. |
| 7 | Inspector | 5 | Partial | Five tabs and type-specific controls exist. Test history, schemas, full permission matrix, and production actions remain. |
| 8 | Python UX | 5 | Partial | Fullscreen editor, modes, dependencies, isolation, timeout, and runtime work. AI code diff, regression tests, resource/network enforcement remain. |
| 9 | Connections | 5 | Mostly complete | Typed schemas, static/runtime validation, coercion, nested mapping, previews, and repair suggestions execute. Rich transformation authoring and complete typed error-route UX remain. |
| 10 | AI Architect | 4 | Partial | Context-aware proposals and visible diffs work. Apply-selected, persistent conversations, evaluation-aware repair, and broader actions remain. |
| 11 | Canvas organization | 4 | Mostly complete | Persistent nested groups, cycle-safe reparenting, recursive collapse/disable/run behavior, executable version-pinned child-workflow extraction, inherited child safety ceilings, explicit pin review/update, reusable discovery/lifecycle, breadcrumbs, non-executable anchored review comments, and reviewed portable component manifests work. Browser regression evidence remains. |
| 12 | Easy Mode | 3 | Mostly complete | Outcome stage view and shared graph work. Expandable stage detail and richer plain-language recovery remain. |
| 13 | Guided Mode | 3 | Mostly complete | Five-step wizard proposes into Architect. Adaptive follow-up questions and resource estimates remain. |
| 14 | Run experience | 5 | Mostly complete | Live statuses, durable bounded fan-out/fan-in, selected/from/branch runs, retry, checkpoints, pause/stop/approval, subprocess cancellation, and restart continuation work. Complete shared resource scheduling remains. |
| 15 | Bottom panel | 4 | Mostly complete | Required tabs and live events exist. Model/tool traffic, GPU/context/cost detail, and interactive console remain. |
| 16 | Error handling | 4 | Partial | Failed nodes and plain-language safety guidance are visible with real retry-node/retry-branch actions. Downstream impact and automated repair remain. |
| 17 | Variables/secrets | 4 | Partial | Portable variables exist; provider values use macOS Keychain and are redacted from APIs/exports. General typed secret references and node pickers remain. |
| 18 | Workflow settings | 4 | Partial | Real cron/interval/webhook/folder triggers, execution/model/permission concepts, versions, and promotion gates exist. Complete manager UI and input/output contracts remain. |
| 19 | Templates/components | 3 | Mostly complete | Templates, premium website workflow, selected-branch extraction, stable pinned execution, redacted reusable discovery, pinned insertion, rename, dependency-safe archive, and deterministic dependency-aware export/staged import manifests exist. Broader marketplace packaging remains. |
| 20 | Custom nodes | 3 | Partial | No-code typed wizard, delegated runtime, version history, plugin trust/review, lifecycle, and focused tests work. Signed packaging and complete adapter test UX remain. |
| 21 | Visual language | 3 | Mostly complete | Calm dark canvas, category tones, icons, states, and responsive layout exist. Reduced motion and configurable edge styles remain. |
| 22 | Context menus | 3 | Partial | Node/edge/canvas menus exist; several advanced actions are still unavailable. |
| 23 | Productivity | 3 | Mostly complete | Command palette plus save, undo/redo, delete, fit, run, safe run, selected run, node search, explain, and Architect shortcuts exist. Complete copy/paste and discoverability remain. |
| 24 | AI explanations | 3 | Partial | Architect explains selected context. Per-setting beginner/technical explanations and recommendations remain. |
| 25 | Default experience | 2 | Mostly complete | Home intent entry, starters, onboarding, proposal flow, and simplified view exist. |
| 26 | 3D Website Studio | 4 | Partial | Real 16-node local-first template exists. Specialist breadth and browser/performance/accessibility/media tool semantics remain. |

Company World, organizational agent management, the Skill Foundry, broad plugin packaging, and enterprise hardening are additional contract scope beyond the original 26 sections and are tracked in later phases.

Two additive architecture amendments govern all subsequent phases without replacing their dependency order:

- `docs/DUAL_AGENT_ARCHITECTURE.md`: Codex remains lead architect/integrator; Claude Code is a bounded worker or read-only advisor behind task packets, exclusive file ownership, isolated worktrees, fixture-tested dispatch, and a mandatory Codex integration gate.
- `docs/AGENT_ROLE_MAPPING.md`: visible workers resolve through a small versioned primitive set and Role Cards. Workflow behavior and deterministic resource, approval, trigger, deployment, and rollback services are not modeled as LLM agents.

## 3. Target architecture

```text
React Studio / Operations Map / Company World
                  │ HTTP + SSE
                  ▼
        Express API and event gateway
                  │
      ┌───────────┼────────────┐
      ▼           ▼            ▼
 Workflow      Registry     Governance
 service       services      service
      │           │            │
      ▼           ▼            ▼
 Durable DAG   MCP/plugins   permissions,
 scheduler     skills/nodes  secrets,audit
      │
      ├── node executors (model, code, file, tool, media)
      ├── checkpoint/event store
      ├── trigger service
      └── evaluation and learning service
```

Incremental module target:

```text
server/
  index.js                 # composition and backward-compatible startup
  app.js
  utils/ validation and safe I/O
  workflows/ schema, migrations, store, versions, ports
  runtime/ engine, scheduler, checkpoint, cancellation, resources
  runtime/executors/
  triggers/
  mcp/
  custom-nodes/
  plugins/
  evaluations/
  governance/
  persistence/
```

Extraction is incremental. Every extraction preserves routes and runs the full regression checkpoint. JSON remains the portable definition format. SQLite is introduced only for transactional, indexed, growing event data: run events/steps, trigger delivery/history, evaluations, audit indexes, and scheduling leases. Existing JSON is backed up and imported; portable JSON export remains.

Engineering collaboration is an outer implementation-control layer, not part of workflow execution. It may produce reviewed commits but cannot change the canonical schema, production state, or authoritative plan without Codex integration. Agent specialization inside the product is separately resolved as `Primitive + Role Card + Agent Instance + Workflow Assignment`; visible job titles do not create duplicate runtime engines.

## 4. Canonical data contracts

The canonical workflow is versioned and unknown fields are preserved:

```json
{
  "schemaVersion": 2,
  "id": "website-studio",
  "version": "content-hash",
  "metadata": { "name": "Website Studio", "project": "Command Center", "tags": [] },
  "environment": "development",
  "nodes": [{
    "id": "research",
    "type": "agent",
    "definitionVersion": 1,
    "position": { "x": 0, "y": 0 },
    "ports": { "inputs": [], "outputs": [] },
    "config": {},
    "permissions": { "filesystem": [], "network": [], "tools": [] },
    "runtime": { "timeoutMs": 120000, "retries": 1, "retryBackoffMs": 1000 },
    "provenance": { "pluginId": null, "customNodeId": null }
  }],
  "edges": [{
    "id": "e1", "source": "in", "sourcePort": "output",
    "target": "research", "targetPort": "input",
    "kind": "data", "mapping": [], "validation": null
  }],
  "groups": [],
  "variables": {},
  "secretReferences": [],
  "triggers": [],
  "evaluations": [],
  "settings": { "parallelism": 4, "checkpoint": "after-node" },
  "governance": { "status": "draft", "locked": false, "approvedVersion": null }
}
```

Ports support `any`, `text`, `number`, `boolean`, `object`, `array`, `table`, `file`, `files`, `control`, `error`, `approval`, `artifact`, `memory`, `image`, `audio`, `video`, `code`, and `stream`, plus optional JSON Schema. Compatibility is static and revalidated at runtime. Only documented lossless coercions are automatic. Other conversions require a visible conversion node. Version migrations are pure, idempotent, fixture-tested functions. Legacy workflows receive inferred default ports without losing unknown fields.

Groups use additive canonical fields: `parentGroupId`, stable ordered `nodeIds`, numeric `order`, and boolean `collapsed`/`disabled` state. Legacy flat groups normalize without changing enabled execution. Group and node membership must agree, each node has at most one direct group, missing references and cyclic parentage are rejected, and a disabled ancestor suppresses all nested member steps. Canvas authoring loads parents first, preserves absolute position while reparenting, rejects self/descendant moves before mutation, recursively hides collapsed descendants, visibly inherits disabled state, and passes exact recursive membership to group-selected runs. Focused hierarchy tests cover these invariants; browser and host live regression evidence remain part of the next full checkpoint.

Nested execution carries an additive, redacted execution context. Effective resource limits are the minimum of inherited, child-workflow, and subworkflow-node ceilings; permission denials and local-only policy are irreversible below a parent, including retry and restart recovery; stack depth is bounded at eight and recursion is rejected before child side effects. Parent pause/stop cascades through active child run identities. Parent checkpoints and child run records retain only resource limits, denied capability names, local-only state, depth/stack, and parent run/node identity—never inputs, arguments, headers, or secret values. Retry/recovery reconstructs its inherited ceiling only from that redacted evidence.

Subworkflow node data may add an optional `workflowVersion` snapshot ID. New extraction always records the child snapshot that was actually saved. Pinned child runs resolve and integrity-check the exact stored workflow ID, version ID, and content hash before creating a child run workspace or performing child side effects; missing, mismatched, or tampered snapshots fail with explicit review/update guidance and never silently advance. Run/checkpoint/retry records retain the pin, retention pruning preserves referenced snapshots, and the Inspector shows the pinned child name/version. Advancing a pin is a confirmed, undoable draft edit that follows the normal save path. Legacy unpinned references remain compatible and visibly identified as running the current child draft.

Reusable child workflows add `metadata.component` with `reusable`, `archived`, description, and optional source identity while preserving unknown metadata. The catalog is an explicit redacted projection: ID, name, description, node count, current saved snapshot ID/hash, archive state, and availability only. It never returns workflow inputs, nodes, variables, secret references, run data, or execution payloads. Insertion requires an available integrity-checked current snapshot and creates an exact pin through normal undo/save draft behavior. Rename preserves identity and parent pins. Archive retains definitions/history and is rejected while parent references exist; parents are never deleted, retargeted, or advanced silently.

Portable reusable-component manifests are versioned deterministic documents containing one selected root and only its exact dependency closure. Each component carries its canonical definition, exact snapshot ID/hash, exact nested pins, compatibility, and constrained provenance; runs, audit data, credentials, resolved secrets, and unrelated workflows are excluded. Import validates identity, hashes, closure, recursion/depth, compatibility, secrets, and collisions before staging without workflow mutation. Explicit approval revalidates and installs only new development/import-review definitions. Existing IDs—including locked production—are never overwritten, retargeted, enabled, or advanced implicitly.

Canvas comments are an additive root `comments` collection, never workflow nodes. Each comment has a stable safe ID, text, absolute canvas position, optional semantic `{type: node|group, id}` anchor, resolution state, and preserved unknown extensions. Missing anchors remain visible review warnings and are never silently retargeted. Comment authoring uses normal undo/save/version behavior; resolved visibility is explicit. Comments have no ports or edges and are excluded from topology, selected/group runs, scheduler inputs, outputs, artifacts, checkpoints, and execution context. Absolute positions and semantic anchors remain unchanged when nested groups are reorganized.

MCP servers use stable safe IDs and validated local-stdio or remote-HTTP definitions. Existing safe definitions migrate additively; duplicates never overwrite. New local executables install disabled and untrusted until explicit review. Stdio receives only a documented minimal environment. Discovered tool schemas are bounded and recursively redacted, with server version and transport provenance. Server allow/deny scopes and workflow/node server/tool scopes compose deny-wins. Persisted call evidence is bounded metadata only—server, tool, status, normalized redacted error, and timestamps—without arguments, auth headers, secret values, or unrestricted output.

Trigger configuration is canonically owned by `workflow.triggers`; operational secrets, delivery identities, leases, and history are not duplicated into workflow definitions. Configuration mutations use a server-owned version-preserving path, reject missing or locked workflows, and cannot be erased by a stale ordinary workflow save. Each delivery is durably reserved by `(triggerId, redacted deliveryKey)` before workflow side effects and records exact workflow/version/run provenance. Run creation accepts trigger context only over an internal authenticated seam, persists the safe context, and returns the existing run for the same identity. Reserved/starting deliveries reconcile after restart through that same idempotent seam. The durable identity index has an explicit independent retention ceiling; public delivery history is separately bounded, paginated/filterable, and contains normalized redacted evidence without request bodies, workflow inputs, outputs, tokens, or unrestricted errors.

Webhook credentials are operational records with strict hash-only shape and a canonical monotonic revision. New credentials are disclosed once as a bearer token for a token-free endpoint with no-store caching. Credential verification and delivery reservation share one atomic store mutation, so rotation cannot admit a new old-token request after its successful cutover. Rotation requires an explicit intent header, bounded operation idempotency key, and expected revision; concurrent callers cannot both win the same generation and replay never rediscloses plaintext. Revocation deletes the hash and survives disable/re-enable/restart. Workflow locks and deny-wins `receive-webhooks` permission apply to authority-adding operations; revocation remains safety-reducing. The legacy URL-token route is compatibility-only and deprecated.

Interval and cron scheduling uses persisted intended-instant cursors rather than callback arrival time. Schedule state is operational and includes a canonical definition hash, last evaluation/scheduled instants, next fire, at most one queued overlap, and a bounded suppression reason. Cursor advancement and delivery reservation commit atomically. Canonical definitions validate strict five-field numeric cron syntax, explicit IANA timezone (UTC default), `skip|fire-once` misfires, `skip|queue-one|allow` overlap, and catch-up capped at 100. Nonexistent DST minutes do not fire; repeated minutes map to distinct UTC instants and delivery keys. When both day-of-month and day-of-week are restricted, either may match. Invalid legacy schedules remain visible but disabled for review; new invalid mutations are rejected before persistence.

Folder triggers use explicit service-approved roots and canonical real paths; broad home-directory access is not an implicit default. Missing, unreadable, non-directory, traversal, symlink, and scan-race cases fail before workflow side effects. Workflow-level `read-files` denial is irreversible from trigger configuration. Bounded content-free snapshots and settle/debounce candidates are operational state, stored atomically with stable event reservations so restart cannot lose a reserved event or depend on public history. Delivery evidence contains only event type and hashes; no absolute path or file content is recorded. Folder launches use a global bounded queue, queued reservations remain recoverable on shutdown, and disable/delete clears only the owning trigger's operational state.

Run checkpoints contain workflow/version identity, input, completed/skipped/failed node sets, node outputs with schemas and artifact references, routes, attempts, approvals, cache keys, active leases, and timestamps. Resume rejects incompatible workflow versions unless an explicit migration succeeds.

Resource concurrency is additive in schema v2. `settings.resources` may define integer limits from 1–32 for `maxModelCalls`, `maxSubprocesses`, `maxHttpRequests`, and `maxMcpCalls`; the same fields under `node.runtime.resources` provide a stricter node-local ceiling. Missing fields use safe runtime defaults (2 model calls, 4 subprocesses, 8 HTTP requests, 4 MCP calls) without rewriting existing definitions.

Plugin and skill packages contain manifest version, package version, compatibility, license, provenance, requested permissions, dependencies, tests, documentation, trust/signature status, and disabled-by-default executable payloads after import.

## 5. Execution model

The target engine is a dependency-aware scheduler, not a serial topological loop. Ready nodes enter a bounded queue. Independent branches execute concurrently; fan-in waits for its declared merge condition. Each node owns an AbortController/process group. Cancellation propagates through descendants and nested runs. State transitions are persisted before side effects and after results. Retry uses bounded exponential backoff and per-node idempotency policy. Cache reuse requires workflow version, executor version, normalized input, configuration, and permission-scope hashes.

The run-scoped resource coordinator atomically applies workflow and node-local limits to model, subprocess, HTTP, and MCP work. A process-global FIFO coordinator is an additive outer ceiling for all model calls across workflow, agent, chat, direct model, and embedding paths. It defaults to two concurrent calls; an optional environment-configured byte budget accepts only explicit memory-byte metadata. Missing estimates never become guessed footprints and fall back to concurrency-only admission. Acquisition order is always run-local then process-global to avoid nested deadlocks. Queued leases are cancellation-aware; pause stops new acquisition; active work releases in `finally` after success, failure, timeout, stop, client disconnect, or shutdown cleanup. Persisted wait/acquire/release evidence contains resource kind, node identity, timestamps, and aggregate counts only—never arguments, payloads, headers, model identifiers, or secrets.

Supported actions: full run, safe run, selected node, from node, selected branch, retry node, retry branch, skip, pause at boundaries, breakpoint, approval, stop, and restart recovery. Nested workflows inherit bounded resource and permission ceilings and reject recursive references.

## 6. Security and governance

- Development permits reviewed generation and detailed diagnostics.
- Testing uses fixed datasets, temporary effects, regression suites, and no silent publication.
- Production requires an approved immutable version, stable dependencies, enforced permission scopes, promotion evaluations, and audited unlock.
- Secrets are opaque references resolved through OS-backed storage at execution time and redacted from events/exports.
- Filesystem, network, subprocess, package, tool, memory, and destructive permissions are enforced in executors, not merely displayed.
- Imported executable packages remain disabled until manifest, dependency, provenance, and permission review.
- AI, skill, prompt, code, and graph improvements always create proposals and versions; production never changes silently.

## 7. Phased implementation program

Every phase records UI, persistence, runtime, permissions, errors, tests, rollback, and evidence. A phase is VERIFIED only after its definition of done passes.

### Phase 0 — Recovery and stabilization

- Objective: understand and repair the interrupted tree without losing user work.
- Files: current modified sources, recovery tests, status/architecture/handoff documents.
- Work: checksum backup; diff audit; syntax/type/build; server restart; original smoke; focused ports/custom/plugin/evaluation/learning/lock/MCP/resume/subworkflow/cancellation tests; disable unverified claims.
- Security: secret scan and path boundaries remain mandatory.
- Rollback: restore the checksum-backed repository archive or binary patch.
- Done: original and focused suites pass, localhost is live, documentation is honest, safe checkpoint recorded.

### Phase 1 — Autonomous supervisor

- Objective: bounded repository-managed Codex iterations with durable state.
- Files: `scripts/autonomy/*`, `state/*`, `logs/autonomy`, `docs/AUTONOMOUS_EXECUTION.md`.
- Behavior: single-instance lock, doctor/auth/disk checks, workspace-write `codex exec`, JSONL logs, stop file, bounded retries/backoff, capacity classification, semantic blocker fingerprints, three-state no-progress halt, explicit `WAITING_HOST_OPERATION`, typed deterministic host-operation receipts, and LaunchAgent installer.
- Security: no sandbox bypass, no credential automation, no automatic purchases, no destructive retry.
- Tests: shell syntax, doctor, dry run, lock contention, stop/resume, simulated capacity/failure classification.
- Rollback: unload LaunchAgent and remove only generated runtime lock/stop files.
- Done: status/doctor work and one bounded dry-run iteration exits with persisted next task.

#### Phase 1C — controlled Codex + Claude collaboration amendment

- Dependency: a reviewed clean collaboration base; the current dirty checkout must not be treated as represented by `HEAD`.
- Order: CLI/auth audit; task/state/file-ownership foundation; fixture-tested read-only bridge; one low-risk isolated-worktree pilot; shared skills/subagents; conservative parallelism; UI/API; supervisor integration.
- Limits: initially one modifying Claude worker, no overlapping ownership, no simultaneous schema/package-lock/`server/index.js`/`WorkflowStudio.tsx` edits, no automatic integration, and no live paid call in the standard suite.
- Pilot evidence: the first Fable test-only worktree pilot is integrated after actual-model provenance, scope inspection, focused checks, production build, and Codex review. Broader modifying tasks remain gated on durable lease/restart recovery.

#### Phase 1D — controlled local model factory amendment

- Objective: use one pinned Qwen3-Coder-30B LM Studio allocation for bounded concurrent repository audits, implementation proposals, test design, review, failure analysis, and documentation drafting.
- Authority: local workers are subordinate read-only advisors. They receive no tools, shell, network, filesystem API, production secrets, or direct Git authority. Codex and deterministic tests remain integration gates.
- Implemented foundation: exact-file context allowlists, protected path and symlink rejection, byte/token/timeout/response limits, strict model pinning, structured redacted results, mechanically verified file/range/quote citations, exact deduplication, four-slot priority pool, cancellation, durable task state, restart recovery, API routes, audit events, and a repeatable A/B benchmark.
- Promotion dependency: modifying output remains disabled until the dirty repository has a reviewed base and the patch-proposal/worktree/ownership/test/review pipeline is fixture-verified.
- Detailed contract and evidence: `docs/LOCAL_MODEL_FACTORY.md`.
- Evidence and complete definition: `docs/DUAL_AGENT_ARCHITECTURE.md`, `docs/CLAUDE_CODE_INTEGRATION.md`, and `docs/MULTI_AGENT_FILE_OWNERSHIP.md`.

### Phase 2 — Canonical schema and typed ports

- Objective: schema v2, migrations, complete port types, JSON Schema, mapping/preview APIs and UI.
- Modules: workflow schema/migrations/ports/store; typed API models; multi-port canvas.
- Tests: legacy migration, unknown-field preservation, compatibility/coercion, runtime schema failure, previews, suggested converters.
- Rollback: retain v1 reader and export original documents beside migrated copies.
- Done: old workflows open/run, invalid connections fail clearly, typed values validate end-to-end.

### Phase 3 — Durable execution

- Objective: bounded parallel DAG scheduler and recoverable run control.
- Modules: scheduler, checkpoint, cancellation, resource manager, executor interface.
- APIs: selected/from/branch run, retry node/branch, checkpoints and recovery.
- Tests: fan-out/fan-in, races, retries/backoff, abort active subprocess, restart, idempotency, cache, resource caps.
- Rollback: feature flag retains legacy runner during equivalence testing.
- Done: deterministic fixtures prove graph parallelism and restart-safe continuation.

### Phase 4 — Subworkflows and organization

- Objective: groups, sections, comments, reusable subworkflows and navigation.
- UI: multi-select grouping, collapse, disable/run group, breadcrumbs, extract/save component.
- Runtime: nested inputs/outputs, resource/permission inheritance, recursion/depth rejection.
- Tests: extraction fidelity, nested errors, version pinning, recursion and cancellation.
- Done: a selected branch can become, version, run, and reopen as a reusable subworkflow.

### Phase 5 — MCP, tools, and triggers

- Objective: real MCP discovery/calls and restart-safe schedules/webhooks/folder watches.
- Modules: MCP transports/registry/fixtures; trigger service/store/dedup/history.
- Security: auth references, webhook tokens, safe watch roots, permission gates, cancellation/timeouts.
- Tests: stdio and Streamable HTTP fixtures, tools/list/call/error/cancel; cron/interval, duplicate webhooks, debounce, restart recovery.
- Done: configured triggers survive restart and launch exactly-once-within-defined-dedup semantics.

### Phase 6 — Custom nodes and plugins

- Objective: schema-driven no-code wizard, versioned executor manifests, trust-aware lifecycle.
- UI: My Nodes, marketplace, review/install/upgrade/disable/uninstall, generated documentation/tests.
- Runtime: agent/code/SQL/HTTP/MCP/transform/subworkflow adapters with permission ceilings.
- Tests: manifest validation, import quarantine, dependency review, upgrades, disabled/untrusted execution rejection.
- Done: a no-code node is created, tested, installed, run, exported, imported disabled, reviewed, and re-enabled.

### Phase 7 — Evaluations and controlled learning

- Objective: datasets, deterministic/model/visual evaluators, baselines, comparisons and approved proposals.
- Persistence: suites, cases, results, evidence, proposal diffs and decisions.
- Promotion: required suites and thresholds bind to workflow/agent/skill/plugin versions.
- Tests: scoring, baseline comparison, failure clustering, proposal rejection/approval, no production mutation.
- Done: evidence creates a proposal, regression tests it, and human approval promotes a rollback-capable version.

### Phase 8 — Governance and production lifecycle

- Objective: enforced environments, secrets, scopes, locks, promotion gates and audit.
- Modules: permissions, secret resolver, promotion, immutable versions, audit.
- Tests: filesystem/network/package/tool denial, secret redaction, destructive approval, lock/unlock, emergency stop.
- Done: UI summaries match executor enforcement and production changes cannot bypass gates.
- Current mandatory gap-remediation sequence and acceptance contract: `docs/GOVERNANCE_HARDENING_PLAN.md`.

#### Phase 8A — agent primitives and Role Cards amendment

- Additive model: 14 initial reasoning primitives, versioned Role Cards, isolated Agent Instances, and explicit Workflow Assignments.
- Compatibility: preserve legacy IDs, names, prompts, avatars, tools, skills, permissions, models, and workflow references; preview mappings and flag ambiguity before mutation; retain rollback evidence.
- Separation: loops, retries, comparison, gates, scheduling, formatting, resource enforcement, deployment, health checks, and rollback remain workflow/runtime services.
- UI: Easy Mode preserves job-title language; Pro/Developer exposes primitive, Role Card version, skills, rubric, scopes, permissions, and overrides. Company World retains unique employees without runtime duplication.
- Evidence and complete definition: `docs/AGENT_ROLE_MAPPING.md` and `docs/adr/ADR-AGENT-PRIMITIVES-AND-ROLE-CARDS.md`.

### Phase 8E — Continuous intelligence and controlled evolution

- Dependency gate: begin only after durable runtime, evaluations, permission enforcement, secrets, and development/testing/production promotion are verified. This is not uncontrolled self-modification and is not allowed to bypass Phase 8.
- Objective: add the External Intelligence and Technology Scout plus the Internal Quality, Learning and Optimization Director over one audited, versioned proposal/experiment/adoption lifecycle.
- First slices: transactional evolution data model and state machine; Watchlists UI; approved GitHub adapter with deterministic fixtures; internal run-analysis adapter and transparent satisfaction signals; complete proposal schema; isolated temporary-worktree experiment lifecycle.
- Safety: external content remains untrusted evidence; static inspection precedes execution; experiments have no production secrets and use restricted files/network/resources; security, license, regression, exact-version approval, environment promotion, and rollback gates are binding.
- APIs/UI: Evolution Center, sources/watchlists, discoveries, proposals, experiments, comparisons, reviews, approvals, promotions, deployments, health, rollbacks, policies, timeline, and reports.
- Tests: ingestion/dedup, approved/restricted sources, prompt-injection separation, repository/license/security analysis, clustering, satisfaction weights, sandbox escape/leak prevention, restart recovery, baseline comparison, stale approval rejection, promotion blocking, and rollback.
- Full contract and definition of done: `docs/CONTINUOUS_EVOLUTION.md`.

### Phase 9 — Complete Studio productivity

- Objective: close all interaction gaps without fake controls.
- UI: command palette, full shortcuts, copy/paste, smart insertion/add, recommendations, search/jump, expanded nodes, run actions, rich recovery cards, technical schemas/JSON/consoles.
- Tests: component behavior, browser E2E, accessibility, reduced motion, visual regression.
- Done: every visible context/command action works or is explicitly unavailable with reason.

### Phase 10 — Operations Map

- Objective: accessible static 2D employee map driven only by canonical organization and real events.
- Data: departments, agents, assignments, queues, runs, approvals, artifacts, resources.
- Tests: event-to-visual consistency, stale-state handling, selection/actions, accessibility, and low-power performance.
- Done: no visual work state exists without a matching backend state/event.

### Phase 11 — Interactive Company World — DEFERRED BY USER SCOPE DECISION

- This phase is removed from the current delivery scope. The 2D Employee Operations Map is the only required organizational visualization.
- Performance: capability detection, quality presets, LOD, pooling, hidden-tab pause.
- Tests: state parity with Operations Map, memory/frame budgets, interactions and accessibility fallback.
- Done: world and canvas open the same entities and actions with no execution coupling.

### Phase 12 — Cinematic 3D city — DEFERRED BY USER SCOPE DECISION

- This phase and Company World animation are removed from the current delivery scope and final acceptance gate.
- Work: streamed assets, departments/buildings, lighting/materials/camera, scalable post-processing.
- Tests: low/balanced/high/cinematic budgets, fallback, long-session memory, state consistency.
- Done: disabling the renderer has zero effect on workflow execution.

### Phase 13 — Open-source packaging

- Objective: contributor/security/authoring/release documentation and portable reviewed packages.
- Tests: clean-machine development, package round trips, compatibility/license/provenance validation, imported-code quarantine.
- Done: documented reproducible setup and secure package lifecycle pass from a clean checkout.

### Phase 14 — Enterprise hardening

- Objective: backup/restore, diagnostics, long-duration reliability, security, performance and accessibility evidence.
- Tests: fault injection, disk-full, restart, corrupt store, heavy concurrency, secret scans, command injection, backup restore, browser E2E, accessibility and performance thresholds.
- Done: all applicable acceptance checks pass, no critical/high unresolved security issue, docs and observed behavior agree.

## 8. Testing strategy

- Unit: pure schema/migration/port/mapping/permission/scheduler functions.
- Integration: API plus isolated JSON/SQLite temp stores and fixture executors.
- Runtime: deterministic Python, shell, HTTP, MCP, trigger and subprocess fixtures; local LLM tests remain a separate slower tier.
- E2E: browser flows for all modes, creation, run, failure, recovery, promotion, import and world navigation.
- Reliability: restart at each material transition, duplicate delivery, cancellation races, process cleanup, recursive subworkflows, corrupt state and disk pressure.
- Security: traversal, injection, SSRF policy, secret leak, untrusted plugin, production bypass, permission-scope tests.
- Visual/accessibility: screenshots at defined viewports, keyboard navigation, contrast, screen-reader labels, reduced motion.
- Evidence: commands and results go into iteration summaries; no status becomes VERIFIED from code inspection alone.

## 9. Risk register

| Risk | Control |
|---|---|
| User data loss | checksummed backups, additive migrations, copied-data tests, rollback docs |
| Parallel races/deadlocks | deterministic scheduler state machine, bounded queues, lease tests |
| Duplicate triggers | durable delivery keys, debounce windows, trigger history |
| Orphan subprocesses | process groups, AbortController, cleanup/reaper tests |
| Recursive workflows | stack/depth validation before child launch |
| Unsafe plugin code | disabled import, manifest review, trust and permission ceilings |
| MCP/tool abuse | schema validation, auth refs, scopes, timeout/cancel, audited calls |
| Secret leakage | opaque references, centralized redaction, export/log tests |
| Production mutation | immutable approved versions, enforced locks, audited unlock |
| Backward regression | schema migrations, legacy reader, fixture corpus, full checkpoints |
| Autonomous loop damage | workspace sandbox, bounded task, single lock, stop file, escalation |
| Multi-agent conflicting edits | exclusive file reservations, isolated worktrees, clean base, diff-scope gate, Codex-only integration |
| Agent-role configuration leakage | immutable versioned references, deep-copy resolution, explicit per-instance overrides, isolation regression tests |
| 3D resource interference | separate renderer, budgets, hidden pause, 2D fallback |

## 10. Autonomous worker operating contract

Each iteration reads the required docs/state, inspects status/diff, chooses one unblocked `state/next-task.md` objective, makes a bounded coherent change, adds tests, runs focused and risk-proportionate regression checks, updates docs/state, commits only when safe, and exits. The supervisor never uses the sandbox-bypass flag. Capacity errors cause bounded exponential backoff. Three genuinely different failed repair attempts or a safety/product/credential decision causes `WAITING_FOR_USER_DECISION` with exact evidence.

Progress reports must record identity, before/after commits, changed files, runtime/schema/API/UI changes, exact verification, risks, repository state, active services, and one executable next task.

## 11. Final acceptance

The canonical checklist is the user contract in this thread and will be mirrored into `docs/IMPLEMENTATION_STATUS.md`. Completion requires all mandatory items VERIFIED or explicitly justified DEFERRED, every visible control truthful, localhost usable, migrations/backups tested, full suites passing, documentation synchronized, and no critical/high known security issue. Visual polish or a passing happy path alone is never completion.
