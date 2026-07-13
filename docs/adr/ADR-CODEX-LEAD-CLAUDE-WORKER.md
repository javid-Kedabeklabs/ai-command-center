# ADR: Codex Lead, Claude Worker

Status: accepted as an additive execution amendment, 2026-07-13.

## Decision

Codex remains the authoritative architect and integrator. Claude Code operates as a bounded implementation worker or read-only reviewer in isolated worktrees with exclusive file ownership and structured results. Every integration requires Codex diff review and deterministic tests.

## Rationale and consequences

Independent specialization can reduce elapsed time, particularly for UI and review, but two uncontrolled writers increase conflict and security risk. Worktree isolation, task packets, ownership, and gated integration preserve a single architecture. Vendor subscriptions and capacity are independent and are not pooled or bypassed. Structured results improve automation but never replace source review. Conservative modifying concurrency trades theoretical throughput for reproducibility and may expand only after collision/recovery evidence. The same runner interface can later support additional coding agents without transferring lead authority.
