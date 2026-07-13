# Release Process

AI Command Center is not release-ready until the acceptance checklist in `docs/MASTER_PLAN.md` passes. A release requires a clean migration rehearsal on copied data, backup/restore verification, full regression and security suites, accessibility and performance evidence, synchronized documentation, dependency/license review, and an explicit list of deferred features.

Executable imported packages must remain disabled pending review. Tag only a verified commit, publish checksums and compatibility information, and document rollback.

Release artifacts must pass `npm run verify:release`. The gate verifies runtime recovery, safe evidence, authoritative backup/restore, sanitized package contents, clean packaged installation, CycloneDX SBOM generation, production dependency license/vulnerability review, versioned upgrade/rollback, TypeScript, production build, and the live browser contract.

The project package currently declares `UNLICENSED`. A public source snapshot may be reviewed, but it must not be described as open source or published as an open-source release until the owner selects a license and the exact license text and package metadata are committed.
