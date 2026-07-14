# AI Command Center Portfolio Priority Plan

Status: AUTHORITATIVE DELIVERY ORDER

Updated: 2026-07-13

This document answers four questions for every major body of work:

1. What should be built now?
2. What can be prepared safely in parallel?
3. What is intentionally waiting on a dependency?
4. Which “factory improvement” actually sharpens the blade enough to justify delaying product work?

It supplements `docs/MASTER_PLAN.md`; it does not replace product scope or acceptance criteria.

## Optimization rule

The factory optimizes for **verified requirement weight completed per lead-attention hour**, not worker count, model calls, or lines changed.

A blade-sharpening enhancement may interrupt the product critical path only when all are true:

- It removes a demonstrated blocker or unlocks at least two already-prioritized tasks.
- It has a deterministic acceptance test.
- It is reversible.
- Expected remaining-calendar reduction is at least 15%, or it closes a release-critical correctness/security gap.
- Its initial experiment is bounded to one day unless the owner explicitly expands it.

At most 20% of active delivery time may be spent on factory improvements while a product-critical task is executable. When the experiment misses its gate, preserve the evidence, reject the enhancement, and return immediately to product work.

## Current authoritative checkpoint

- Local collaboration implementation checkpoint: `70978b8`; durable worktree leases, sanitized task/status APIs, truthful UI, and packaged-install fallback are verified.
- Sanitized public review snapshot: `377e377f64deaff07b9e8aeafcfab32246ac5d9e` on `review/current-20260713`; it excludes every `data/` path, Gitleaks found zero leaks, and unauthenticated `git ls-remote` confirmed the public branch.
- Host reload request `host-a573eebef60132e7`, receipt SHA-256 `69b60a38c967acfc7a8d719126b8f70414d09e411593f3131a23bc6e8ae435f6`: health 200 after two attempts; system, Agent Architecture, migration preview, and Company World APIs returned 200; hostile Host returned 403; live architecture remained revision 0 with no automatic migration.
- Runtime, governance, plugins, evaluations/learning, current-scope UX, Company World, package lifecycle, Agent Architecture, collaboration persistence/API, and enterprise deterministic hardening are verified by the 30-gate release contract with twelve browser journeys.
- Only legal open-source designation is blocked: the package remains `UNLICENSED` until the owner selects a license.

The P0–P2 tables below are retained as the dependency rationale that produced the implementation. They are no longer an open-work queue. Current remaining v1 work is the owner’s license choice. P3/P4 remain separately measured or deferred enhancements.

## Critical-path map

```text
PERMISSION + FILESYSTEM BOUNDARY (verified)
                    |
                    v
PER-NODE SNAPSHOT + FENCED ATTEMPTS
                    |
                    v
EXACTLY-ONCE-OR-STOP EFFECT ADAPTERS
                    |
                    v
DURABLE APPROVAL + ORTHOGONAL MANUAL PAUSE
                    |
                    v
HERMETIC MULTI-CRASH RELEASE JOURNEY
                    |
                    v
EVIDENCE / PROCESS / NETWORK RELEASE HARDENING
                    |
                    v
CORE PRODUCT COMPLETION + UX TRUTH PASS
                    |
                    v
PACKAGING + ENTERPRISE FAULT / SECURITY GATES
                    |
                    v
CONTROLLED EVOLUTION AND OPTIONAL ACCELERATORS
```

## Priority tiers

### P0 — Release invariants: build now

These tasks are serial in the central-runtime lane. Starting later work before their contracts stabilize creates rework.

| Order | Deliverable | Why now | Dependencies | Proof gate | Estimate |
|---:|---|---|---|---|---:|
| 1 | Versioned per-node snapshot and pure transition/recovery reducer | The legacy topological-prefix checkpoint is not correct for parallel crash recovery. Every later approval/effect test depends on actual node state. | Permission/filesystem checkpoint complete | Crash traces never skip an unfinished branch; stale attempt results are fenced; legacy records remain readable | 2–3 days |
| 2 | Exactly-once-or-stop effect protocol | Prevents duplicate or silently skipped HTTP/file/MCP/process/model/trigger effects. | Per-node reducer | Prepared/inflight/confirmed/ambiguous transitions; stable operation key; confirmed effects do not reissue; ambiguity becomes `needs_review` | 2–3 days |
| 3 | Durable approval and manual pause | Current approval state is in memory and pause semantics are mixed with restart interruption. | Snapshot/reducer; effect-review wait state | Strict decision enum, revision/subject CAS, exact replay receipt, conflict/stale rejection, pause survives restart independently | 1–2 days |
| 4 | Hermetic multi-crash journey | Becomes the executable definition of the local-first release journey and replaces host-specific evidence gaps. | 1–3 | Typed graph → immutable version → parallel effect → three crashes → approval → trigger dedupe → artifact → redacted evidence, with no live models/Keychain/LaunchAgent | 2–3 days |
| 5 | Release boundary closure | The runtime must not be called secure while arbitrary processes/network/evidence paths remain under-specified. | Journey harness | Release policy for executable nodes, HTTP allowlists/redirects, streaming canaries, safe evidence DTO, no high/critical unresolved finding | 2–4 days |

Expected P0 critical path: **9–14 calendar days**. Estimates include characterization, migrations, focused repair, and integration gates rather than code generation alone.

### P0 parallel preparation — useful now, but no second runtime writer

These can proceed only in non-overlapping files after the relevant interface is frozen:

- Deterministic fake HTTP/MCP/model/trigger services and kill/restart harness.
- Historical checkpoint fixtures and crash-trace generators.
- Approval/pause browser states after API/schema freeze.
- Qwen read-only sink/effect/capability inventory with exact source citations.
- Request/evidence/symlink adversarial test cases.
- Per-task delegation metrics collection.

Do not let parallel preparation invent a competing checkpoint, approval, or security contract.

### P1 — Complete the contractual product after P0

| Sequence | Product area | Remaining outcome | Why after P0 | Estimate |
|---:|---|---|---|---:|
| 1 | Governance lifecycle UX | Truthful Development/Testing/Production state, candidate evidence, approvals, exact grants, rollback, and blocked reasons in every mode | UI must bind to final durable approval/evidence contracts | 2–3 days |
| 2 | Custom nodes/plugins | Complete manifest test UX, compatibility/provenance/license/signature surfaces, safe upgrade/uninstall, and permission review | Executable adapters require final effect/recovery policy | 3–5 days |
| 3 | Evaluations/controlled learning | Visual/accessibility/security adapters, baseline comparison, failure clusters, proposal lifecycle, and measured routing observations | Requires trustworthy run/evidence data and immutable approval state | 3–5 days |
| 4 | Studio productivity closure | Copy/paste, smart contextual insertion, remaining truthful context actions, schemas/consoles, recovery cards, keyboard/a11y/visual gates | Recovery/error UX must reflect the final state machine | 3–5 days |
| 5 | Agent primitives/Role Cards | Previewed legacy mapping, versioned Role Cards/instances/assignments, Easy-mode job titles and Pro technical details | Governance and permission identities must be stable | 3–5 days |
| 6 | 2D Operations Map | Real queue/run/approval/resource/artifact state only, stale-state behavior, actions, accessibility, low-power performance | Depends on authoritative runtime events and agent identities | 2–4 days |

P1 is designed as several independently verified slices. The likely elapsed time is **2–3 weeks** after P0 with one runtime writer and one isolated UI/test lane.

### P2 — Ship and harden the complete current scope

| Area | Work | Entry gate | Exit gate | Estimate |
|---|---|---|---|---:|
| Open-source packaging | Clean setup, contributor/security docs, sample sanitized data, pinned toolchain, package round trips, quarantine, compatibility/license/provenance | P0/P1 product contracts stable | Fresh-machine setup and secure package lifecycle pass | 4–7 days |
| Backup/restore/diagnostics | Versioned backups, restore rehearsal, corrupt/truncated/disk-full recovery, support bundle with redaction | Stable stores and evidence | Backup and restore produce matching canonical state | 3–5 days |
| Long-duration reliability | Heavy concurrency, cancellation, sleep/restart, resource pressure, no-progress, memory/file-descriptor cleanup | Hermetic journey green | Soak and fault matrix pass with bounded resources | 3–5 days |
| Security/accessibility/performance RC | Secret/injection/SSRF/process/path tests, SBOM/dependencies, full browser keyboard/Axe/visual/perf gates | Release candidate | No unresolved high/critical; observed behavior matches docs | 3–5 days |

P2 elapsed expectation: **1.5–2.5 weeks**, with packaging and fault/security work partially parallel.

### P3 — Dependency-gated self-improvement and AI-factory acceleration

These are valuable, but must not become the product.

| Enhancement | Why it waits | Entry proof | Promotion threshold | Initial experiment |
|---|---|---|---|---:|
| Controlled learning implementation | Current observations are incomplete until P0 evidence is authoritative | Durable runtime, evaluations, permissions, lifecycle all verified | Faster accepted delivery or better quality without authority/gate changes | 1 day design/replay slice |
| Qwen cited pre-review gate | Needs comparable patch/review metrics | At least 20 categorized tasks | Lead review time −20%, material finding acceptance ≥25%, false-positive overhead <5 min/patch | 20–30 patch shadow test |
| Repo-specific local-model benchmark | Public benchmarks do not predict this repository | Frozen hidden task corpus and incumbent baseline | Security/schema/citation gates plus ≥15% faster accepted output or clear quality win | 40–50 tasks |
| Contract-complete task packets | Needs stable seam ownership and acceptance schemas | P0 contracts frozen | First-pass acceptance +10 points or review/rework −25% | 20 matched tasks |
| Delegation router | Needs enough observations per task class | ≥12–20 comparable tasks per route | ≥15% lower accepted cycle time, no defect regression | Shadow decisions only |
| Failure-learning artifacts | Needs authoritative failure classes and blocker fingerprints | P0 reducer/effects implemented | Historical replay + independent review + low-risk canary | One task class |
| Context caching | Server/version support and hit-rate are unknown | Repeatable prompt-prefix benchmark | ≥15% end-to-end loop reduction without memory-pressure regression | Local A/B only |

### P4 — Deliberately deferred or conditional enhancements

| Enhancement | Decision | Unlock condition |
|---|---|---|
| Embeddings/reranking for engineering context | DEFER | Fixed-token A/B improves required-file recall ≥10 points and accepted task cycle ≥15%, without Qwen VRAM contention |
| Additional local LLMs | DEFER | Existing Qwen has a measured task-class gap and candidate wins repo benchmark; no model is downloaded for reputation alone |
| SQLite/event-store migration | DEFER | Atomic JSON fails a measured scale/query/transaction requirement or fault test; migration has backup/export/rollback proof |
| Broad MCP marketplace | DEFER | Core allowlisted MCP conformance, provenance, permission, and quarantine gates are release-verified |
| General arbitrary-code sandbox | DEFER | Supported macOS security design exists and passes adversarial isolation; `sandbox-exec` is not accepted as a production claim |
| Long-document/500-page pipeline | DEFER from main path | P0/P1/P2 release core complete; durable chapter workflow can reuse final checkpoint/approval/artifact contracts |
| Interactive/animated Company World | DEFERRED BY CURRENT USER SCOPE | Owner explicitly reactivates it after the truthful 2D Operations Map is complete and performance evidence exists |
| Cinematic 3D city | DEFERRED BY CURRENT USER SCOPE | Owner explicitly reactivates it; renderer remains execution-independent with 2D fallback |
| Full SQLite-backed Continuous Evolution store | CONDITIONAL | Evolution event volume/query needs exceed verified JSON design and migration gate passes |

Deferred does not mean forgotten. Each item retains its rationale and unlock condition so it cannot silently re-enter the critical path.

## End-to-end waves and calendar view

| Wave | Outcome | Approximate elapsed time | Completion meaning |
|---|---|---:|---|
| A | Permission/filesystem/request/redaction/lifecycle foundation | COMPLETE | Committed and verified |
| B | Per-node recovery, effects, approval/pause, hermetic journey | COMPLETE | Core local-first journey is trustworthy across crash and ambiguity |
| C | Governance/custom/evaluation/Studio/agents/Operations Map closure | COMPLETE FOR CURRENT SCOPE | Current product scope and the additive Agent Primitive migration amendment are implemented and release-gated |
| D | Packaging, backup/restore, soak, security/accessibility/performance RC | ENGINEERING COMPLETE | Reproducible hardened source/package candidate; open-source designation awaits license |
| E | Controlled evolution and measured AI-factory upgrades | 2–4 weeks, post-RC and incremental | The factory improves from evidence without self-modifying authority |

Waves overlap only at stable interfaces. Estimated total for the complete current non-3D scope is approximately **5–8 weeks**, not including optional P3/P4 experiments that fail their value gates. The secure-v1 critical journey arrives much earlier, at the end of Wave B.

## Why this order is faster

1. Recovery/effect/approval contracts are upstream of nearly every runtime, UX, evaluation, and governance feature.
2. One hermetic journey replaces repeated manual and host-specific proof across multiple phases.
3. Final runtime events make the Operations Map and learning system truthful instead of requiring later schema rewrites.
4. Deferring unsupported sandbox, embeddings, extra models, SQLite, and 3D avoids spending weeks optimizing around unstable contracts.
5. Packaging begins after schemas stabilize, preventing documentation/install/migration churn.
6. AI-factory changes must save measured lead/review time; extra agents are not assumed to create throughput.

## Independent-review prompt

Use this prompt with external AIs. Repository access is not required.

```markdown
You are an independent delivery-systems architect reviewing the dependency-aware portfolio plan for a local-first AI workflow product.

Current facts:
- React/TypeScript/Node/Express/React Flow, atomic JSON persistence, macOS LaunchAgent, localhost only.
- Typed DAGs, parallel branches, subworkflows, MCP, triggers, plugins/custom nodes, evaluations, governance, 2D Operations Map, and a multi-agent engineering factory already have substantial implementations.
- Request boundary, centralized redaction, exact lifecycle, secret references, deny-wins Testing/Production capability ceilings, and practical symlink-safe core file access are implemented and verified.
- The current runtime still needs correct per-node crash recovery, exactly-once-or-stop side-effect handling, durable approval/manual-pause state, and one hermetic multi-crash release journey.
- One central-runtime writer is allowed. An isolated UI/test worker and read-only local reviewer can work in parallel after interfaces freeze.
- No cloud control plane, broad rewrite, unsupported macOS sandbox claim, or uncontrolled self-modification is allowed.

Proposed order:
1. Per-node snapshot + pure reducer.
2. Side-effect prepared/inflight/confirmed/ambiguous protocol.
3. Durable approvals and orthogonal manual pause.
4. Hermetic multi-crash journey.
5. Release boundary closure.
6. Governance/custom nodes/evaluations/Studio/Role Cards/2D Operations Map.
7. Packaging and enterprise fault/security gates.
8. Controlled learning and measured AI-factory enhancements.

Deferred until measured/unlocked:
- embeddings/reranking;
- additional local models;
- SQLite/event-store migration;
- broad MCP marketplace;
- general arbitrary-code sandbox;
- long-document pipeline;
- animated/3D Company World.

Challenge this order without asking for repository access.

Answer:
1. Which dependency is wrong or missing?
2. Which future task should be prepared now because doing it later would cause avoidable rework?
3. Which proposed parallel task would actually create interface churn?
4. Which blade-sharpening enhancement has the highest credible calendar return before the runtime work?
5. Which enhancement should definitely remain deferred?
6. Can any two serial tasks safely merge without increasing correctness risk?
7. What is the smallest acceptance artifact that should freeze each interface?
8. Which estimates are unrealistic and why?
9. What work can be eliminated by one shared fixture, reducer, schema, or evidence contract?
10. What would you implement in the next 48 hours, next 2 weeks, and only after release candidate?

For every recommendation provide:
- dependency impact;
- estimated calendar change;
- new risk;
- deterministic proof gate;
- rollback;
- confidence.

Do not recommend more agents, models, databases, frameworks, or retrieval infrastructure unless you state the measured bottleneck they solve and the experiment that proves the benefit.
```

## Plan maintenance

After every verified slice:

1. Update the authoritative commit/host/public checkpoint.
2. Recompute only dependencies affected by the new evidence.
3. Record actual versus estimated elapsed and review time.
4. Promote a deferred enhancement only when its unlock condition is now true.
5. Keep one executable next task in `state/next-task.md`.
6. Never change final scope merely to make current completion appear higher.
