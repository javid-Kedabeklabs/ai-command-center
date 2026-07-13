#!/bin/zsh
set -u
umask 077

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

ROOT="${COMMAND_CENTER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PROMPT="$ROOT/scripts/autonomy/worker-prompt.md"
LOG_DIR="$ROOT/logs/autonomy"
STAMP="${AUTONOMY_STAMP:-$(date +%Y%m%d-%H%M%S)}"
EVENTS="${AUTONOMY_EVENTS:-$LOG_DIR/$STAMP-events.jsonl}"
LAST_MESSAGE="${AUTONOMY_LAST_MESSAGE:-$LOG_DIR/$STAMP-last-message.md}"

mkdir -p "$LOG_DIR"
if [[ ! -f "$PROMPT" ]]; then
  print -u2 "Missing worker prompt: $PROMPT"
  exit 66
fi

cd "$ROOT" || exit 66

# Global safety flags precede the exec subcommand because that is the syntax
# advertised by the installed Codex CLI. JSONL preserves structured events.
{
  print "Autonomous iteration ID: ${AUTONOMY_ITERATION_ID:-missing}"
  print "You must include this exact ID in state/last-run-summary.md as: - Iteration ID: ${AUTONOMY_ITERATION_ID:-missing}"
  cat "$PROMPT"
} | codex --ask-for-approval never --sandbox workspace-write -C "$ROOT" exec \
  --json --color never --output-last-message "$LAST_MESSAGE" - \
  > "$EVENTS" 2>&1
