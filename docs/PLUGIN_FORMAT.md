# Plugin Format

Plugin records contain ID, name, version, publisher, description, permissions, dependencies, provenance, signature status, trust status, enabled state, install time, and contributed packages.

Built-in verified entries may enable on install. Imported bundles install as `untrusted`, `unsigned`, and disabled. Explicit review changes trust; only trusted/verified plugins can enable. Runtime checks reject disabled/untrusted contributed nodes.

Portable archive signing and compatibility migrations remain open.

Department packs and plugins may contribute versioned Role Cards, skills, rubrics, permission/model-policy references, knowledge/tool scopes, and workflow templates. They do not normally contribute new agent primitives. Imported role templates remain disabled/reviewable according to the same provenance, compatibility, and trust rules; executable primitive code requires a separate higher-risk review.
