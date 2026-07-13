#!/bin/zsh
ROOT="${COMMAND_CENTER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
mkdir -p "$ROOT/state"
rm -f "$ROOT/state/autonomy.enabled"
print "stop requested $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ROOT/state/autonomy.stop"
print "Stop requested. The supervisor will cancel its bounded worker and exit within the configured poll interval."
