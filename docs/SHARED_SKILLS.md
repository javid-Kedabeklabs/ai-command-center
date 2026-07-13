# Shared Skills

The canonical project-owned source is `.agent-skills/<name>/SKILL.md` with optional `references/`, `scripts/`, and `tests/`. Vendor-specific discovery paths are adapters, not separately edited copies.

Synchronization must support dry-run, validation, displayed diffs, conflict refusal, and rollback. It must never overwrite local modifications silently. Initial skill packages are added incrementally only when their complete instructions, permitted/prohibited actions, outputs, verification, and failure behavior can be tested.

The first canonical package is `.agent-skills/git-worktree-collaboration`. It defines bounded ownership, worktree, worker-commit, review, integration, cleanup, and failure behavior. The skill was initialized with the provided skill-creator tooling. Its official Python validator could not run because optional `PyYAML` is absent; equivalent Ruby YAML/frontmatter and directory checks passed without installing a new dependency. Vendor adapters are not yet applied pending the conflict-safe synchronization script.
