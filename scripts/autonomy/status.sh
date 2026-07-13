#!/bin/zsh
ROOT="${COMMAND_CENTER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
print "AI Command Center autonomy"
if [[ -f "$ROOT/state/autonomy.enabled" ]]; then print "Continuous execution: enabled"; else print "Continuous execution: disabled"; fi
if [[ -f "$ROOT/state/autonomy-state.json" ]]; then cat "$ROOT/state/autonomy-state.json"; else print "No state file"; fi
if [[ -d "$ROOT/state/.autonomy-lock" ]]; then
  pid="$(cat "$ROOT/state/.autonomy-lock/pid" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then print "Supervisor lock: active (pid $pid)"; else print "Supervisor lock: stale (pid ${pid:-unknown})"; fi
else print "Supervisor lock: inactive"; fi
print "Next task:"
cat "$ROOT/state/next-task.md" 2>/dev/null || true
print "Recent logs:"
ls -1t "$ROOT/logs/autonomy" 2>/dev/null | head -5
