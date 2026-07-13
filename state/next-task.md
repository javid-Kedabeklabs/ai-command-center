# Next task

Status: READY

Commit, publish, and host-verify deny-wins environment permission ceilings and symlink-safe filesystem access, then implement per-node durable recovery and side-effect reconciliation.

Immediate work:
- Review and stage only permission/filesystem product, tests, and documentation; exclude runtime/user data.
- Run broad isolated regression, staged secret scan, and exact diff review.
- Commit one security checkpoint, refresh the squashed sanitized public review branch, then reload and verify the host once.
- Define a versioned per-node checkpoint/attempt state machine with explicit ambiguous side-effect recovery.
- Add crash-boundary tests for parallel branches before replacing the legacy topological-prefix recovery model.

Definition of done: Testing/Production cannot acquire an unreviewed capability; explicit exact grants work; custom/plugin/child policy cannot escalate; run/artifact/AgentBrain filesystem symlink escapes fail closed; regressions stay green; public and host checkpoints match the committed source. The following slice must prove that completed parallel nodes are neither skipped nor repeated across every modeled crash boundary.
