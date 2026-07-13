---
name: git-worktree-collaboration
description: Safely delegate or review bounded repository implementation tasks using exclusive file ownership, isolated Git worktrees, worker commits, deterministic tests, and a lead-controlled integration gate. Use when multiple coding agents could work independently, when assigning a task to Claude Code or another external worker, or when inspecting and integrating a worker branch without risking the primary checkout.
---

# Git Worktree Collaboration

Treat the lead agent's validated task packet as authoritative. Keep architecture and final integration with the lead.

## Procedure

1. Inspect Git status, the intended base commit, active worktrees, and active file reservations.
2. Refuse modifying delegation when the intended project state is not represented by a reviewed base commit.
3. Bound the objective, acceptance criteria, allowed/forbidden paths, context files, tests, timeout, model/fallback, network policy, and commit requirement.
4. Reject overlapping modifying ownership, schema/lockfile concurrency, and unexplained shared-file edits.
5. Let the dispatcher create a unique repository-scoped branch and worktree. Never let the worker edit the primary checkout.
6. Give the worker minimum tools and no secrets, production data, permission bypass, destructive Git, or unrestricted network/home access.
7. Require one task-scoped commit and a structured result containing changed files, tests, risks, assumptions, and integration recommendation.
8. Inspect the actual base, branch, commit, diff, allowed paths, secrets, dependencies, shell/network/permission changes, and tests. Do not trust prose alone.
9. Integrate selectively only after explicit lead approval and clean focused/regression gates. Preserve evidence until the decision is final.
10. Clean only a registered inactive worktree that is clean or explicitly rejected; never remove unknown or unintegrated work.

## Prohibited actions

- Do not run two modifying workers on overlapping files.
- Do not use `reset --hard`, forced cleanup, force push, permission bypass, simulated authentication, account rotation, or automatic purchases.
- Do not automatically merge or transfer lead authority after a worker succeeds.
- Do not hide model fallback, failed tests, out-of-scope edits, conflicts, or capacity errors.

## Expected output

Return the task/worker identity, base and commit SHA, owned and changed paths, exact test evidence, security/integration findings, unresolved risks, and one of: integrate, request changes, discard, or require a human decision.

## Failure behavior

Fail closed on a dirty/stale base, ownership overlap, unknown worktree, missing commit, scope escape, secret/dependency surprise, corrupt state, failed required test, or ambiguous integration. Preserve the task and evidence; do not improvise a destructive recovery.
