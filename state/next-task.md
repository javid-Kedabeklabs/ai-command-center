# Next task

Status: READY

Finalize the current local-first v1 candidate without changing or staging user-owned runtime data.

Immediate work:

- Commit the reconciled observed-behavior documentation and truthful unavailable controls.
- Build and publish a sanitized `review/current-20260713` snapshot from that exact commit; verify unauthenticated Git access and package exclusions.
- Reload the product LaunchAgent from the committed local source and verify repository identity, localhost health, hostile-request rejection, and a disposable workflow journey.
- Ask the owner to select a project license. Until then retain `UNLICENSED` and describe the public branch as a source-available review snapshot, never an open-source release.

After v1 finalization, continue only explicitly active roadmap amendments: Agent Primitive persistence/runtime/UI migration, collaboration leases/UI, measured local-model A/B/routing, and broader Continuous Evolution. Optional embeddings, SQLite, extra models, marketplace breadth, long-document workflows, and 3D remain dependency-gated or deferred.

Definition of done: documentation matches observed behavior; current sanitized public snapshot and current host are independently verified; all 26 release gates pass from the exact committed source; owner-selected license text and metadata are committed before any open-source claim.
