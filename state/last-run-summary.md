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
- Added durable prepared/inflight/confirmed effect phases for file writes, mutating HTTP, MCP, and subworkflows.
- Made safe-file writes atomic and added content-hash reconciliation after crash.
- Mutating HTTP records a request hash and stable operation key; uncertain transport completion stops for review instead of retrying blindly.
- MCP calls persist effect evidence and stop for review after uncertain dispatch.
- Added durable approval and manual-pause control with subject-bound identities, command receipts, generation/revision preconditions, idempotent replay, and conflict detection.
- The browser follows `recoveredBy` chains and switches controls and artifacts to the recovered physical run.
- Subworkflow dispatch persists a stable parent operation, deduplicates child creation across parent crash/retry, follows child recovery chains, and commits an authoritative child receipt.
- Triggered runs retain delivery context across recovery and link a safe trigger receipt into the checkpoint. Trigger watchers are restored on boot and follow recovered run IDs.
- Existing request guarding, redaction, deny-wins permissions, symlink-safe filesystem boundaries, immutable versions, typed ports, Keychain references, and trigger-store durability remain in force.

## Verification

- Pure checkpoint transitions: 20/20; pure run-control transitions: 9/9; subworkflow receipt identity: 5/5.
- Deterministic live SIGKILL/restart matrix: 6/6.
- Deterministic subworkflow post-accept crash recovery: 1/1.
- Deterministic trigger-to-recovered-run receipt linkage: 1/1.
- Trigger store/idempotency: 17/17.
- Safe filesystem boundary: 6/6.
- Phase 0 contract: 37/37 on isolated state.
- Browser Playwright suite: 3/3.
- TypeScript and production build: passed.
- Staged and public-snapshot Gitleaks scans: passed.

## Learned constraints

- A prepared effect is safe to retry; an in-flight effect needs reconciliation or review; a confirmed effect can finalize after restart without reissue.
- Stable operation keys identify logical execution and remain independent of physical attempt number.
- Parent/child deduplication uses the parent's logical run ID; a recovered physical run ID is evidence, not identity.
- Trigger watchers are durable behavior: boot restores watchers for started deliveries and follows run recovery chains.
- Approval and manual pause remain orthogonal.
- Runtime/user files remain outside integration and publication.

## Next

- Expand browser coverage to render durable control state directly.
- Complete the multi-crash trigger/redacted-evidence journey and safe evidence DTO.
- Wire deterministic runtime, trigger, subworkflow, and browser gates into one reproducible verification command.
