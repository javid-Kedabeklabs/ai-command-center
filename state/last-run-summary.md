# Last run summary

## Current completion checkpoint — 2026-07-14

- Completed immutable evaluation baselines, versioned exact-run datasets, SHA-bound artifact/model reports, and replay-safe controlled learning that creates only separate governed Development candidates.
- Completed portable exact-manifest plugin packages, durable Company World department authoring, versioned install/upgrade/rollback, sanitized packaging, clean install, SBOM, supply-chain, and LaunchAgent gates.
- Completed copy/paste/duplicate/delete/undo/Escape/search keyboard editing, reduced motion, 1280px responsive containment, macOS canvas visual regression, and truthful unavailable controls.
- Added disk-full failures before and after rename, explicit post-rename commit-uncertain tagging, 80-cycle bounded DAG soak, 250 checkpoint runs, 2,000-node planning, 300 fsync-backed replacements, and descriptor/temp cleanup.
- The authoritative release verifier now passes 26/26 gates, including ten live browser/Axe/visual journeys. Latest receipt: `c93bf6510422459c919b873d644fc3ca615a74548c2b9f263210ff969fb600b6`.
- Current implementation commits include `16de7d9`, `7e83f1a`, and `eef0420`. User-owned dirty `data/` files remain deliberately unstaged and unchanged by source commits.
- Reconciled documentation and truthful unavailable controls at `d0f7c04`.
- Published sanitized review snapshot `2c9b2fb242923d1fe61a85fa88a1eed4b96767dd`; Gitleaks reported zero findings and disposable dependency/package/hardening/type/build verification passed.
- Reloaded the product with host request `host-812838869a8d16f3` and receipt `1fdb6d6d740c796cd00fa5e0e924b33df194b1c45a241a97400fa87c0b491fc6`. Health and new APIs returned 200, hostile Host returned 403, and a disposable checkpoint-v2 workflow completed before cleanup.
- Remaining current-scope decision: obtain an owner-selected license before any open-source claim.

The earlier runtime checkpoint below is retained as historical evidence.

## Iteration identity

- Timestamp: 2026-07-14T00:17:15Z
- Phase: critical runtime durability
- Base commit: `519fafd` (`Prioritize the full delivery portfolio`)
- Task: make Company World consume authoritative checkpoint and run-control truth
- Commits through prior checkpoint: `9ab9403`, `c38154e`, `6c6c715`, `7e907f1`, `8a05cc4`, `949484b`, `789cdf8`, `f150cc8`

## Completed

- Added checkpoint schema v2 with stable logical execution keys, stable effect operation keys, per-node attempts, runtime-epoch fencing, exact terminal states, effect phases, revisions, and legacy migration.
- Integrated checkpoint v2 into the shipping runner. Recovery restores exact completed nodes rather than a topological prefix; explicit retries reset only the requested logical execution scope.
- Added conservative crash recovery: computation may retry after restart; an unsafe in-flight node without authoritative evidence becomes durable `needs_review`.
- Added durable prepared/inflight/confirmed effect phases for file writes and mutating HTTP.
- Made ordinary non-append safe-file writes use a same-directory exclusive temporary file, file `fsync`, atomic rename, and directory `fsync`.
- Added file-effect reconciliation using the expected content hash. A crash after the rename but before checkpoint confirmation finalizes without reissuing the write.
- Mutating HTTP records a request hash and stable operation key. A configured idempotency header receives that stable key; uncertain transport completion stops for review instead of retrying blindly.
- MCP calls now validate configured trust/tool policy before dispatch, then persist prepared/inflight/confirmed effect evidence and an output hash. Uncertain post-dispatch failure stops for review.
- Added durable run-control schema v1. Approval requests have stable subject-bound identities; decisions use command receipts, revision/subject preconditions, idempotent replay, and terminal conflict detection.
- Manual pause is orthogonal to approval state, uses generation-checked command receipts, survives restart, and blocks node claiming until an explicit resume.
- The browser event subscription now follows `recoveredBy` chains, switches controls and artifacts to the recovered physical run, and preserves the logical user journey across server restart.
- Subworkflow dispatch now persists a stable parent operation before launch, deduplicates child creation across parent crash/retry, follows child recovery chains, and commits an authoritative child receipt.
- Triggered runs retain their delivery context across recovery and link a safe trigger receipt into the authoritative checkpoint. Trigger watchers are restored on boot and follow recovered run IDs instead of remaining attached to interrupted runs.
- Added a safe run-evidence DTO with linked run/version/trigger/effect/approval/checkpoint receipts, redacted events, and artifact metadata; it excludes raw outputs and run directories.
- Redaction now covers registered secret encodings, and secret-bearing file/Obsidian writes are redacted before artifact commitment.
- Workflow Studio renders approval authority and node status from durable control/checkpoint records and submits revision/subject-bound approval commands.
- Added `npm test` / `npm run verify:release` as the reproducible integration contract across runtime crashes, subworkflow/trigger receipts, secret canaries, typecheck, build, and browser tests.
- Added a typed safe-evidence client and a verified-evidence panel in Run Center. It polls alongside active run detail and shows only linked version, checkpoint, trigger, approval, node, effect, and artifact metadata receipts.
- Added a live-backend browser acceptance journey that saves a typed workflow, creates its immutable run version, reaches durable approval, submits a revision/subject-bound decision, completes, and verifies safe evidence in Run Center without route mocks.
- Corrected Workflow Studio's durable approval state handling from the nonexistent `requested` display value to the authoritative `pending` state, restoring approval controls and waiting-node truthfulness.
- Added typed lifecycle, immutable-candidate, approval, deployment, and rollback clients. Candidate-bound runs now carry the exact candidate and workflow-version identity needed for promotable evaluation evidence.
- Added a Workflow Studio governance panel that derives permitted actions from the persisted lifecycle state, displays exact candidate/version/hash evidence, reports required evaluation receipts, and submits fully bound Development → Testing → Production or rollback requests rather than mutable promotion commands.
- Added a live-backed browser lifecycle journey proving immutable candidate creation, exact Testing preparation, approval, single-use entry, and persisted approval evidence.
- Replaced private run-directory disclosure in `/api/runs` with safe workflow, version, candidate, and environment identities required by Evaluation Lab.
- Evaluation Lab now filters runs by the selected workflow, distinguishes candidate-bound promotable evidence from diagnostic/sample checks, prevents cross-workflow evaluation submission, and displays exact candidate/version receipts.
- Imported plugins now receive a canonical manifest hash. Review requires that exact hash, stale review attempts fail closed, approval produces an immutable receipt, contributed nodes inherit manifest/version/review provenance, and enablement revalidates the receipt against the current manifest.
- Added isolated live-browser proof for promotable candidate evaluation evidence and exact manifest-bound plugin review, including stale-review rejection and receipt display.
- Replaced Company World's latest-event inference with authoritative checkpoint node states, durable approval counts, manual pause, `needs_review`, checkpoint revision, exact workflow version, and recovery identity.
- Operations Map activity is now a fixed derivation of persisted control/checkpoint facts; it no longer exposes raw event payloads or represents event text as execution truth.
- Extended the live approval journey to prove Company World reports `waiting-approval`, the exact active node, approval count, and checkpoint revision before the decision commits.
- Committed the product journey at `8d231e0` and published sanitized public review snapshot `a6232e9` on `review/current-20260713`; unauthenticated `git ls-remote` confirms it is public.
- Reloaded the committed implementation through host request `host-5c3fe066d0712a55`; its HTTP 200 health postcondition and receipt SHA-256 `1cd8aa0b89c7ea1c76bfbbd2c4d67bcafe2c126805b08faf1eb6356e2e682be8` passed.
- Committed the exact lifecycle product integration at `b208d30` and published sanitized snapshot `47b1133` on `review/current-20260713`.
- Reloaded that implementation through host request `host-7bbbe1f0851a2aee`; its HTTP 200 health postcondition and receipt SHA-256 `d021a45fd22a0e8cb164265868cd9a02f41bae7b85e098c46f10e9f22b212f8e` passed.
- Committed exact evaluation/plugin evidence at `82ef523` and published sanitized snapshot `826a2a3` on `review/current-20260713`.
- Reloaded it through host request `host-80f8a0e83c2305c8`; its HTTP 200 health postcondition and receipt SHA-256 `7edf29b10303485b88ef9ce0b53c9157b143882c3f344b6c82217ee3b0c79e19` passed.
- Committed truthful Company World at `fa3f677` and published sanitized snapshot `ccb3bf3` on `review/current-20260713`.
- Reloaded it through host request `host-99aa4323b5a11a29`; its HTTP 200 health postcondition and receipt SHA-256 `c667f6e0828e3a6c165291759d4c9fd91c7a4cc9c27942805b2564edfa51a034` passed.

## Verification

- Pure checkpoint transitions: 20/20; pure run-control transitions: 9/9; subworkflow receipt identity: 5/5.
- Deterministic live SIGKILL/restart matrix: 6/6. In addition to effect recovery, it proves pending approval identity survives restart with replay-safe decision receipts and explicit manual pause survives restart until generation-checked resume.
- Safe filesystem boundary: 6/6.
- Phase 0 contract: 37/37 on isolated state.
- Deterministic subworkflow post-accept crash recovery: 1/1; deterministic trigger-to-recovered-run receipt linkage: 1/1.
- Browser Playwright suite: 6/6, including live safe evidence, exact governance/evaluation, and manifest-bound plugin review journeys.
- Safe evidence canary: 1/1 across durable data, artifacts, detail/evidence APIs, audit, and bundle export; redaction transforms: 11/11.
- Unified release verification passed all 12 gates with receipt SHA-256 `e5ec50fd239cef4321fde94d09fd47ab9d66b62a0a1e9134e994e97442470142`.
- Smoke: 30/30 on isolated state.
- TypeScript and production build: passed.
- Staged and complete public-snapshot Gitleaks scans: passed.
- Committed host: health 200 and a temporary workflow completed with checkpoint schema v2, revision 4, and both nodes succeeded.

## Learned constraints

- A prepared effect is safe to retry because dispatch was not authorized; an in-flight effect needs reconciliation or review; a confirmed effect can finalize after restart without reissue.
- `lastNodeId` cannot prove completion because the legacy runner wrote it before node execution.
- Stable operation keys must identify the logical execution and remain independent of physical attempt number.
- Generic HTTP idempotency headers are not proof that a destination deduplicates. Automatic HTTP reconciliation requires an audited provider contract or authoritative status query.
- File hash reconciliation is authoritative only because writes are atomic and constrained beneath the run workspace.
- Approval and manual pause must remain orthogonal: approving work must never clear an explicit operator pause.
- Parent/child deduplication identity must use the parent's logical run ID; a recovered physical parent run ID is evidence, not identity.
- Trigger watchers are durable behavior, not process-local convenience: boot must restore watchers for already-started deliveries and follow the run recovery chain.
- Browser approval actions bind to the durable approval ID, revision, and subject hash, never reconstructed display text.
- Release evidence is a dedicated DTO; internal run/checkpoint objects are not the public evidence contract.

## Next

- Complete the packaging/backup/restore/upgrade/rollback and supply-chain release contract.
- Make Company World render only authoritative persisted checkpoint/control states.
- Complete packaging inventory, backup/restore rehearsal, upgrade/rollback receipts, and the remaining hardening audit.
