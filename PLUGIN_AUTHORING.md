# Plugin Authoring

A plugin manifest requires an ID, name, semantic version, publisher/provenance, compatibility, license, permissions, dependencies, contributed packages, documentation, and tests.

Imported plugins are installed disabled with `untrusted` and `unsigned` states. Explicit human review is required before enabling. Disabling a plugin disables its contributed nodes at runtime. Never depend on unrestricted host access.

The portable bundle/export format is still being completed; do not publish incompatible bundles as stable.
