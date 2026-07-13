# Multi-Agent File Ownership

Every active modifying task reserves explicit repository-relative glob patterns. Reservations use stable task IDs, an owner, exclusivity, timestamps, and a base commit. Paths are normalized, traversal and symlink escape are rejected, and overlapping exclusive patterns block dispatch.

Codex may work in parallel only outside the reservation. Shared central files are sequential by default. Package locks, schemas/migrations, `server/index.js`, and `web/src/WorkflowStudio.tsx` are single-owner resources even when a proposed glob appears narrower.

Worker worktrees live under a repository-managed ignored root, have unique branches, and start from a reviewed commit. The dispatcher—not the model—creates and records worktrees. A task cannot succeed with changed paths outside its allowance, a missing commit, a dirty unexplained worktree, or an unexpected base.

Integration is Codex-gated. The safest of selective patching or cherry-picking is chosen after inspection and tests. Ownership is released only after integration, rejection, or documented safe failure. Cleanup never removes an unknown or active worktree.
