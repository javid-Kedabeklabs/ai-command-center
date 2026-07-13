# Collaboration Environment Audit

Date: 2026-07-13

This is a redacted capability record. Authentication identifiers and credentials are intentionally omitted.

## Verified tools

- Codex: `/opt/homebrew/bin/codex`, version `0.144.1`; `codex exec` supports bounded noninteractive execution, JSONL output, output schemas, and sandbox selection.
- Claude Code: `/Users/kedabektechlabs/.local/bin/claude`, version `2.1.207`; authenticated through a Claude subscription.
- Claude model aliases advertise `fable` / `claude-fable-5`, with `sonnet` fallback support.
- Claude effort values are `low`, `medium`, `high`, `xhigh`, and `max`; `ultracode` is not an installed value.
- Claude supports print mode, structured/stream JSON, JSON Schema, tool allow/deny lists, permission modes, worktrees, and model fallback.
- The installed Claude help does not advertise `--max-turns`, `--append-system-prompt-file`, or `--append-subagent-system-prompt`; outer process timeout/cancellation and composed task prompts must provide those controls.
- Git `2.50.1`, Node `v26.5.0`, and Python `3.9.6` are installed.
- The repository is valid and disk capacity is sufficient for worktrees.

## Safety finding

The primary checkout contains extensive modified and untracked work that is not represented by its current `HEAD`. A modifying worker worktree created from that commit would receive a stale project state. Therefore live modifying Claude dispatch is blocked until Codex establishes and reviews a safe collaboration base. Read-only audit and fixture-based bridge development remain safe.

Existing interactive Codex/Claude processes were observed, so the dispatcher must identify only its own process groups and must not terminate unrelated sessions.

## Invocation policy

Commands are constructed only from detected flags. Arguments are passed as arrays, not through `sh -c`. Logs are mode `0600`, redacted, and excluded from Git. Standard tests use fixture workers; live vendor calls require explicit opt-in.
