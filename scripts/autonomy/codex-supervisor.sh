#!/bin/zsh
set -u
umask 077

# launchd supplies only the system PATH. Include standard Homebrew locations so
# the same checked CLI binaries are found in interactive and unattended runs.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

ROOT="${COMMAND_CENTER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATE="$ROOT/state/autonomy-state.json"
STOP_FILE="$ROOT/state/autonomy.stop"
ENABLED_FILE="$ROOT/state/autonomy.enabled"
LOCK_DIR="$ROOT/state/.autonomy-lock"
LOG_DIR="$ROOT/logs/autonomy"
WORKER="${AUTONOMY_WORKER:-$ROOT/scripts/autonomy/codex-worker.sh}"
BOUNDED_RUNNER="$ROOT/scripts/autonomy/run-bounded-worker.mjs"
CONTROL_STATE="$ROOT/scripts/autonomy/control-state.mjs"
HOST_OPERATION="$ROOT/scripts/autonomy/host-operation.mjs"
CODEX_BIN="${AUTONOMY_CODEX_BIN:-$(command -v codex 2>/dev/null || true)}"
MAX_ITERATIONS="${AUTONOMY_MAX_ITERATIONS:-1000}"
MIN_FREE_KB="${AUTONOMY_MIN_FREE_KB:-10485760}"
BACKOFF_BASE="${AUTONOMY_BACKOFF_BASE_SECONDS:-60}"
BACKOFF_CAP="${AUTONOMY_BACKOFF_CAP_SECONDS:-3600}"
REPAIR_DELAY="${AUTONOMY_REPAIR_DELAY_SECONDS:-15}"
WORKER_TIMEOUT="${AUTONOMY_WORKER_TIMEOUT_SECONDS:-3600}"
WORKER_GRACE="${AUTONOMY_WORKER_GRACE_SECONDS:-10}"
WAIT_POLL="${AUTONOMY_WAIT_POLL_SECONDS:-5}"
MAX_LOG_FILES="${AUTONOMY_MAX_LOG_FILES:-240}"

mkdir -p "$ROOT/state" "$LOG_DIR"

if [[ -d "$LOCK_DIR" ]]; then
  stale_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$stale_pid" ]] && ! kill -0 "$stale_pid" 2>/dev/null; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -u2 "Autonomy supervisor is already running or a stale lock exists: $LOCK_DIR"
  exit 73
fi
print "$$" > "$LOCK_DIR/pid"
cleanup() { rm -rf "$LOCK_DIR" }
trap cleanup EXIT INT TERM HUP

disable_autonomy() { rm -f "$ENABLED_FILE"; }
stop_requested() { [[ -f "$STOP_FILE" || ! -f "$ENABLED_FILE" ]]; }
interruptible_wait() {
  local remaining="${1:-0}"
  while (( remaining > 0 )); do
    if stop_requested; then return 1; fi
    local step="$WAIT_POLL"; (( step > remaining )) && step="$remaining"
    sleep "$step"; remaining=$((remaining - step))
  done
  return 0
}
rotate_logs() {
  local files count
  files=("$LOG_DIR"/*-events.jsonl(N.om) "$LOG_DIR"/*-last-message.md(N.om) "$LOG_DIR"/doctor-*.log(N.om))
  count=${#files[@]}
  if (( count > MAX_LOG_FILES )); then
    for file in "${files[@]:$((MAX_LOG_FILES + 1))}"; do rm -f "$file"; done
  fi
}

update_state() {
  AUTONOMY_STATE="$1" AUTONOMY_MESSAGE="${2:-}" AUTONOMY_ROOT="$ROOT" node <<'NODE'
const fs = require('fs'); const path = require('path')
const file = path.join(process.env.AUTONOMY_ROOT, 'state', 'autonomy-state.json')
let state = {}; try { state = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
state.state = process.env.AUTONOMY_STATE
state.message = process.env.AUTONOMY_MESSAGE
state.updatedAt = new Date().toISOString()
fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2)); fs.renameSync(file + '.tmp', file)
NODE
}

increment_state() {
  AUTONOMY_EXIT="$1" AUTONOMY_LOG="$2" AUTONOMY_ROOT="$ROOT" node <<'NODE'
const fs = require('fs'); const path = require('path'); const crypto = require('crypto')
const file = path.join(process.env.AUTONOMY_ROOT, 'state', 'autonomy-state.json')
let s = {}; try { s = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
s.iteration = Number(s.iteration || 0) + 1; s.lastExitCode = Number(process.env.AUTONOMY_EXIT); s.lastLog = process.env.AUTONOMY_LOG; s.lastRunAt = new Date().toISOString()
let tail = ''; try { tail = fs.readFileSync(process.env.AUTONOMY_LOG, 'utf8').slice(-12000) } catch {}
const signature = crypto.createHash('sha256').update(tail.replace(/[0-9]{4}-[0-9:T.Z-]+/g, '<time>')).digest('hex').slice(0, 16)
s.identicalFailureCount = s.lastFailureSignature === signature && s.lastExitCode !== 0 ? Number(s.identicalFailureCount || 0) + 1 : (s.lastExitCode === 0 ? 0 : 1)
s.lastFailureSignature = s.lastExitCode === 0 ? null : signature
fs.writeFileSync(file + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(file + '.tmp', file)
NODE
}

update_state INITIALIZING "Checking repository, authentication, disk, and migration safety"

if [[ ! -f "$ENABLED_FILE" ]]; then update_state STOPPED "Autonomy is not enabled"; exit 0; fi
if [[ ! -d "$ROOT/.git" || ! -f "$ROOT/package.json" ]]; then update_state FAILED_SAFELY "Repository is missing or invalid"; disable_autonomy; exit 66; fi
if [[ -z "$CODEX_BIN" || ! -x "$CODEX_BIN" ]]; then update_state WAITING_FOR_AUTH "Codex CLI is not installed"; disable_autonomy; exit 69; fi
while ! "$CODEX_BIN" login status >/dev/null 2>&1; do
  update_state WAITING_FOR_AUTH "Codex is not authenticated; checking again later"
  interruptible_wait 300 || { update_state STOPPED "Stop requested"; exit 0; }
done
free_kb=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
if [[ -z "$free_kb" || "$free_kb" -lt "$MIN_FREE_KB" ]]; then update_state FAILED_SAFELY "Insufficient free disk space"; disable_autonomy; exit 74; fi
if [[ -f "$ROOT/state/.migration-in-progress" ]] || grep -q '^DANGEROUS_MIGRATION' "$ROOT/state/blockers.md" 2>/dev/null; then update_state WAITING_FOR_USER_DECISION "An incomplete or dangerous migration requires review"; disable_autonomy; exit 75; fi
while [[ "${AUTONOMY_SKIP_DOCTOR:-0}" != "1" ]] && ! "$CODEX_BIN" doctor --summary --no-color > "$LOG_DIR/doctor-$(date +%Y%m%d-%H%M%S).log" 2>&1; do
  update_state WAITING_FOR_AUTH "Codex doctor is unhealthy; checking again later"
  interruptible_wait 300 || { update_state STOPPED "Stop requested"; exit 0; }
done
if [[ ! -x "$WORKER" || ! -f "$BOUNDED_RUNNER" || ! -f "$CONTROL_STATE" || ! -f "$HOST_OPERATION" ]]; then update_state FAILED_SAFELY "Bounded worker or autonomy control-plane launcher is missing"; disable_autonomy; exit 66; fi

iteration=0
capacity_failures=0

while (( iteration < MAX_ITERATIONS )); do
  if stop_requested; then update_state STOPPED "Stop requested"; exit 0; fi
  if grep -q '^Status: COMPLETED' "$ROOT/state/next-task.md" 2>/dev/null; then update_state COMPLETED "Acceptance contract reports completion"; disable_autonomy; exit 0; fi

  node "$HOST_OPERATION" process-once >/dev/null 2>&1 || true
  control_decision=$(node "$CONTROL_STATE" before-iteration 2>/dev/null || print '{"action":"HALT_CONTROL_ERROR"}')
  control_action=$(print -r -- "$control_decision" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).action||'HALT_CONTROL_ERROR')}catch{process.stdout.write('HALT_CONTROL_ERROR')}})")
  if [[ "$control_action" == "WAITING_HOST_OPERATION" ]]; then
    update_state WAITING_FOR_HOST "A typed host operation is pending or must be submitted; sandbox worker dispatch is suspended"
    interruptible_wait 60 || { update_state STOPPED "Stop requested"; exit 0; }
    continue
  fi
  if [[ "$control_action" == HALT_* ]]; then
    update_state WAITING_FOR_USER_DECISION "Autonomy control plane stopped dispatch: $control_action"
    disable_autonomy
    exit 70
  fi

  iteration=$((iteration + 1))
  stamp=$(date +%Y%m%d-%H%M%S)
  events="$LOG_DIR/$stamp-events.jsonl"
  last="$LOG_DIR/$stamp-last-message.md"
  iteration_id="$stamp-$RANDOM-$iteration"
  update_state IMPLEMENTING "Launching bounded worker iteration $iteration ($iteration_id)"

  AUTONOMY_STAMP="$stamp" AUTONOMY_EVENTS="$events" AUTONOMY_LAST_MESSAGE="$last" AUTONOMY_ITERATION_ID="$iteration_id" \
    node "$BOUNDED_RUNNER" --timeout-seconds "$WORKER_TIMEOUT" --grace-seconds "$WORKER_GRACE" -- "$WORKER" &
  bounded_pid=$!
  cancelled_for_stop=0
  while kill -0 "$bounded_pid" 2>/dev/null; do
    if stop_requested; then kill -TERM "$bounded_pid" 2>/dev/null || true; cancelled_for_stop=1; break; fi
    sleep "$WAIT_POLL"
  done
  wait "$bounded_pid"; code=$?
  if (( cancelled_for_stop )); then update_state STOPPED "Stop requested during worker iteration"; exit 0; fi
  increment_state "$code" "$events"
  rotate_logs

  if [[ "$code" -eq 0 ]]; then
    capacity_failures=0
    update_state TESTING "Worker iteration $iteration completed; reviewing persisted next task"
    if [[ ! -s "$ROOT/state/last-run-summary.md" || ! -s "$ROOT/state/next-task.md" ]] || ! grep -Fq -- "- Iteration ID: $iteration_id" "$ROOT/state/last-run-summary.md"; then
      update_state BLOCKED "Worker exited without fresh iteration continuation state"; disable_autonomy; exit 70
    fi
    semantic_decision=$(node "$CONTROL_STATE" after-iteration --iteration-id "$iteration_id" 2>/dev/null || print '{"action":"HALT_CONTROL_ERROR"}')
    semantic_action=$(print -r -- "$semantic_decision" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).action||'HALT_CONTROL_ERROR')}catch{process.stdout.write('HALT_CONTROL_ERROR')}})")
    if [[ "$semantic_action" == "HALT_NO_PROGRESS" || "$semantic_action" == "HALT_CONTROL_ERROR" ]]; then
      update_state WAITING_FOR_USER_DECISION "Semantic progress circuit breaker stopped repeated no-progress iterations"
      disable_autonomy
      exit 70
    fi
    continue
  fi

  if [[ "$code" -eq 124 ]]; then
    update_state REPAIRING "Worker exceeded the ${WORKER_TIMEOUT}s hard timeout"
    interruptible_wait "$REPAIR_DELAY" || { update_state STOPPED "Stop requested"; exit 0; }
    continue
  fi

  if grep -Eqi 'rate.?limit|usage.?limit|capacity|temporar(il)?y unavailable|too many requests|try again later|model.*unavailable|quota' "$events"; then
    capacity_failures=$((capacity_failures + 1))
    delay=$((BACKOFF_BASE * (2 ** (capacity_failures - 1))))
    (( delay > BACKOFF_CAP )) && delay=$BACKOFF_CAP
    update_state WAITING_FOR_CAPACITY "Capacity failure $capacity_failures; retrying in ${delay}s"
    interruptible_wait "$delay" || { update_state STOPPED "Stop requested"; exit 0; }
    continue
  fi

  identical=$(node -e "try{const s=require('$STATE');process.stdout.write(String(s.identicalFailureCount||0))}catch{process.stdout.write('0')}")
  if (( identical >= 3 )); then update_state WAITING_FOR_USER_DECISION "The same worker failure persisted three times; inspect $events"; disable_autonomy; exit 70; fi
  update_state REPAIRING "Worker failed with exit $code; next iteration may repair it"
  interruptible_wait "$REPAIR_DELAY" || { update_state STOPPED "Stop requested"; exit 0; }
done

update_state BLOCKED "Supervisor reached its configured iteration bound"
disable_autonomy
exit 70
