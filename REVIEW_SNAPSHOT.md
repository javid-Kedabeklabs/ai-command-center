# AI Command Center — Current Public Review Snapshot

This branch is a sanitized source snapshot for independent review.

- Local source checkpoint: `eb5ed956a776534717433aaac41a37afdc01bb1a` (`feat: prepare authority-complete task packets`).
- Runtime data, audit logs, profiles, generated stores, credentials, local models, and user content are excluded.
- The authoritative release contract is `npm run verify:release` (35 gates, including deterministic packet preparation, authority-complete collaboration contracts, measured-control metrics, the question ledger, and twelve live browser journeys). Receipt: `70b5ddce3e1e051acaa279a7b986ec8fc9fa4591b3ebc9e2a5777b9c10db75cf`.
- Host reload receipt: `9fd602fe6e2d218c7294535ed4651f5cb08010488f34b3d16bcd0c95febb5d9b`.
- Fable dispatch remains host-owner opt-in and integration remains separate. New schema-v3 packets bind every authority category or mark it forbidden, bind every scenario to hashed acceptance evidence, and emit explicitly unsigned content-addressed dispatch evidence. Four terminal v1 records remain immutable history; zero requeueable packets require upgrade. The read-only question API reports six open and two closed evidence-tracked questions. Planning estimates cannot qualify Fable; actual recorded paired Codex controls are required. All routing recommendations remain shadow-only.
- Packet hashes are generated from exact reviewed Git blobs by a read-only CLI; manual hash entry, dirty source, stale bases, and missing authority fail closed. This CLI-only addition did not require a service reload, so the preceding verified host receipt remains the current runtime evidence.
- The package remains `UNLICENSED`; this is a source-available review snapshot, not an open-source release.
- Treat `docs/COMPLETION_AUDIT.md`, `docs/IMPLEMENTATION_STATUS.md`, and current source/tests as authoritative rather than older review commits.

Review branch: `review/current-20260713`.
