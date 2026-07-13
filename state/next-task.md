# Next task

Status: READY

Implement per-node durable recovery and exactly-once-or-stop side-effect reconciliation.

Immediate work:
- Define a versioned per-node checkpoint/attempt state machine with explicit ambiguous side-effect recovery.
- Characterize the legacy topological-prefix behavior and add a pure transition/recovery reducer before changing the live route.
- Add crash-boundary tests for parallel branches before replacing the legacy topological-prefix recovery model.
- Route effectful node classes through stable logical operation keys and prepared/inflight/confirmed/ambiguous phases.

Definition of done: a versioned snapshot records actual per-node state and fenced attempts; completed parallel nodes are neither skipped nor repeated across every modeled crash boundary; confirmed effects finalize without reissue; ambiguous effects durably stop in `needs_review`; existing historical run records remain readable; regressions stay green.
