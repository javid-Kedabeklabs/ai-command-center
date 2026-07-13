#!/bin/zsh
set -u
umask 077

SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cc-autonomy-test.XXXXXX")"
passed=0
failed=0
cleanup() { [[ -n "${active_pid:-}" ]] && kill "$active_pid" 2>/dev/null || true; rm -rf "$FIXTURE_ROOT"; }
trap cleanup EXIT INT TERM
check() { if [[ "$1" == "1" ]]; then print "PASS  $2"; passed=$((passed + 1)); else print "FAIL  $2"; failed=$((failed + 1)); fi }

mkdir -p "$FIXTURE_ROOT/scripts/autonomy" "$FIXTURE_ROOT/server/autonomy" "$FIXTURE_ROOT/state" "$FIXTURE_ROOT/logs/autonomy" "$FIXTURE_ROOT/docs" "$FIXTURE_ROOT/bin"
cp "$SOURCE_ROOT/scripts/autonomy/codex-supervisor.sh" "$SOURCE_ROOT/scripts/autonomy/run-bounded-worker.mjs" "$SOURCE_ROOT/scripts/autonomy/control-state.mjs" "$SOURCE_ROOT/scripts/autonomy/host-operation.mjs" "$FIXTURE_ROOT/scripts/autonomy/"
cp "$SOURCE_ROOT/server/autonomy/control-plane.js" "$SOURCE_ROOT/server/autonomy/host-operation-store.js" "$SOURCE_ROOT/server/autonomy/host-controller.js" "$FIXTURE_ROOT/server/autonomy/"
print '{"name":"fixture"}' > "$FIXTURE_ROOT/package.json"
print '# Plan' > "$FIXTURE_ROOT/docs/MASTER_PLAN.md"
print '# Blockers\n\nNo blockers.' > "$FIXTURE_ROOT/state/blockers.md"
print '# Next task\n\nStatus: READY' > "$FIXTURE_ROOT/state/next-task.md"
print '# Summary' > "$FIXTURE_ROOT/state/last-run-summary.md"
print '{"state":"STOPPED","iteration":0}' > "$FIXTURE_ROOT/state/autonomy-state.json"
git -C "$FIXTURE_ROOT" init -q
git -C "$FIXTURE_ROOT" config user.email fixture@example.invalid
git -C "$FIXTURE_ROOT" config user.name 'Autonomy Fixture'
git -C "$FIXTURE_ROOT" add package.json docs state scripts server
git -C "$FIXTURE_ROOT" commit -qm 'fixture baseline'

FAKE_CODEX="$FIXTURE_ROOT/bin/codex"
print '#!/bin/zsh\nexit 0' > "$FAKE_CODEX"; chmod +x "$FAKE_CODEX"
WORKER="$FIXTURE_ROOT/scripts/autonomy/fixture-worker.sh"
cat > "$WORKER" <<'FIXTURE'
#!/bin/zsh
root="$COMMAND_CENTER_ROOT"
case "${FIXTURE_MODE:-success_complete}" in
  success_complete)
    print '{"status":"ok"}' > "$AUTONOMY_EVENTS"
    print "# Summary\n\n- Iteration ID: $AUTONOMY_ITERATION_ID" > "$root/state/last-run-summary.md"
    print '# Next task\n\nStatus: COMPLETED' > "$root/state/next-task.md" ;;
  stale)
    print '{"status":"ok"}' > "$AUTONOMY_EVENTS" ;;
  timeout) sleep 20 ;;
  capacity_then_success)
    count_file="$root/state/count"; count=0; [[ -f "$count_file" ]] && count=$(cat "$count_file"); count=$((count + 1)); print "$count" > "$count_file"
    if (( count == 1 )); then print '{"error":"temporary rate limit"}' > "$AUTONOMY_EVENTS"; exit 1; fi
    print '{"status":"ok"}' > "$AUTONOMY_EVENTS"
    print "# Summary\n\n- Iteration ID: $AUTONOMY_ITERATION_ID" > "$root/state/last-run-summary.md"
    print '# Next task\n\nStatus: COMPLETED' > "$root/state/next-task.md" ;;
  capacity_forever) print '{"error":"temporary rate limit"}' > "$AUTONOMY_EVENTS"; exit 1 ;;
  waiting_host)
    count_file="$root/state/worker-count"; count=0; [[ -f "$count_file" ]] && count=$(cat "$count_file"); print $((count + 1)) > "$count_file"
    print '{"status":"waiting-host"}' > "$AUTONOMY_EVENTS"
    print "# Summary\n\n- Iteration ID: $AUTONOMY_ITERATION_ID" > "$root/state/last-run-summary.md"
    print '# Next task\n\nStatus: WAITING_HOST_OPERATION\n\nPhase 5, slice 5T-C' > "$root/state/next-task.md" ;;
esac
FIXTURE
chmod +x "$WORKER"
SUPERVISOR="$FIXTURE_ROOT/scripts/autonomy/codex-supervisor.sh"

run_supervisor() {
  rm -rf "$FIXTURE_ROOT/state/.autonomy-lock" "$FIXTURE_ROOT/state/autonomy.stop"
  print enabled > "$FIXTURE_ROOT/state/autonomy.enabled"
  print '# Next task\n\nStatus: READY' > "$FIXTURE_ROOT/state/next-task.md"
  print '# Summary' > "$FIXTURE_ROOT/state/last-run-summary.md"
  node -e "const fs=require('fs'),p='$FIXTURE_ROOT/state/autonomy-state.json',s=JSON.parse(fs.readFileSync(p));s.lastFailureSignature=null;s.identicalFailureCount=0;fs.writeFileSync(p,JSON.stringify(s))"
  COMMAND_CENTER_ROOT="$FIXTURE_ROOT" AUTONOMY_CODEX_BIN="$FAKE_CODEX" AUTONOMY_WORKER="$WORKER" AUTONOMY_SKIP_DOCTOR=1 AUTONOMY_TEST_MODE=1 AUTONOMY_WAIT_POLL_SECONDS=1 FIXTURE_MODE="$FIXTURE_MODE" "$@" "$SUPERVISOR" >"$FIXTURE_ROOT/supervisor.out" 2>&1 || true
}

mkdir "$FIXTURE_ROOT/state/.autonomy-lock"; print $$ > "$FIXTURE_ROOT/state/.autonomy-lock/pid"
COMMAND_CENTER_ROOT="$FIXTURE_ROOT" AUTONOMY_CODEX_BIN="$FAKE_CODEX" AUTONOMY_WORKER="$WORKER" AUTONOMY_SKIP_DOCTOR=1 "$SUPERVISOR" >/dev/null 2>&1
check "$([[ $? -eq 73 ]] && print 1 || print 0)" "single-instance lock rejects a second supervisor"
rm -rf "$FIXTURE_ROOT/state/.autonomy-lock"

FIXTURE_MODE=success_complete run_supervisor env AUTONOMY_MAX_ITERATIONS=2
check "$([[ $(node -p "require('$FIXTURE_ROOT/state/autonomy-state.json').state") == COMPLETED && ! -f "$FIXTURE_ROOT/state/autonomy.enabled" ]] && print 1 || print 0)" "fresh continuation state can complete and disable autonomy"

FIXTURE_MODE=stale run_supervisor env AUTONOMY_MAX_ITERATIONS=1
check "$([[ $(node -p "require('$FIXTURE_ROOT/state/autonomy-state.json').state") == BLOCKED && ! -f "$FIXTURE_ROOT/state/autonomy.enabled" ]] && print 1 || print 0)" "stale continuation state fails closed"

start=$SECONDS
FIXTURE_MODE=timeout run_supervisor env AUTONOMY_MAX_ITERATIONS=1 AUTONOMY_WORKER_TIMEOUT_SECONDS=1 AUTONOMY_WORKER_GRACE_SECONDS=1 AUTONOMY_REPAIR_DELAY_SECONDS=0
elapsed=$((SECONDS - start))
check "$([[ $elapsed -lt 8 ]] && print 1 || print 0)" "hard worker timeout terminates a hung iteration"

rm -f "$FIXTURE_ROOT/state/count"
FIXTURE_MODE=capacity_then_success run_supervisor env AUTONOMY_MAX_ITERATIONS=3 AUTONOMY_BACKOFF_BASE_SECONDS=0 AUTONOMY_BACKOFF_CAP_SECONDS=0
check "$([[ $(node -p "require('$FIXTURE_ROOT/state/autonomy-state.json').state") == COMPLETED ]] && print 1 || print 0)" "capacity failure recovers on a bounded later iteration"

rm -f "$FIXTURE_ROOT/state/autonomy.stop"; print enabled > "$FIXTURE_ROOT/state/autonomy.enabled"
COMMAND_CENTER_ROOT="$FIXTURE_ROOT" AUTONOMY_CODEX_BIN="$FAKE_CODEX" AUTONOMY_WORKER="$WORKER" AUTONOMY_SKIP_DOCTOR=1 AUTONOMY_TEST_MODE=1 AUTONOMY_WAIT_POLL_SECONDS=1 FIXTURE_MODE=capacity_forever AUTONOMY_BACKOFF_BASE_SECONDS=30 AUTONOMY_BACKOFF_CAP_SECONDS=30 "$SUPERVISOR" >/dev/null 2>&1 &
active_pid=$!
for _ in {1..50}; do [[ $(node -p "require('$FIXTURE_ROOT/state/autonomy-state.json').state" 2>/dev/null) == WAITING_FOR_CAPACITY ]] && break; sleep 0.1; done
rm -f "$FIXTURE_ROOT/state/autonomy.enabled"; print stop > "$FIXTURE_ROOT/state/autonomy.stop"
for _ in {1..50}; do ! kill -0 "$active_pid" 2>/dev/null && break; sleep 0.1; done
check "$(! kill -0 "$active_pid" 2>/dev/null && print 1 || print 0)" "stop interrupts capacity backoff promptly"
wait "$active_pid" 2>/dev/null || true; active_pid=""

rm -f "$FIXTURE_ROOT/state/worker-count" "$FIXTURE_ROOT/state/autonomy.stop"; print enabled > "$FIXTURE_ROOT/state/autonomy.enabled"
print '# Next task\n\nStatus: READY\n\nPhase 5, slice 5T-C' > "$FIXTURE_ROOT/state/next-task.md"
COMMAND_CENTER_ROOT="$FIXTURE_ROOT" AUTONOMY_CODEX_BIN="$FAKE_CODEX" AUTONOMY_WORKER="$WORKER" AUTONOMY_SKIP_DOCTOR=1 AUTONOMY_TEST_MODE=1 AUTONOMY_WAIT_POLL_SECONDS=1 FIXTURE_MODE=waiting_host "$SUPERVISOR" >/dev/null 2>&1 &
active_pid=$!
for _ in {1..100}; do [[ $(node -p "require('$FIXTURE_ROOT/state/autonomy-state.json').state" 2>/dev/null) == WAITING_FOR_HOST ]] && break; sleep 0.1; done
count=$(cat "$FIXTURE_ROOT/state/worker-count" 2>/dev/null || print 0)
check "$([[ "$count" == 1 ]] && print 1 || print 0)" "WAITING_HOST_OPERATION suspends repeated sandbox worker dispatch"
rm -f "$FIXTURE_ROOT/state/autonomy.enabled"; print stop > "$FIXTURE_ROOT/state/autonomy.stop"
for _ in {1..50}; do ! kill -0 "$active_pid" 2>/dev/null && break; sleep 0.1; done
wait "$active_pid" 2>/dev/null || true; active_pid=""

print "\nRESULT: $passed passed, $failed failed"
exit "$failed"
