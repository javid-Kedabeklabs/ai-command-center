# AI Command Center features

AI Command Center is a local-first workflow and AI operations platform. Local-first means definitions, policy, checkpoints, approvals, evidence, secrets metadata, and lifecycle authority remain on the owner’s Mac. It is not local-only: reviewed workflows may call external HTTP APIs, remote MCP servers, cloud models, and webhooks through explicit environment- and destination-scoped capabilities.

## Workflow platform

- One canonical additive workflow schema with typed ports, mappings, variables, comments, nested groups, and immutable content-hashed versions.
- One React Flow canvas shared by Easy, Guided, Pro, and Developer modes.
- Deterministic DAG execution with bounded parallel branches, loops/fan-out, subworkflows, model nodes, HTTP/MCP, files, shell/Python, approvals, triggers, and reviewed custom nodes.
- Versioned per-node checkpoints with stable logical execution and operation keys.
- Exactly-once-or-stop recovery: retry only when absence is proven, deduplication is supported, or an authoritative receipt reconciles the effect; otherwise persist `needs_review`.
- Durable replay-safe approve/reject, manual pause/resume, retry, cancellation, and restart recovery.

## Connectivity and automation

- Local and optional cloud model providers.
- MCP stdio and Streamable HTTP registry, discovery, reviewed auth references, and tool execution.
- Persistent interval, cron, secure webhook, and watched-folder triggers with exact workflow-version pins, deduplication, overlap/misfire policy, and restart recovery.
- Optional external access is a capability, not ambient authority. The product HTTP listener remains loopback-only.

## Extensibility and governance

- No-code custom-node authoring with typed manifests and version history.
- Portable plugin packages with compatibility, provenance, license, dependency, deterministic fixture, optional Ed25519 integrity, exact-manifest review receipts, and disabled-by-default imports.
- Development/Testing/Production lifecycle with immutable candidates, review gates, exact evaluation evidence, deployment and rollback receipts, and Production locks.
- Evaluation Lab with deterministic checks, exact-run baselines, versioned datasets, SHA-bound visual/accessibility/security/model reports, and governed learning proposals. Learning never mutates source workflows or authority automatically.

## Product experience

- Command palette, keyboard editing, copy/paste with internal edges, undo/redo, smart insertion, search, context actions, technical inspectors, recovery cards, run timeline/logs/variables/errors/artifacts/resources/console, reduced-motion handling, and responsive desktop layout.
- Company World 2D Operations Map backed only by persisted runs, checkpoints, approvals, resources, assignments, queues, and durable department definitions. It does not invent progress.
- Dashboard, Run Center, Agents, models/chat, AgentBrain knowledge vault, image/video Studio, Extensions, Evaluation Lab, governance, settings, and backup/release operations.

## Security and packaging

- Loopback Host/Origin/request-intent guard and no permissive production CORS.
- macOS Keychain values behind opaque metadata-only references; centralized redaction and canary scanning across runs, artifacts, API evidence, audit, and exports.
- Deny-wins Testing/Production capability ceilings and practical symlink-safe file boundaries.
- Atomic fsync/rename JSON stores, corruption failure, disk-full semantics, backup/restore, clean package install, versioned upgrade/rollback, LaunchAgent lifecycle, CycloneDX SBOM, dependency-license inventory, and zero-high/critical vulnerability gate.
- Imported executable code remains disabled until exact review. Ambiguous external effects never blind-retry.

Run `npm run verify:release` for the authoritative 26-gate evidence. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md), [docs/COMPLETION_AUDIT.md](docs/COMPLETION_AUDIT.md), and [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for exact scope and residual limitations.

The package remains `UNLICENSED` until the owner selects a project license. A public review snapshot is therefore source-available for review, not yet an open-source release.
