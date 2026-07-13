# Next task

Status: READY

Portfolio order: `docs/PORTFOLIO_PRIORITY_PLAN.md`.

Complete the live-backed product journey on top of the required release verification and safe evidence boundary.

Immediate work:
- Add a Playwright journey that builds, validates, saves, runs, durably approves, resumes, and inspects safe evidence against the live backend.
- Surface linked safe evidence in Run Center without exposing raw checkpoint objects or run directories.
- Continue the governance/evaluation/plugin lifecycle against exact workflow-version and evidence receipts.
- Start packaging inventory and backup/restore receipt verification using the authoritative stores covered by `npm test`.

Definition of done: the browser/API journey proves immutable build/save, parallel recovery, exactly-once-or-stop effects, durable approval, explicit pause, persisted trigger delivery, restart, completion, and redacted linked evidence with deterministic crash points and green regressions.
