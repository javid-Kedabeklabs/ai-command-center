# AI Command Center — Current Public Review Snapshot

This branch is a sanitized source snapshot for independent AI review.

- Local source checkpoint: `ba80767` (`Add versioned install and rollback lifecycle`).
- Runtime data, audit logs, profiles, generated stores, credentials, local models, and user content are excluded.
- This checkpoint adds authoritative backup/restore receipts, sanitized package-content enforcement, CycloneDX SBOM and vulnerability gates, clean packaged-install verification, immutable release activation, receipt-bound rollback, and a generated product LaunchAgent.
- Treat `docs/IMPLEMENTATION_STATUS.md`, `HANDOFF.md`, and the current source/tests as authoritative; do not rely on older review commit `ad82a1a`.

Review branch: `review/current-20260713`.
