# AI Command Center — Current Public Review Snapshot

This branch is a sanitized source snapshot for independent review.

- Local source checkpoint: `2740893e458162d9b5189f59a697fd11748191cc` (`feat(collaboration): expose open question ledger`).
- Runtime data, audit logs, profiles, generated stores, credentials, local models, and user content are excluded.
- The authoritative release contract is `npm run verify:release` (34 gates, including the contract-freeze and open-question-ledger gates plus twelve live browser journeys). Receipt: `bfe246bfde0527befff830130170d2f306d084388c348fc1afb8788aec78f489`.
- Host reload receipt: `2a4499922a683c9227204d9ad690b2b8efb3cc01bc601f008dc71fd447754f13`.
- Fable dispatch remains host-owner opt-in and integration remains separate. New packets freeze their reviewed base, acceptance-test ancestry, contract-file hashes, scenarios, file budget, baseline, and stop conditions. Four terminal v1 records remain immutable historical evidence; zero requeueable packets require upgrade. The read-only question API reports four open and two closed evidence-tracked questions. Delivery metrics are observation-only, shadow recommendations with no automatic authority.
- The package remains `UNLICENSED`; this is a source-available review snapshot, not an open-source release.
- Treat `docs/COMPLETION_AUDIT.md`, `docs/IMPLEMENTATION_STATUS.md`, and current source/tests as authoritative rather than older review commits.

Review branch: `review/current-20260713`.
