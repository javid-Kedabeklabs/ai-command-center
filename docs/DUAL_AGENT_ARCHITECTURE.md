# Dual-Agent Architecture Amendment

Status: additive plan amendment; implementation in progress.

## Authority

The user directs Codex. Codex owns the master plan, architecture, sequencing, canonical contracts, migrations, integration, security policy, regression authority, and completion claims. Claude Code is a subordinate bounded implementer or read-only advisor. Temporary Codex unavailability never transfers lead authority.

```text
User
  -> Codex lead and integration gate
       -> bounded Claude worker worktree
       -> read-only Claude reviewer
       -> Codex internal work
       -> deterministic review/test/integration pipeline
```

## Required lifecycle

1. Codex creates a versioned, bounded task packet.
2. The dispatcher validates schema, dependencies, capacity, path scope, and exclusive ownership.
3. A modifying task receives a unique branch and repository-scoped worktree from a reviewed clean base. A review task receives read-only tools.
4. Claude runs with the minimum supported tools, bounded timeout, no production secrets, and no permission bypass.
5. Raw redacted events and a normalized result are retained. Success requires the declared commit and test evidence.
6. Codex verifies task/branch/SHA, all changed paths, secrets, dependencies, shell/network/permission changes, architecture, and tests.
7. Codex selectively integrates or rejects. No branch is blindly merged.
8. Ownership is released and the worktree is cleaned only after an auditable terminal decision.

## Initial limits

- One modifying Claude worker.
- Up to two read-only reviewers, maximum three Claude subprocesses.
- No overlapping ownership.
- No simultaneous schema migrations, lockfile edits, `server/index.js` edits, or `WorkflowStudio.tsx` edits.
- No live Claude/Codex calls in standard automated tests.
- One modifying Claude worker at a time; the first test-only pilot is integrated and verified. Higher-risk modifying classes remain gated on durable ownership/restart recovery and reviewed task-specific bases.

## Capacity and failure

Codex and Claude have independent states: `AVAILABLE`, `RATE_LIMITED`, `USAGE_LIMIT_REACHED`, `AUTH_REQUIRED`, `SERVICE_UNAVAILABLE`, `MODEL_UNAVAILABLE`, or `DISABLED`. Capacity failures preserve the task, use bounded backoff, record requested/actual model and fallback reason, and never purchase credits or rotate identities. Repeated identical failures escalate instead of looping.

## Phased amendment

A. Audit installed CLIs, auth state, repository, flags, processes, and security boundaries.
B. Implement task schema/store, capacity/process state, ownership, result parsing, and audit.
C. Prove a read-only fixture bridge with timeout/cancellation.
D. Prove one low-risk isolated-worktree implementation and Codex-gated integration.
E. Add canonical shared skills and focused Claude subagents.
F. Add collision-tested conservative scheduling.
G. Add Collaboration UI and permission-checked APIs.
H. Connect to the existing supervisor with restart recovery and preserved lead authority.

The complete environment evidence is in `docs/COLLABORATION_AUDIT.md`; operational rules are in `docs/CLAUDE_CODE_INTEGRATION.md` and `docs/MULTI_AGENT_FILE_OWNERSHIP.md`.
