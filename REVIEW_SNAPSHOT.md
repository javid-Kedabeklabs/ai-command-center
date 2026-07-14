# AI Command Center — Current Public Review Snapshot

This branch is a sanitized source snapshot for independent review.

- Local source checkpoint: `9c64beee7a94a3c60207bc9e9ea3c725c539b23d` (`feat(collaboration): freeze worker task contracts`).
- Runtime data, audit logs, profiles, generated stores, credentials, local models, and user content are excluded.
- The authoritative release contract is `npm run verify:release` (34 gates, including the contract-freeze and open-question-ledger gates plus twelve live browser journeys). Receipt: `1969a821ce9d91d75c62077d21c57415101da40eddaa2b9aae73938bbc104b4a`.
- Host reload receipt: `bd359c51ebc9bd6915b104a6600be33ab3cb053f76f352444890a605b836d9bd`.
- Fable dispatch remains host-owner opt-in and integration remains separate. New packets freeze their reviewed base, acceptance-test ancestry, contract-file hashes, scenarios, file budget, baseline, and stop conditions. Delivery metrics are observation-only, shadow recommendations with no automatic authority.
- The package remains `UNLICENSED`; this is a source-available review snapshot, not an open-source release.
- Treat `docs/COMPLETION_AUDIT.md`, `docs/IMPLEMENTATION_STATUS.md`, and current source/tests as authoritative rather than older review commits.

Review branch: `review/current-20260713`.
