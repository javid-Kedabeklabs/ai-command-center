# Next task

Status: READY

Portfolio order: `docs/PORTFOLIO_PRIORITY_PLAN.md`.

Implement precise exactly-once-or-stop side-effect reconciliation on top of checkpoint schema v2.

Immediate work:
- Route HTTP and file-write nodes through stable logical operation keys and prepared/inflight/confirmed/ambiguous phases.
- Add authoritative file hash receipts and HTTP idempotency/reconciliation contracts before broadening automatic recovery.
- Extend the same adapter contract to MCP, subworkflows, triggers, and model/tool boundaries.
- Preserve the current conservative rule: an unsafe node killed without authoritative dispatch evidence stops in `needs_review`.

Definition of done: every effect is proven absent, deduplicated by a stable operation key, confirmed by an authoritative receipt, or durably stopped in `needs_review`; no ambiguous effect is blindly retried; deterministic crash tests and existing regressions stay green.
