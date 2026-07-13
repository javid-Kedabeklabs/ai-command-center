# Next task

Status: READY

Commit and publish the verified additive lifecycle checkpoint, then start the local request-boundary and evidence-redaction slice.

Immediate work:
- Review and stage only lifecycle product, test, and documentation files; exclude runtime/user data.
- Run staged secret scanning and verify the exact commit diff.
- Commit one lifecycle checkpoint and publish a sanitized public review branch with its exact SHA.
- Reload the host service once and rerun the focused live lifecycle/security/smoke gates against the integrated commit.
- Then implement Host/Origin/Fetch-Metadata enforcement and centralized release-visible redaction with deterministic hostile-request and secret-canary tests.

Definition of done: the public review branch points at the verified current infrastructure; no runtime/private files are published; the host runs the committed lifecycle code; request-boundary/redaction tests fail before implementation and pass afterward; all existing focused regressions remain green.
