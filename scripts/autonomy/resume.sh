#!/bin/zsh
set -e
ROOT="${COMMAND_CENTER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
LABEL="com.kedabektechlabs.command-center-autonomy"
rm -f "$ROOT/state/autonomy.stop"
mkdir -p "$ROOT/state" "$ROOT/logs/autonomy"
umask 077
print "enabled $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ROOT/state/autonomy.enabled.tmp"
mv "$ROOT/state/autonomy.enabled.tmp" "$ROOT/state/autonomy.enabled"
if [[ -d "$ROOT/state/.autonomy-lock" ]]; then
  pid="$(cat "$ROOT/state/.autonomy-lock/pid" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then print "Supervisor already appears active."; exit 0; fi
  rm -f "$ROOT/state/.autonomy-lock/pid"
  rmdir "$ROOT/state/.autonomy-lock" 2>/dev/null || { print -u2 "Cannot clear stale supervisor lock."; exit 73; }
fi
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart "gui/$(id -u)/$LABEL"
  print "Autonomy enabled under launchd."
else
  nohup "$ROOT/scripts/autonomy/codex-supervisor.sh" >> "$ROOT/logs/autonomy/supervisor.log" 2>&1 &
  print "Autonomy supervisor started with pid $! (LaunchAgent is not installed.)"
fi
