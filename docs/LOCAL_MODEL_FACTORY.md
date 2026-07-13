# Local Model Factory

Status: `IN_PROGRESS` — read-only advisory factory and durable API are implemented; modifying worktree workers are not enabled.

## Purpose

The Local Model Factory uses one pinned LM Studio model, `qwen-coder-factory` (`qwen/qwen3-coder-30b`), for several independent bounded analyses at once. It increases throughput without giving local model output direct authority over repository changes.

Codex remains architecture and integration authority. Claude Fable remains the bounded high-complexity implementation/review worker. Local Qwen workers perform repository audits, implementation proposals, test design, code review, failure analysis, and documentation drafts.

## Current operating profile

- LM Studio loopback endpoint only: `http://127.0.0.1:1234`.
- One persistent shared model allocation: 65,536-token context, four prediction slots, full GPU offload, and no idle TTL.
- Factory tasks are tool-free and read-only.
- Exact repository files are allowlisted per task.
- `.git`, `.env`, credentials, tokens, `data`, `state`, `logs`, `node_modules`, and external paths are rejected.
- Context files must be regular non-symlink UTF-8 files and fit the task byte budget.
- Requests have hard timeouts, output-token limits, and a two-megabyte response ceiling.
- The response model must match the pinned identifier; silent fallback is rejected.
- Results use a strict structured schema and pass through secret redaction. Findings must include category, severity, confidence, supplied file, bounded line range, exact quote, claim, and deterministic validation. Unsupported file/range/quote citations are rejected mechanically and exact duplicates are collapsed before advice reaches a queue.
- Queue concurrency is four, priority is bounded, duplicate task IDs are rejected, and queued/active work can be cancelled.
- Task state is atomically persisted. Orphaned `RUNNING` tasks become `BLOCKED` after restart rather than being replayed silently.

## API

- `GET /api/local-factory/status`
- `GET /api/local-factory/tasks`
- `GET /api/local-factory/tasks/:taskId`
- `POST /api/local-factory/tasks`
- `POST /api/local-factory/tasks/:taskId/cancel`

The write routes validate the strict task packet and emit audit events. They cannot apply code or integrate changes.

The Advanced Tools navigation now includes **Local Worker Factory**, showing the pinned model, active/queued slot use, durable completed/review-needed counts, task states, polling updates, and cancellation for queued or running work. Developer Mode also displays the enforced operating policy.

## Verification evidence

- Deterministic foundation: `node scripts/local-factory-tests.mjs` — 14/14.
- API fixture: `node scripts/local-factory-api-tests.mjs` — 1/1.
- Live opt-in: `CC_LIVE_LOCAL_FACTORY=1 node scripts/local-factory-live-pilot.mjs`.
- Two four-worker live pilots completed in approximately 11.1 and 10.4 seconds.
- The durable pilot processed four independent jobs concurrently and recorded four completed task results.
- After a safe application reload with no active workflows, `localhost:1717/api/local-factory/status` returned HTTP 200, all durable pilot results remained available, a new task dispatched through the live API completed successfully, and the original smoke suite passed 30/30.
- TypeScript, production build, Node syntax, and diff checks passed after API integration.
- The repeatable known-answer benchmark is `node scripts/local-factory-model-benchmark.mjs --concurrency 4 --output <report.json>`. The current 30B baseline produced 100% schema validity, 1.00 precision, 0.60 recall, 0.75 F1, zero false positives, and 11.3-second batch wall time across six cases. Model replacement is prohibited unless an A/B run preserves the security cases and improves the declared gates.

Live results are advisory evidence. The pilot correctly found several useful test ideas, but also produced overstated or incorrect findings—for example, claiming aggregate input size was not bounded when the loader does enforce an aggregate byte ceiling. This proves why same-model output cannot approve itself and deterministic/Codex review gates remain mandatory.

## Promotion path

1. Complete the in-progress Qwen3-Coder-Next A/B download and promote it only if it beats the recorded baseline.
2. Add durable attempt, capacity, and resource telemetry.
3. Expand the implemented status/queue/cancellation UI with task-result inspection and measured model-capacity telemetry.
4. Add one patch-proposal lane that can only produce a validated unified diff.
5. Apply proposals deterministically inside isolated worktrees with exclusive file ownership.
6. Run declared tests, security scans, fresh-session review, and Codex review.
7. Keep final integration explicit; never let a local worker merge or modify production directly.
