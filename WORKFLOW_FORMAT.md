# Workflow Format

Portable workflows are JSON documents with `schemaVersion`, identity and metadata, `nodes`, `edges`, typed ports, variables, secret references, groups, triggers, environments, permissions, evaluations, governance, and runtime settings.

Schema version 2 is current. Legacy documents are migrated additively. Unknown fields are preserved, and documents from unsupported future schema versions are rejected without mutation.

See [docs/WORKFLOW_SCHEMA.md](docs/WORKFLOW_SCHEMA.md) for contracts and migration rules.
