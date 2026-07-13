# Contributing

Thank you for improving AI Command Center. Begin with `DEVELOPMENT.md`, inspect the dirty worktree before editing, and keep changes bounded and reversible.

Requirements:

- Never commit secrets, credentials, generated run data, or private vault content.
- Add tests for runtime behavior and failure behavior, not only rendered controls.
- Label catalog-only capabilities honestly.
- Preserve unknown workflow fields and provide migrations for schema changes.
- Keep imported executable packages disabled until reviewed.
- Run type checking, the production build, focused tests, and `scripts/smoke.sh` before submitting.

Describe security impact, migrations, rollback, verification evidence, and any remaining limitations in each change.
