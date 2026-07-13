# AI Command Center — Repository and Skills Research Brief

Last updated: 2026-07-13

## Research mission

Find mature, actively maintained, permissively licensed open-source repositories, design patterns, test fixtures, and reusable agent skills that can accelerate AI Command Center without replacing its canonical architecture or weakening its local-first security model.

Prefer extracting a proven design pattern and implementing it natively. Do not recommend importing a large agent framework merely because it is popular. Every recommendation must show measurable benefit, integration cost, license/provenance, maintenance risk, security implications, and a rollback path.

## Product scope

AI Command Center is a local-first visual operating system for building, running, supervising, and improving organizations of AI agents. It combines a React Flow workflow canvas, durable local execution, human approvals, AgentBrain knowledge/skills, local and optional cloud models, code/tool/MCP execution, artifacts, governance, evaluations, controlled evolution, and a real-state 2D employee operations map.

The same canonical workflow is edited through Easy, Guided, Pro, and Developer modes. Modes must never create incompatible workflow copies.

Primary stack:

- React 18, TypeScript, Vite, `@xyflow/react`.
- Node.js and Express.
- JSON-file persistence today, with additive schema migrations and atomic operational stores.
- macOS local execution through a LaunchAgent.
- LM Studio/local MLX models, OpenCode, ComfyUI, and Obsidian-compatible AgentBrain.
- Local application address: `http://localhost:1717`.

## Verified foundation already in place

- Recovery baseline and a repository-managed 24/7 supervisor with bounded workers, blocker fingerprints, no-progress circuit breakers, typed host operations, receipts, stop/resume/status, and capacity states.
- Canonical workflow schema v2 with additive migration, typed ports, connection compatibility, mappings, validation, and previews.
- Durable DAG execution with bounded parallelism, retries, selected/from/branch execution, pause/resume/stop, checkpoints, cancellation, resource ceilings, and restart recovery.
- Nested subworkflows, recursion protection, exact version pins, reusable components, nested groups, breadcrumbs, and non-executable canvas comments.
- MCP stdio and Streamable HTTP discovery/execution with scoped tools, review-gated local executables, minimal environments, timeout/cancellation, and redacted evidence.
- Persistent interval/cron, secure webhook, and watched-folder triggers with deduplication, restart recovery, overlap/misfire policies, credential rotation/revocation, and real host verification.
- Keychain-backed opaque credential references with metadata-only workflow/MCP persistence, no-store CRUD, revision-safe rotation, usage-protected deletion, HTTP/MCP bearer resolution only at transport, inline-credential denial, and truthful UI controls.
- Custom-node, plugin trust, evaluation, learning-proposal, production-lock, audit, artifact, knowledge, AgentBrain skill, Python workspace, and local-only/permission foundations. These later-phase areas remain only partially complete.
- Level 1 real-state 2D Company World/Operations Map foundation. Cinematic 3D and a 3D city are explicitly deferred.
- Codex-lead/Claude-worker collaboration foundations with isolated worktrees, file ownership, structured results, fixture tests, and one bounded real modifying pilot.
- Local Qwen advisory factory with source-cited findings and known-answer evaluation. The active Qwen baseline remains in service while a larger candidate downloads and awaits A/B proof.

Current focused regression evidence includes schema 9/9, MCP registry/client 12/12 plus live transports 4/4, Keychain registry/API/runtime/live 4/4 + 5/5 + 5/5 + 5/5, security 4/4, restart recovery, production TypeScript/build, smoke 30/30, and localhost HTTP 200.

## Work coming next

Near-term critical path:

1. Finish the Qwen candidate download and compare it against the active baseline at concurrency 1/2/4. Promote only on strict schema, security, precision, and throughput gates.
2. Complete the Workflow Settings multi-trigger manager so users can inspect, enable/disable, delete, and review history for every persisted trigger without editing JSON.
3. Continue canonical Agent Primitive + versioned Role Card runtime adaptation and nondestructive legacy-agent migration preview.
4. Complete durable runtime edge cases, permission matrix, promotion lifecycle, backup/restore, diagnostic, security, accessibility, performance, and browser regression gates.
5. Complete the Collaboration APIs/dashboard only after the underlying worker/process/worktree controls remain reliable.
6. Build the Continuous Intelligence and Controlled Evolution foundation after runtime, evaluation, permissions, and environment promotion are stable: data model, watchlists, GitHub adapter, internal run analysis, proposal format, and isolated experiments.
7. Improve the real-state 2D employee operations map. Keep 3D offices, avatars, city, and cinematic animation deferred.

## Highest-value repository and skill research areas

### 1. Durable local workflow runtime

Research small, embeddable patterns for event-sourced or checkpointed DAG execution, crash recovery, idempotency, leases, bounded retries, cancellation propagation, and deterministic scheduling. Avoid frameworks that require a cloud control plane or replace our canonical workflow model.

Useful output: algorithms, test suites, failure matrices, and storage patterns that can be adapted to Node.js.

### 2. Safe local persistence and migration

Research atomic JSON stores, write-ahead logs, SQLite migration paths, checksummed backups, corruption recovery, optimistic revisions, and restart-safe queues. Compare SQLite/LibSQL approaches without assuming an immediate destructive migration.

Useful output: a backward-compatible migration/rollback design and deterministic fault-injection tests.

### 3. Workflow schema and typed data contracts

Research JSON Schema 2020-12 validators, typed-port compatibility, schema evolution, previewable field mapping, safe coercion, and import/export compatibility. Prefer libraries with strong TypeScript types, small dependency trees, and active security maintenance.

### 4. MCP implementation and fixture testing

Research official or reference MCP TypeScript SDK patterns for stdio and Streamable HTTP, session/reconnect behavior, cancellation, schema validation, OAuth/auth-reference boundaries, tool permission scoping, and deterministic local fixtures. Do not recommend arbitrary MCP servers for automatic installation.

### 5. Trigger reliability

Research restart-safe cron scheduling, file watching on macOS, write stabilization, rename/replace semantics, delivery deduplication, webhook replay resistance, and deterministic time/DST test techniques.

### 6. React Flow and high-density workflow UX

Research proven open-source node editors for smart insertion, command palettes, keyboard shortcuts, minimaps, nested groups, large-canvas performance, accessible drag/drop, inspector decomposition, error recovery cards, and visual diffing. Extract interaction patterns; do not replace `@xyflow/react` without strong evidence.

This is a particularly strong assignment for Claude/Fable because it benefits from visual and component-architecture judgment.

### 7. Browser, accessibility, and visual verification

Research Playwright patterns, deterministic screenshot fixtures, Axe accessibility integration, reduced-motion testing, keyboard-only workflow editing, responsive regression, and local test orchestration with isolated ports/data.

Useful output: tests that run without paid APIs and fail on real UI regressions.

### 8. Local model serving and model evaluation

Research LM Studio, MLX, llama.cpp, and compatible local gateways for model aliases, JIT load/unload, continuous batching, KV-cache monitoring, structured-output enforcement, and concurrency admission. Research repo-specific known-answer evaluation, patch acceptance metrics, and cross-model finding deduplication.

Do not recommend more models unless they fill a measured gap. Current desired local lanes are:

- Qwen: fast read-only audits, edge cases, test ideas, and source-cited review.
- Optional code specialist: small isolated patches only after repository-specific evaluation.
- Optional vision model: screenshot/accessibility review only after a deterministic visual lane exists.
- Embedding/reranker: code/task retrieval, finding deduplication, and blocker similarity if it measurably improves task packets.

### 9. Multi-agent coding control plane

Research safe worktree managers, glob ownership/conflict detection, lease heartbeats/fencing tokens, structured CLI event parsing, fixture worker processes, selective integration, secret/dependency scans, and crash recovery. Avoid platforms that pool vendor credentials, bypass permissions, or let workers merge directly.

Codex remains lead/integrator. Claude/Fable is a bounded senior worker/reviewer. Local models are advisory until promoted through tests.

### 10. Secret and process isolation

Research macOS Keychain patterns, reference-only secret schemas, environment minimization, SSRF/network allowlists, child-process sandboxing, command injection prevention, package install isolation, resource limits, and redaction-safe logging.

### 11. Secure plugin/custom-node packaging

Research manifest formats, capability declarations, provenance, SPDX/SBOM, license scanning, signature/trust states, quarantined import review, isolated tests, and safe dependency installation. Imported executable code must never run automatically.

### 12. Real-state 2D operations map

Research lightweight 2D/isometric rendering and event-stream visualization for real agents, departments, assignments, run states, progress, errors, and interactions. No invented activity animations. Avoid 3D engines for the current scope.

## Skills that would help each worker most

### Codex lead

- Repository audit and status/evidence reconciliation.
- Safe migrations and rollback design.
- Durable runtime/concurrency and failure recovery.
- Security review, threat modeling, and secret-leak testing.
- MCP integration and transport fixtures.
- Git worktree integration and selective commit review.
- Release gates, backup/restore, and localhost verification.

### Claude/Fable worker

- React Flow component architecture and interaction design.
- Frontend accessibility and keyboard navigation.
- Visual regression and screenshot-based review.
- Large React/TypeScript component decomposition.
- UX error/recovery cards, command palettes, and high-density inspector design.
- Independent architecture, performance, and cross-model code review.

### Local Qwen workers

- Strict source-cited code audit output.
- Test-case/edge-case generation.
- Documentation-versus-code drift checks.
- Diff smell/security triage.
- Structured JSON output repair and finding deduplication.
- Low-risk patch drafting only where deterministic tests define correctness.

## Repository acceptance filter

For every candidate, report:

- Repository URL, exact license, age, recent activity, maintainers, releases, CI, tests, security advisories, and maintenance burden.
- Exact capability or design pattern worth adopting.
- Why our current implementation is insufficient.
- Native reimplementation versus safe/legal code reuse recommendation.
- Dependencies/install scripts, network/filesystem behavior, secret handling, permissions, and known vulnerabilities.
- Files/modules likely affected and whether the work can be isolated.
- Expected quality/throughput gain, implementation effort, test/benchmark plan, migration risk, and rollback plan.
- Confidence and primary evidence links.

Reject or quarantine candidates with unclear licenses, suspicious install/postinstall scripts, abandoned security-sensitive code, broad host permissions, credential harvesting, automatic external code execution, or a requirement to replace the entire product architecture.

## Questions for external reviewers

1. Which three repositories provide the highest measurable benefit to the near-term critical path without introducing a new framework or cloud dependency?
2. What deterministic tests should prove each recommendation is better than the current baseline?
3. Which recommendation is best for Codex lead work, which is best delegated to Claude/Fable, and which is safe for local Qwen analysis or patch drafting?
4. Are there mature libraries for crash-safe Node.js workflow execution and macOS file watching that handle replacement/rename/restart semantics better than our native implementation?
5. What is the safest incremental path from JSON persistence to SQLite without breaking local user data or rollback?
6. Which Playwright/Axe/visual-regression patterns work reliably on a local macOS LaunchAgent application?
7. Which repositories have licensing or supply-chain risks that make them unsuitable even if technically impressive?

## Decisions the owner can clarify

- For the first shippable v1, should the top priority be general automation or software-development workflows?
- Is an additive SQLite migration acceptable soon, or should JSON remain the only persistence layer through v1?
- Are permissive licenses only (MIT/Apache-2.0/BSD) required, or is carefully isolated copyleft code acceptable?
- May recommended repositories add small audited dependencies, or should the default remain native implementation with no new packages?

Long-form document-generation specialization is deferred by owner direction. Normal workflow text/file outputs remain supported, but document-production research and implementation are not on the current critical path. Required engineering documentation remains synchronized with verified behavior.
