# Autonomous contract completion audit

This is the evidence ledger for the active implementation contract. A green narrow test does not upgrade a broader requirement. `VERIFIED` means current code plus deterministic evidence covers the stated scope; `IN_PROGRESS` and `BLOCKED` remain release work.

| Contract area | Current finding | Authoritative evidence | Remaining acceptance |
|---|---|---|---|
| Recovery and stabilization | VERIFIED | Preserved dirty user stores; additive commits; current host reload receipts; checksum-backed operational stores | Continue preserving user-owned `data/` changes |
| Autonomy supervisor | VERIFIED | Bounded worker, control plane, host-operation receipts, LaunchAgent PathState, stop/resume/doctor suites | No expansion required for product v1 |
| Canonical workflow platform | VERIFIED | Schema v2 migration, typed ports, immutable versions, live save/version browser journey | Keep future migrations additive |
| Durable runtime | VERIFIED | Per-node checkpoints, stable operation keys, stale-attempt fencing, durable approval/manual pause, six-boundary multi-crash gate | Long-duration soak remains hardening, not runtime semantics |
| MCP and triggers | VERIFIED | Reviewed MCP registry/transports/auth references; persistent interval/cron/webhook/folder triggers; dedupe and restart receipts | Optional online connections remain explicit capabilities |
| Subworkflows/components | VERIFIED | Exact child pins and safety ceilings; reviewed component manifest round-trip in live browser | None for v1 |
| Custom nodes/plugins | VERIFIED | Wizard/runtime, exact review receipts, compatibility, Ed25519 integrity, package test/export/import, browser evidence | Publisher trust roots may be added after v1; signatures never auto-grant trust |
| Evaluations and learning | VERIFIED_FOR_LOCAL_FIRST_V1 | Exact candidate/run-bound deterministic evidence; versioned datasets/cases; aggregate exact-run receipts; duration/reconciliation gates; baselines; SHA-bound visual/accessibility/security/model reports; stable failure fingerprints; replay-safe decisions; stale-source rejection; separate Development candidates; exact regression verification; approved Testing promotion | Broader autonomous external intelligence remains dependency-gated under Continuous Evolution |
| Governance | VERIFIED_FOR_LOCAL_FIRST_V1 | Exact environment lifecycle, candidate/evaluation/deployment receipts, deny-wins capability policy, redaction, loopback guard | Enterprise policy administration is outside local-first v1 |
| Complete UX | VERIFIED_FOR_CURRENT_SCOPE | Shared four-mode canvas, truthful context actions, command palette, copy/paste/duplicate/delete/undo/search/Escape keyboard journey, smart insertion, recovery cards, technical panels, reduced-motion CSS, 1280px containment, macOS visual baseline, and eleven live Playwright/Axe journeys | Direct Python diff generation and edge data monitoring remain visibly disabled with reasons rather than fake controls |
| Company World | VERIFIED | Durable truthful operations state plus revisioned department authoring and Axe browser proof | None for required 2D scope; 3D remains user-deferred |
| Open-source packaging | BLOCKED | Sanitized package, clean install, SBOM, dependency audit, LaunchAgent, versioned upgrade/rollback all pass | Owner must select project license; commit exact license text and metadata |
| Enterprise hardening | VERIFIED_FOR_LOCAL_FIRST_V1 | Release gate covers recovery, redaction, disk-full before/after rename semantics, bounded concurrency soak, checkpoint/DAG/atomic-write performance ceilings, descriptor/temp cleanup, backup/restore, clean package, supply chain, build and browser | Longer unattended host soak remains an operational confidence exercise, not an unimplemented correctness contract |
| Collaboration lane | IN_PROGRESS, NON-BLOCKING FOR PRODUCT V1 | Isolated Fable pilot, worktree ownership, result/capacity/process tests | Durable lease/restart UI and broader task classes are AI-development enhancements |
| Local model factory | IN_PROGRESS, NON-BLOCKING FOR PRODUCT V1 | Citation verification and deterministic baseline | Candidate A/B, telemetry and supervisor routing only after measured promotion |
| Agent primitives | VERIFIED | Fourteen primitives, versioned Role Cards, instruction profiles, Agent Instances, exact Workflow Assignments, atomic revisioned store, snapshot-bound preview, explicit ambiguous choice, command replay, rollback receipts, exact-only reactivation, live API/UI/Company World identity, and release-gated browser proof | Future Role Card upgrades must create a new version rather than rewrite retained versions |
| Continuous evolution | NOT_STARTED, DEPENDENCY-GATED | Architecture and immutable-authority rules documented | Implement only after evaluation and hardening foundations pass; models may never rewrite authority or gates |

## Current critical path

1. Reconcile release/security/testing documentation against observed behavior.
2. Publish the current sanitized review snapshot and reload/verify the product host.
3. Apply the owner-selected license, then rerun package, SBOM, secret scan, and release verification before describing the project as open source.

## Decisions that remain intentionally fail-closed

- Project license: no default is inferred; package metadata remains `UNLICENSED`.
- Ambiguous external effects: `needs_review`, never blind retry.
- Imported executable packages: disabled until exact manifest review; signature integrity is not publisher trust.
- Shell/Python/custom execution in Testing/Production: denied unless an explicit reviewed capability policy permits the exact action; no unsupported `sandbox-exec` security claim.
- Optional APIs/MCP/webhooks/cloud: supported through explicit permissions and secret references; the product listener remains loopback-only.
