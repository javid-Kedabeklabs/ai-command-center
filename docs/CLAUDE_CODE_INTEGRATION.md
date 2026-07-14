# Claude Code Integration

Claude Code is invoked only by the collaboration dispatcher for a validated task packet. The dispatcher uses the installed CLI help as its capability source and never assumes flags from another release.

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
