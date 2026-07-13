#!/bin/zsh
set -u
ROOT="${COMMAND_CENTER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
fail=0
check() { if eval "$2" >/dev/null 2>&1; then print "PASS  $1"; else print "FAIL  $1"; fail=$((fail + 1)); fi }
check "repository" "test -d '$ROOT/.git'"
check "Codex CLI" "command -v codex"
check "Codex authentication" "codex login status"
check "Codex doctor" "codex doctor --summary --no-color"
check "worker prompt" "test -s '$ROOT/scripts/autonomy/worker-prompt.md'"
check "bounded worker runner" "test -s '$ROOT/scripts/autonomy/run-bounded-worker.mjs'"
check "master plan" "test -s '$ROOT/docs/MASTER_PLAN.md'"
check "state" "node -e \"JSON.parse(require('fs').readFileSync('$ROOT/state/autonomy-state.json','utf8'))\""
check "shell syntax" "zsh -n '$ROOT/scripts/autonomy/codex-supervisor.sh' '$ROOT/scripts/autonomy/codex-worker.sh' '$ROOT/scripts/autonomy/resume.sh' '$ROOT/scripts/autonomy/stop.sh' '$ROOT/scripts/autonomy/install-launch-agent.sh'"
free_kb=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
if [[ "$free_kb" -ge 10485760 ]]; then print "PASS  disk space"; else print "FAIL  disk space"; fail=$((fail + 1)); fi
exit "$fail"
