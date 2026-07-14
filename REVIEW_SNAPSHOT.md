# AI Command Center — Current Public Review Snapshot

This branch is a sanitized source snapshot for independent review.

- Local source checkpoint: `afb8ff9dbbc4e0f37e378b8d8cb65f0e7eb9b07e` (`Record Fable dispatch host evidence`), including dispatcher implementation commit `c71819825644745d2142e3cfba625d6dd3808fa0`.
- Runtime data, audit logs, profiles, generated stores, credentials, local models, and user content are excluded.
- The authoritative release contract is `npm run verify:release` (31 gates, including twelve live browser journeys). Receipt: `0918dac2aca2f341475ee35acfb16bfdd7b6b8f5830de8705e644d3e3bd860b4`.
- Host reload receipt: `9eda563b6a20f380ff0df45880b7fec8f5ffd1fd8b06b0a9e4cf3d46452c2524`.
- Provenance-bound Fable dispatch is implemented but remains host-owner opt-in; automatic integration is always disabled.
- The package remains `UNLICENSED`; this is a source-available review snapshot, not an open-source release.
- Treat `docs/COMPLETION_AUDIT.md`, `docs/IMPLEMENTATION_STATUS.md`, and current source/tests as authoritative rather than older review commits.

Review branch: `review/current-20260713`.
