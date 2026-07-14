# Current architecture

## Authority and deployment

AI Command Center is a single-owner, local-first application. Express binds to `127.0.0.1`; the React application is served from the same local origin. A versioned macOS LaunchAgent manages the installed service. Runtime data uses an explicit authoritative data root and is excluded from source packages and public snapshots.

Local-first is not offline-only. Workflows can use local or cloud models, HTTP APIs, remote MCP, and webhooks when an explicit capability and reviewed secret reference permit the exact destination and environment. Control, policy, versions, checkpoints, approvals, and evidence remain local.

## Composition

- `server/index.js` remains the composition root and route host.
- `server/workflows/` owns canonical schema migration, typed ports, versions, components, and reviewed component manifests.
- `server/runtime/` owns dependency scheduling, resources, checkpoints, run controls, effects, safe output, subworkflow context, and global model coordination.
- `server/triggers/` owns canonical trigger definitions, operational state, schedules, folder watching, delivery identities, and restart idempotency.
- `server/security/` and `server/secrets/` own loopback request boundaries, deny-wins policies, safe filesystem access, redaction, and Keychain-backed opaque references.
- `server/governance/`, `server/plugins/`, `server/evaluations/`, and `server/learning/` own immutable promotion evidence, reviewed packages, exact evaluation records, and controlled proposals.
- `web/src/WorkflowStudio.tsx` hosts the shared four-mode canvas; `web/src/App.tsx` composes the wider dashboard, Company World, Extensions, Evaluation Lab, and operations surfaces.

## Persistence and recovery

Atomic JSON is authoritative. Writes use same-directory exclusive temporary files, content fsync, atomic rename, and directory sync. Failures before rename preserve the old file; failures after rename are tagged commit-uncertain so callers do not mistake an ambiguous durability result for proven absence. Corrupt stores fail closed and migrations remain additive.

Workflow runs pin an immutable version and use a versioned per-node snapshot. Logical execution keys remain stable across physical attempts. Side effects transition through prepared, inflight, confirmed, or ambiguous states. Restart recovery retries only safe computation/proven absence, reconciles receipts when possible, and otherwise enters `needs_review`. Approval and manual pause are orthogonal durable command state with revision/subject checks and replay receipts.

## Security boundary

- Exact loopback Host/Origin/request classification protects mutation routes; the listener is not a network service.
- Keychain values resolve only at authorized adapter boundaries and are not stored in workflow JSON.
- Central redaction covers durable runs, audit, exports, artifacts, errors, and browser evidence.
- Testing and Production capabilities compose by intersection with deny-wins ceilings.
- Safe filesystem adapters reject traversal and symlink leaves and use atomic replacement. Node/macOS cannot prove a complete `openat2`-style boundary against a malicious same-user ancestor swap; this residual limitation is documented rather than hidden.
- Shell, Python, custom nodes, HTTP, MCP, and plugins are executable/effectful capabilities. Imported executables default disabled. Unsupported `sandbox-exec` is not claimed as a Production security boundary.

## Verification

`npm run verify:release` is the authoritative 26-gate contract. It covers checkpoint/control/subworkflow/trigger recovery, secret canaries, disk-full and concurrency soak, measured performance ceilings, backup/restore, sanitized package and clean installation, SBOM and dependency audit, upgrade/rollback and LaunchAgent lifecycle, governance/plugins/evaluations/learning, TypeScript/build, and ten live Playwright/Axe/visual journeys.

See `docs/MASTER_PLAN.md` for the original contract, `docs/IMPLEMENTATION_STATUS.md` for phase evidence, `docs/COMPLETION_AUDIT.md` for remaining blockers, and `docs/SECURITY_MODEL.md` for the threat model.
