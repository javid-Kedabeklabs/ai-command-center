#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"
STATE="$ROOT/state/collaboration/worker-status.json"
MODE="dry-run"
TASK_ID=""

usage() { printf 'Usage: %s [--dry-run] [--execute --task <task-id>]\n' "$(basename -- "$0")" >&2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --execute) MODE="execute"; shift ;;
    --task) [[ $# -ge 2 ]] || { usage; exit 64; }; TASK_ID="$2"; shift 2 ;;
    *) usage; exit 64 ;;
  esac
done
if [[ -n "$TASK_ID" && ! "$TASK_ID" =~ ^[a-z0-9][a-z0-9-]{1,99}$ ]]; then printf 'Invalid task id.\n' >&2; exit 64; fi
if [[ "$MODE" == execute && -z "$TASK_ID" ]]; then printf 'Execution requires --task with one exact task id.\n' >&2; exit 64; fi
[[ -f "$STATE" && ! -L "$STATE" ]] || { printf 'No safe registered worker state; nothing to clean.\n'; exit 0; }
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { printf 'Refusing: repository is not a Git work tree.\n' >&2; exit 1; }

records="$(node - "$STATE" "$ROOT" "$TASK_ID" <<'NODE'
const fs = require('node:fs')
const [file, root, selected] = process.argv.slice(2)
try {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) process.exit(2)
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (state?.schemaVersion !== 1 || !state.workers || typeof state.workers !== 'object') process.exit(3)
  for (const [key, worker] of Object.entries(state.workers)) {
    const taskId = worker?.taskId || key
    if (selected && taskId !== selected) continue
    const safe = typeof taskId === 'string' && /^[a-z0-9][a-z0-9-]{1,99}$/i.test(taskId)
    if (!safe || worker.repositoryRoot !== root || typeof worker.worktreePath !== 'string') continue
    const fields = [taskId, worker.status || '', worker.pid || '', worker.worktreePath, worker.integrationStatus || '', worker.cleanupStatus || '']
    if (!fields.some(value => String(value).includes('|'))) console.log(fields.join('|'))
  }
} catch { process.exit(4) }
NODE
)" || { printf 'Refusing: registered worker state is malformed.\n' >&2; exit 1; }

if [[ -z "$records" ]]; then printf 'No registered worktrees matched.\n'; exit 0; fi
found=false
while IFS='|' read -r task_id worker_status pid worktree integration_status cleanup_status; do
  [[ -n "$task_id" ]] || continue
  found=true
  reason=""
  case "$worktree" in "$ROOT/.claude/worktrees/"*) ;; *) reason="outside collaboration worktree root" ;; esac
  [[ "$worktree" != "$ROOT" ]] || reason="primary checkout"
  case "$worker_status" in COMPLETED|FAILED|TIMED_OUT|CANCELLED|STOPPED) ;; *) reason="worker is not inactive" ;; esac
  case "$integration_status" in INTEGRATED|REJECTED) ;; *) reason="work is not integrated or explicitly rejected" ;; esac
  [[ "$cleanup_status" != "CLEANED" ]] || reason="already marked cleaned"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then reason="registered worker PID is still active"; fi
  [[ -d "$worktree" && ! -L "$worktree" ]] || reason="worktree path is missing or unsafe"
  registered=false
  if git -C "$ROOT" worktree list --porcelain | awk '$1 == "worktree" {print substr($0,10)}' | grep -Fqx -- "$worktree"; then registered=true; fi
  [[ "$registered" == true ]] || reason="path is not a registered Git worktree"
  if [[ -z "$reason" && -n "$(git -C "$worktree" status --porcelain --untracked-files=all 2>/dev/null)" ]]; then reason="worktree is dirty"; fi
  if [[ -n "$reason" ]]; then printf 'REFUSE %s: %s\n' "$task_id" "$reason"; continue; fi
  if [[ "$MODE" == dry-run ]]; then printf 'DRY-RUN eligible %s: %s\n' "$task_id" "$worktree"; continue; fi
  git -C "$ROOT" worktree remove -- "$worktree"
  printf 'REMOVED %s: %s\n' "$task_id" "$worktree"
done <<<"$records"
[[ "$found" == true ]] || printf 'No registered worktrees matched.\n'
