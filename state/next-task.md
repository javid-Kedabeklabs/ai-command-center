# Next task

Status: READY

Portfolio order: `docs/PORTFOLIO_PRIORITY_PLAN.md`.

Complete the hermetic release journey and remaining effect adapters on top of durable checkpoint/control state.

Immediate work:
- Add stable parent-operation dispatch and authoritative child-run receipts for subworkflows.
- Link existing trigger delivery idempotency receipts into workflow checkpoint/evidence state.
- Extend the multi-crash journey through trigger delivery and redacted evidence export.
- Update browser state to render durable approval/manual-pause records instead of inferring authority only from event text.

Definition of done: the browser/API journey proves immutable build/save, parallel recovery, exactly-once-or-stop effects, durable approval, explicit pause, persisted trigger delivery, restart, completion, and redacted linked evidence with deterministic crash points and green regressions.
