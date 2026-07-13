# Last run summary

## Iteration identity

- Timestamp: 2026-07-13T22:40:00Z
- Phase: critical runtime durability
- Base commit: `519fafd` (`Prioritize the full delivery portfolio`)
- Task: extend exactly-once-or-stop handling through subworkflows, trigger recovery, and browser recovery following
- Commits: `9ab9403`, `c38154e`, `6c6c715`, `7e907f1`, `8a05cc4`, `949484b`, `789cdf8`

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
- Existing request guarding, deny-wins permissions, symlink-safe filesystem boundaries, immutable versions, typed ports, Keychain references, and trigger-store durability remain in force.

## Verification

- Pure checkpoint transitions: 20/20; pure run-control transitions: 9/9; subworkflow receipt identity: 5/5.
- Deterministic live SIGKILL/restart matrix: 6/6.
- Deterministic subworkflow post-accept crash recovery: 1/1.
- Deterministic trigger-to-recovered-run receipt linkage: 1/1.
- Trigger store/idempotency: 17/17.
- Safe filesystem boundary: 6/6.
- Phase 0 contract: 37/37 on isolated state.
- Browser Playwright suite: 3/3.
- Safe evidence canary: 1/1 across durable data, artifacts, detail/evidence APIs, audit, and bundle export; redaction transforms: 11/11.
- Unified `npm test` release verification passed 12 gates with receipt SHA-256 `57d8b3740e96324d3d6d39a7cfe2167b7c0c9479ac92f13cf86b8a11de9617d9`.
- Smoke: 30/30 on isolated state.
- TypeScript and production build: passed.
- Staged and public-snapshot Gitleaks scans: passed.

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
- Runtime/user files remain outside integration and publication.

## Next

- Add the complete live-backed browser build/save/run/approve/evidence journey.
- Surface safe linked evidence in Run Center.
- Continue exact-version governance/evaluation/plugin integration and packaging inventory.
