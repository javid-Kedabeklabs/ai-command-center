# Next task

Status: READY

Portfolio order: `docs/PORTFOLIO_PRIORITY_PLAN.md`.

Complete the hermetic release journey and safe evidence boundary on top of durable checkpoint/control/effect receipts.

Immediate work:
- Extend the multi-crash journey through trigger delivery and redacted evidence export.
- Update browser state to render durable approval/manual-pause records instead of inferring authority only from event text.
- Define a safe browser/evidence DTO and prove secret canaries are absent from runs, checkpoints, audit, exports, API responses, and browser-visible evidence.
- Wire the complete deterministic journey into the ordinary verification command instead of relying on standalone scripts.

Definition of done: the browser/API journey proves immutable build/save, parallel recovery, exactly-once-or-stop effects, durable approval, explicit pause, persisted trigger delivery, restart, completion, and redacted linked evidence with deterministic crash points and green regressions.
