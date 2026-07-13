# Next task

Status: READY

Commit, publish, and host-verify the local request-boundary and evidence-redaction slice, then implement deny-wins permission ceilings and symlink-safe filesystem access.

Immediate work:
- Review and stage only request-guard/redaction product, tests, and documentation; exclude runtime/user data.
- Run the 30-repeat browser gate, staged secret scan, and exact diff review.
- Commit one security checkpoint, refresh the squashed sanitized public review branch, then reload and verify the host once.
- Define environment -> workflow -> node -> agent/plugin/subworkflow deny-wins capability composition.
- Replace lexical filesystem containment in core run/artifact adapters with symlink-aware resolution and deterministic escape tests.

Definition of done: hostile browser/local requests fail before routing; legitimate UI/CLI/internal trigger traffic remains green; exact resolved secret canaries are absent from persisted and release-visible evidence; public and host checkpoints match the committed source; permission escalation and symlink escape tests fail before the next implementation and pass afterward.
