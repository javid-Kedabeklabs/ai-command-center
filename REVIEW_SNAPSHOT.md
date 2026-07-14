# AI Command Center — Current Public Review Snapshot

This branch is a sanitized source snapshot for independent review.

- Local source checkpoint: `3faab7879f776e01a16b877c02025516aa4e7f8e` (`Record accepted-cycle host evidence`), including metrics implementation commit `274a0418fb779d5ac37806069001d9d2fdc969e4`.
- Runtime data, audit logs, profiles, generated stores, credentials, local models, and user content are excluded.
- The authoritative release contract is `npm run verify:release` (32 gates, including twelve live browser journeys). Receipt: `fc5df2008429e49e7321bd27502418be848d82d52d3238d43811a1f66224a51d`.
- Host reload receipt: `40ea952ffdd6020a3da46dea4d2f6f5326279a4e30cec639657201bbecaec2f9`.
- Fable dispatch remains host-owner opt-in and integration remains separate. Delivery metrics are observation-only, shadow recommendations with no automatic authority.
- The package remains `UNLICENSED`; this is a source-available review snapshot, not an open-source release.
- Treat `docs/COMPLETION_AUDIT.md`, `docs/IMPLEMENTATION_STATUS.md`, and current source/tests as authoritative rather than older review commits.

Review branch: `review/current-20260713`.
