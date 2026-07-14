# Plugin Format

Plugin records contain ID, name, version, publisher, description, permissions, dependencies, provenance, signature status, trust status, enabled state, install time, and contributed packages.

Portable packages use `{ schemaVersion: 1, kind: "ai-command-center/plugin", manifestHash, plugin }`. Compatibility declares an inclusive minimum and optional exclusive maximum Command Center semantic version. Optional Ed25519 signatures cover the exact canonical manifest hash and prove package integrity plus a public-key fingerprint; they do not establish publisher trust by themselves. Imported packages remain disabled and untrusted until an exact manifest-bound human review.

Built-in verified entries may enable on install. Imported bundles install as `untrusted`, `unsigned`, and disabled. Explicit review changes trust; only trusted/verified plugins can enable. Runtime checks reject disabled/untrusted contributed nodes.

The Extensions UI imports and exports portable JSON and runs fail-closed package checks for manifest integrity, compatibility, unique node identities, supported adapters, and deterministic fixture declarations. Export omits local trust decisions, review receipts, enablement, and installation timestamps so authority is never transferred with a package.

Portable archive signing and compatibility migrations remain open.

Department packs and plugins may contribute versioned Role Cards, skills, rubrics, permission/model-policy references, knowledge/tool scopes, and workflow templates. They do not normally contribute new agent primitives. Imported role templates remain disabled/reviewable according to the same provenance, compatibility, and trust rules; executable primitive code requires a separate higher-risk review.
