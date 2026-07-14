# Claude Code Integration

Claude Code is invoked only by the collaboration dispatcher for a validated task packet. The dispatcher uses the installed CLI help as its capability source and never assumes flags from another release.

New task packets use schema v3 and are authority-complete before dispatch. Each packet freezes the exact reviewed Git base, acceptance-test commit, stable scenario IDs, exact SHA-256 hashes for read-only contract files, a changed-file budget, a planning-only Codex estimate, and stop conditions. Every product, security/capability, persistence, semantic-port, wire-API, design/copy, and acceptance authority category must be bound to frozen files or marked `not-applicable-and-forbidden`. The acceptance set binds exact test IDs, file hashes, locale, timezone, clock seed, and data seed. Dispatch derives content-addressed authority/acceptance IDs and a local dispatch digest before work reservation. It truthfully reports that this digest is unsigned until an owner-approved trust root exists. Legacy v1/v2 records remain readable, but cannot be newly queued or dispatched.

The same Collaboration Center exposes the durable self-challenge ledger through a read-only, no-store endpoint. The server parses a bounded regular file into a safe DTO, rejects duplicate IDs, invalid states/dates, or unsupported resolution transitions, and permits exact status filtering. The UI shows only `OPEN` questions with their owner, review date, and next required evidence. No API exists for model-driven ledger mutation.

## Worker modes

- `READ_ONLY_ADVISOR`: restricted read/search and approved non-mutating commands; no worktree mutation or commit.
- `WORKTREE_IMPLEMENTATION`: unique branch/worktree, explicit allowed and forbidden paths, bounded timeout, minimum tools, and one required related commit.

Fable 5 is preferred for bounded complex UI, React Flow, accessibility, Three.js/R3F/GSAP, difficult contained refactors, tests, and independent review. Sonnet fallback is used only when the task policy permits it and is always reported. Codex retains cross-module integration and security-sensitive decisions.

## Worker result gate

The normalized result is `COMPLETED`, `PARTIAL`, `BLOCKED`, or `FAILED_SAFELY` and records summary, commit SHA, files changed, test command/status/details, risks, assumptions, and `INTEGRATE|REQUEST_CHANGES|DISCARD|NEEDS_HUMAN_DECISION`. The runner also extracts actual-model provenance from structured events. Missing provenance, an unapproved model, or a fallback on a primary-only task fails closed. This record never replaces review of the actual diff.

## Security

- No bypass-permissions mode, unrestricted home access, Keychain/cookie extraction, production secrets/data, destructive Git, automatic purchases, or arbitrary external repositories.
- Child processes receive a minimal environment and are tracked by process group.
- Raw logs are private, redacted, bounded, and ignored by Git.
- Integration scans out-of-scope paths, secrets, dependencies/install scripts, shell/network/filesystem expansion, permissions, disabled tests, binaries, and unexpected assets.
- Authentication is manual. Missing auth is an explicit `claude auth login` blocker.

The first live modifying pilot passed on 2026-07-13. Claude Fable 5 (proven from its structured event stream, with no fallback) changed only `scripts/group-ui-helper-tests.mjs` in one isolated commit. Codex inspected the full diff, reran 14/14 helper checks and the production build, cherry-picked the approved commit, reran the integrated test, and removed the clean worktree. The worker branch remains preserved because the integrated cherry-pick has a different commit identity.

Worktree ownership is now durable rather than process-local. The versioned lease store records the exact task, branch, reviewed base, path identity, state, and timestamps with atomic writes. Startup reconciliation accepts only an exact registered Git worktree; an active lease becomes `BLOCKED / ORPHANED_AFTER_RESTART`, a missing or mismatched worktree fails closed, and unknown worktrees are never adopted or deleted. `/api/collaboration` exposes only bounded task summaries, sanitized lease evidence, and validated task-packet creation with explicit mutation intent. It does not authorize dispatch or automatic integration. The Collaboration Center renders this boundary truthfully.

The dispatch contract now reserves overlapping file ownership atomically and joins one task to one sparse worktree, owned process receipt, actual Claude model identity, inspected commit, normalized result, and terminal receipt hash. Modifying worktrees omit `data/`, `logs/`, and `state/`; dirty source changes still block dispatch while explicitly bounded user runtime data may remain untouched in the primary checkout. Live product dispatch is off by default and requires `ACC_ENABLE_FABLE_DISPATCH=1`, the reviewed Claude Code 2.1.207 capability surface, exact mutation/confirmation headers, and the exact current base SHA. Completion never integrates automatically.

Accepted-delivery learning is observation-only. The atomic local metrics store derives timing from durable task receipts, requires explicit integration or rejection evidence, and records escaped defects append-only. Self-entered Codex estimates are planning metadata only and cannot qualify Fable. Eligibility requires twelve dispatched observations, ten accepted, four actual paired Codex controls, at least 80% first-pass acceptance, at least 15% lower median calendar lead, zero boundary violations, and zero attributable S1/S2 defects. Qwen remains a review compressor with no authority. Recommendations remain shadow-only and cannot dispatch, integrate, alter policy, or weaken tests.
