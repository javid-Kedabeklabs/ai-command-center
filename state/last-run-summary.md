# Last run summary

## Iteration identity

- Timestamp: 2026-07-13T22:55:00Z
- Phase: 8 — Governance and security hardening
- Base commit: `ba4f2cb` (`Harden local requests and redact release evidence`)
- Task: enforce deny-wins environment permissions and symlink-safe core filesystem access
- Commit: pending final staged gates

## Completed

- Published request-boundary/redaction commit `ba4f2cb` as sanitized public default-branch snapshot `4a94fa9`, reloaded it through host receipt `host-fdcd56419f91361c`, and verified hostile Host, hostile Origin, missing browser session, and smoke 30/30 live.
- Added the complete known capability registry and deny-wins composition across environment, inherited subworkflow, workflow, node, custom-node, and plugin policy.
- Testing and Production now deny every capability absent from the exact reviewed workflow candidate; Development remains compatible, and unknown environments/capability names fail closed.
- Split package installation from general code execution with `install-packages`; folder and webhook authority now use effective environment permissions.
- Added `server/security/safe-files.js` with canonical-root containment, traversal/absolute/NUL rejection, full parent-chain symlink rejection, safe parent creation, regular-file enforcement, and final-component `O_NOFOLLOW` where supported.
- Integrated the boundary into run read/write/Python scripts, artifacts, AgentBrain CRUD/export/import, workflow skill reads, Obsidian vault operations, and external file/folder input validation. Recursive folder input skips symlinks.
- Added an isolated `ACC_BRAIN_DIR` test override that is constrained to the repository worktree and cannot redirect production state outside it.

## Verification

- Effective permission composition: 9/9 pure and 7/7 live, including implicit Testing denial, explicit exact grant, and unknown custom/plugin capability rejection.
- Symlink-safe filesystem boundary: 6/6 pure and 2/2 integrated API/run-artifact checks.
- Import security: 4/4 on fresh isolated state.
- Phase 0 contract: 37/37 on fresh isolated state.
- Live Keychain secret transport/no-persistence: 5/5 on fresh isolated state.
- Exact evaluation: 9/9; governance lifecycle: 16/16 pure.
- Trigger store/idempotency: 17/17.
- Smoke: 30/30 on fresh isolated state.
- Playwright/Axe: 3/3 focused and 90/90 across 30 repeated isolated runs; browser data and AgentBrain fixtures are both temporary.
- TypeScript and production build: passed.

## Learned constraints

- Exact-candidate permission hashes make explicit Testing/Production grants reviewable without silently disabling the product's executable primitives.
- Capability requirements and permission denials are different concepts: custom/plugin declarations request known capabilities, while environment/workflow/node policy may still deny them.
- Node/macOS lacks Linux `openat2` beneath-root semantics. Parent-chain checks plus final `O_NOFOLLOW` are a strong practical boundary but must not be described as eliminating every concurrent parent-replacement race.
- Live tests must require explicit temporary data and brain directories; accidental use of persistent state produces conflicts and weak evidence.
- Runtime/user files remain outside integration and publication.

## Next

- Run final broad/staged gates, commit, refresh the sanitized public review snapshot, and reload/verify the committed host.
- Implement a versioned per-node checkpoint/attempt state machine and ambiguous side-effect reconciliation with parallel crash-boundary tests.
- Continue with durable approval/pause and the hermetic release journey.
