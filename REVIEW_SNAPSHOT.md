# AI Command Center — Current Public Review Snapshot

This branch is a sanitized source snapshot for independent review.

- Local source checkpoint: `aca90392868ab9e0f42d04045b413b9600c57a1a` (`fix(collaboration): preserve terminal legacy evidence`).
- Runtime data, audit logs, profiles, generated stores, credentials, local models, and user content are excluded.
- The authoritative release contract is `npm run verify:release` (34 gates, including the contract-freeze and open-question-ledger gates plus twelve live browser journeys). Receipt: `4e2c33bd4c912a037dc49c2f402e3695b0d0ac23cad54ca25e12a979b621e741`.
- Host reload receipt: `968b919ed55e0d201a597b7b5469d595ffceae0ef12a881550c6a2d480117517`.
- Fable dispatch remains host-owner opt-in and integration remains separate. New packets freeze their reviewed base, acceptance-test ancestry, contract-file hashes, scenarios, file budget, baseline, and stop conditions. Four terminal v1 records remain immutable historical evidence; zero requeueable packets require upgrade. Delivery metrics are observation-only, shadow recommendations with no automatic authority.
- The package remains `UNLICENSED`; this is a source-available review snapshot, not an open-source release.
- Treat `docs/COMPLETION_AUDIT.md`, `docs/IMPLEMENTATION_STATUS.md`, and current source/tests as authoritative rather than older review commits.

Review branch: `review/current-20260713`.
