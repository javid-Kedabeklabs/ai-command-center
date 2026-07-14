# Codex–Claude collaboration scripts

These scripts provide read-only diagnostics, redacted status, bounded stop requests, and conservative worktree cleanup. The fixture-verified dispatcher now binds a validated task, sparse sensitive-data-free worktree, owned process, actual model provenance, inspected commit, and terminal receipt. Product dispatch remains off by default and requires host-owner `ACC_ENABLE_FABLE_DISPATCH=1`, explicit mutation intent, exact confirmation, an exact reviewed base SHA, and a queued packet. Integration is never automatic.

## Current CLI facts

The audited installation is Claude Code 2.1.207. Its strongest supported effort is `max`; `ultracode` is not supported. The CLI supports `--model fable`, `--fallback-model`, structured `stream-json`, JSON Schema output, and `--worktree`. It does **not** expose a `--max-turns` command-line flag, so task turn limits must be enforced by supported agent `maxTurns` metadata and the external dispatcher/process timeout. Commands must always be constructed from the installed `claude --help` output rather than copied from a conceptual example.

## Commands

- `npm run collaboration:prepare < task-draft.json > prepared-packet.json` runs only from the canonical repository root. It resolves the exact reviewed commit, rejects dirty source while tolerating excluded runtime data, hashes committed authority and acceptance blobs, completes schema v3, validates it through the same dispatch contract verifier, and emits a deterministic packet plus a nondispatch receipt. It never queues, dispatches, signs, or writes repository state.
- `./scripts/collaboration/claude-doctor.sh` performs a read-only installation, capability, authentication-state, Git, disk, worktree, and process audit. Authentication output is reduced to a boolean, a coarse method, and a coarse subscription class; raw authentication output, account identifiers, and secrets are never printed or stored.
- `./scripts/collaboration/claude-status.sh` defensively reads the three versioned collaboration state files and prints only bounded task, worker, model, capacity, and count fields. It never prints raw logs, prompts, authentication output, or error strings.
- `./scripts/collaboration/claude-stop.sh <task-id>` writes a bounded stop-at-safe-boundary request. Add `--signal` only for an emergency stop; the script refuses unless the registered active worker, repository, task-named worktree, Claude PID, process CWD, and optional owned process group all match.
- `./scripts/collaboration/cleanup-worktrees.sh` defaults to dry-run. It considers only registered, inactive, clean Git worktrees under `.claude/worktrees/` whose work is recorded as `INTEGRATED` or `REJECTED`. Actual removal requires `--execute --task <exact-task-id>`. Primary, unknown, dirty, active, and unintegrated worktrees are refused.

## Live opt-in and safe base gate

Live execution remains separately and explicitly opted in; fixture tests and ordinary application startup never consume Claude or Codex usage. Before any live task, Codex approves a persisted bounded task packet, confirms authentication and model availability, supplies the exact current reviewed base commit, reserves non-overlapping file ownership, and retains the integration gate. Dirty source files are refused; explicitly bounded `data/**` runtime changes may coexist because the sparse worker checkout excludes `data/`, `logs/`, and `state/` entirely.

The first live pilot must remain low risk and require one isolated commit. No live worker may edit the primary checkout, use bypass permissions, access secrets or production data, start with unresolved shared-file ownership, or integrate without Codex diff review and deterministic tests.

## Safety notes

Run these scripts from any directory; each resolves the repository relative to its own location. Do not place tokens or subscription credentials in repository state. `claude auth login` remains an interactive user action. Cleanup never uses `git clean`, force removal, or branch deletion, and it does not update state automatically; a future audited integration manager must record cleanup completion after successful removal.
