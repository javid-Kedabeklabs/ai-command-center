# Next task

Status: READY

Portfolio order: `docs/PORTFOLIO_PRIORITY_PLAN.md`.

Implement precise exactly-once-or-stop side-effect reconciliation on top of checkpoint schema v2.

Immediate work:
- Extend the implemented HTTP/file-write effect phases to MCP, subworkflows, triggers, and model/tool boundaries.
- Add trusted MCP tool classifications and authoritative reconciliation receipts rather than trusting descriptive annotations.
- Add provider-specific HTTP reconciliation only where an audited idempotency or status contract exists.
- Preserve the current conservative rule: an unsafe node killed without authoritative dispatch evidence stops in `needs_review`.

Definition of done: every effect is proven absent, deduplicated by a stable operation key, confirmed by an authoritative receipt, or durably stopped in `needs_review`; no ambiguous effect is blindly retried; deterministic crash tests and existing regressions stay green.
