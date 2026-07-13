# Target Architecture

The target separates HTTP composition, portable definitions, operational persistence, execution, integrations, governance, and visualization.

1. React surfaces read and patch one canonical workflow API.
2. Schema migration and typed-port validation form the workflow boundary.
3. A durable dependency scheduler persists material transitions, checkpoints, artifacts, and evaluation links.
4. Executors implement isolated, permission-checked capabilities.
5. MCP, triggers, plugins, and custom nodes use registries with trust and provenance.
6. JSON remains the portable interchange format; SQLite becomes the indexed event store only after a tested migration.
7. Company World consumes the operational event projection and cannot mutate hidden parallel state.
8. Product agents resolve through `Agent Primitive -> Role Card -> Agent Instance -> Workflow Assignment`; deterministic workflow/resource/governance services remain outside LLM agents.
9. Engineering delegation is outside the product runtime: Codex leads, Claude Code receives bounded worktree tasks, and no worker result enters the primary branch without ownership, diff, security, and test gates.
10. A local Qwen factory supplies concurrent tool-free advisory workers through one pinned LM Studio allocation. Its results are evidence, never direct instructions or integration authority; any future patch proposal must pass isolated-worktree, deterministic-test, fresh-review, and Codex gates.

Backend extraction follows the order in `docs/MASTER_PLAN.md`; no all-at-once rewrite is authorized.
