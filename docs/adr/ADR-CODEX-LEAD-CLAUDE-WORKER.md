# ADR: Codex Lead, Claude Worker

Status: accepted as an additive execution amendment, 2026-07-13.

## Decision

Codex remains the authoritative architect and integrator. Claude Code operates as a bounded implementation worker or read-only reviewer in isolated worktrees with exclusive file ownership and structured results. Every integration requires Codex diff review and deterministic tests.

## Rationale and consequences

Independent specialization can reduce elapsed time, particularly for UI and review, but two uncontrolled writers increase conflict and security risk. Worktree isolation, task packets, ownership, and gated integration preserve a single architecture. Vendor subscriptions and capacity are independent and are not pooled or bypassed. Structured results improve automation but never replace source review. Conservative modifying concurrency trades theoretical throughput for reproducibility and may expand only after collision/recovery evidence. The same runner interface can later support additional coding agents without transferring lead authority.

## Implemented evidence

Task packets, ownership conflict detection, result/model provenance, capacity handling, atomic task persistence, owned-process cancellation, isolated worktree inspection, and explicit integration are deterministic modules. Worktree leases persist atomically and reconcile fail-closed after restart; unknown, dirty, mismatched, and unintegrated work is preserved for review. The local Collaboration API validates and stores packets; live dispatch remains disabled unless the host owner explicitly enables it, while automatic integration is always disabled. The standard release verifier uses fixtures only and consumes no Claude capacity.

The additive dispatcher receipt binds task, atomic file reservation, sensitive-data-free sparse worktree, owned process, actual model provenance, inspected commit, and normalized terminal result. Live dispatch is a separate host-owner opt-in and integration remains a separate Codex decision. This makes Fable usable without turning it into a second architect or granting ambient repository/data authority.
