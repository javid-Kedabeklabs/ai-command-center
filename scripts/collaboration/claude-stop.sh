#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"
STATE_ROOT="$ROOT/state/collaboration"
WORKER_STATE="$STATE_ROOT/worker-status.json"

usage() { printf 'Usage: %s <task-id> [--signal]\n' "$(basename -- "$0")" >&2; }
[[ $# -ge 1 && $# -le 2 ]] || { usage; exit 64; }
TASK_ID="$1"
[[ "$TASK_ID" =~ ^[a-z0-9][a-z0-9-]{1,99}$ ]] || { printf 'Refusing invalid task id.\n' >&2; exit 64; }
MODE="request"
if [[ $# -eq 2 ]]; then [[ "$2" == "--signal" ]] || { usage; exit 64; }; MODE="signal"; fi

REQUEST_DIR="$STATE_ROOT/stop-requests"
mkdir -p -- "$REQUEST_DIR"
REQUEST_FILE="$REQUEST_DIR/$TASK_ID.json"
TEMP_FILE="$REQUEST_DIR/.$TASK_ID.$$.tmp"
trap 'rm -f -- "$TEMP_FILE"' EXIT
umask 077
export STOP_TASK_ID="$TASK_ID" STOP_REQUESTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node >"$TEMP_FILE" <<'NODE'
console.log(JSON.stringify({ schemaVersion: 1, taskId: process.env.STOP_TASK_ID, action: 'STOP_AT_SAFE_BOUNDARY', requestedAt: process.env.STOP_REQUESTED_AT }, null, 2))
NODE
mv -f -- "$TEMP_FILE" "$REQUEST_FILE"
printf 'Stop requested for task %s at the next safe boundary.\n' "$TASK_ID"
[[ "$MODE" == "signal" ]] || exit 0

[[ -f "$WORKER_STATE" && ! -L "$WORKER_STATE" ]] || { printf 'Refusing signal: registered worker state is unavailable.\n' >&2; exit 1; }
record="$(node - "$WORKER_STATE" "$TASK_ID" "$ROOT" <<'NODE'
const fs = require('node:fs')
const [file, taskId, root] = process.argv.slice(2)
try {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (state?.schemaVersion !== 1 || !state.workers || typeof state.workers !== 'object') process.exit(2)
  const worker = state.workers[taskId] || Object.values(state.workers).find(item => item?.taskId === taskId)
  if (!worker || !['STARTING', 'RUNNING', 'STOP_REQUESTED'].includes(worker.status)) process.exit(3)
  const fields = [worker.taskId, worker.pid, worker.pgid || '', worker.repositoryRoot, worker.worktreePath, worker.processGroupOwned === true ? 'true' : 'false']
  if (fields.some(value => String(value).includes('|'))) process.exit(4)
  if (worker.repositoryRoot !== root || !Number.isInteger(Number(worker.pid)) || Number(worker.pid) < 2) process.exit(5)
  process.stdout.write(fields.join('|'))
} catch { process.exit(6) }
NODE
)" || { printf 'Refusing signal: no matching active registered worker.\n' >&2; exit 1; }
IFS='|' read -r registered_task pid pgid registered_root worktree group_owned <<<"$record"
[[ "$registered_task" == "$TASK_ID" && "$registered_root" == "$ROOT" ]] || { printf 'Refusing signal: repository or task identity mismatch.\n' >&2; exit 1; }
case "$worktree" in "$ROOT/.claude/worktrees/"*) ;; *) printf 'Refusing signal: worktree is outside the registered collaboration area.\n' >&2; exit 1 ;; esac
[[ "$(basename -- "$worktree")" == *"$TASK_ID"* ]] || { printf 'Refusing signal: worktree does not identify the task.\n' >&2; exit 1; }
kill -0 "$pid" 2>/dev/null || { printf 'Refusing signal: registered PID is not active.\n' >&2; exit 1; }
comm="$(ps -o comm= -p "$pid" 2>/dev/null | awk '{$1=$1; print}' || true)"
[[ "$(basename -- "$comm")" == "claude" ]] || { printf 'Refusing signal: PID is not a Claude process.\n' >&2; exit 1; }
command -v lsof >/dev/null 2>&1 || { printf 'Refusing signal: lsof is required for process CWD verification.\n' >&2; exit 1; }
process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | awk 'substr($0,1,1)=="n" {print substr($0,2); exit}' || true)"
[[ "$process_cwd" == "$worktree" ]] || { printf 'Refusing signal: process CWD does not match the registered worktree.\n' >&2; exit 1; }

if [[ "$group_owned" == true ]]; then
  actual_pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | awk '{$1=$1; print}' || true)"
  [[ "$pgid" =~ ^[0-9]+$ && "$actual_pgid" == "$pgid" && "$pgid" == "$pid" ]] || { printf 'Refusing signal: process-group ownership could not be verified.\n' >&2; exit 1; }
  kill -TERM -- "-$pgid"
  printf 'Sent TERM to verified worker process group %s for task %s.\n' "$pgid" "$TASK_ID"
else
  kill -TERM "$pid"
  printf 'Sent TERM to verified worker PID %s for task %s.\n' "$pid" "$TASK_ID"
fi
