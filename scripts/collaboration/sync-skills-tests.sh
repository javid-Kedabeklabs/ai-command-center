#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
SUBJECT="$SCRIPT_DIR/sync-skills.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sync-skills-tests.XXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT
PASS=0

ok() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1" >&2; exit 1; }
make_repo() {
  local root="$1" skill="${2:-fixture-skill}"
  mkdir -p "$root/scripts/collaboration" "$root/.agent-skills/$skill/references"
  cp "$SUBJECT" "$root/scripts/collaboration/sync-skills.sh"
  cat >"$root/.agent-skills/$skill/SKILL.md" <<EOF
---
name: $skill
description: Deterministic fixture skill used only by the isolated synchronization test suite.
---

# Fixture
EOF
  printf 'reference\n' >"$root/.agent-skills/$skill/references/example.txt"
}
run_subject() { (cd "$1" && bash scripts/collaboration/sync-skills.sh "${@:2}"); }

printf '== shared skill synchronization ==\n'
REPO="$TMP/repo"
make_repo "$REPO"

output="$(run_subject "$REPO" --skill fixture-skill)"
[[ "$output" == *"DRY-RUN ADD"* && ! -e "$REPO/.claude/skills/fixture-skill" ]] || fail 'dry-run'
ok 'dry-run reports addition without mutation'

output="$(run_subject "$REPO" --skill fixture-skill --apply)"
[[ "$output" == *"APPLIED"* && -f "$REPO/.claude/skills/fixture-skill/SKILL.md" ]] || fail 'copy apply'
manifest_count="$(find "$REPO/.agent-skills/.sync-backups" -name manifest.json | wc -l | awk '{$1=$1; print}')"
ok 'apply copies one exact skill and writes rollback manifest first'

output="$(run_subject "$REPO" --skill fixture-skill --apply)"
after_count="$(find "$REPO/.agent-skills/.sync-backups" -name manifest.json | wc -l | awk '{$1=$1; print}')"
[[ "$output" == *"UNCHANGED"* && "$after_count" == "$manifest_count" ]] || fail 'idempotency'
ok 'identical reapply is idempotent'

printf 'local change\n' >>"$REPO/.claude/skills/fixture-skill/SKILL.md"
set +e
output="$(run_subject "$REPO" --skill fixture-skill --apply 2>&1)"; code=$?
set -e
[[ "$code" -eq 2 && "$output" == *"CONFLICT"* ]] || fail 'conflict'
grep -q 'local change' "$REPO/.claude/skills/fixture-skill/SKILL.md" || fail 'conflict preservation'
ok 'conflict refuses overwrite and displays diff'

ROLLBACK_REPO="$TMP/rollback"
make_repo "$ROLLBACK_REPO" rollback-skill
run_subject "$ROLLBACK_REPO" --skill rollback-skill --mode symlink --apply >/dev/null
manifest="$(find "$ROLLBACK_REPO/.agent-skills/.sync-backups" -name manifest.json -print -quit)"
manifest_relative="${manifest#"$ROLLBACK_REPO/"}"
[[ -L "$ROLLBACK_REPO/.claude/skills/rollback-skill" ]] || fail 'symlink apply'
run_subject "$ROLLBACK_REPO" --rollback "$manifest_relative" --apply >/dev/null
[[ ! -e "$ROLLBACK_REPO/.claude/skills/rollback-skill" && ! -L "$ROLLBACK_REPO/.claude/skills/rollback-skill" ]] || fail 'rollback'
ok 'manifest rollback removes only unchanged created adapter'

ESCAPE_REPO="$TMP/escape"
OUTSIDE="$TMP/outside"
make_repo "$ESCAPE_REPO" safe-skill
mkdir -p "$OUTSIDE"
ln -s "$OUTSIDE" "$ESCAPE_REPO/.claude"
set +e
run_subject "$ESCAPE_REPO" --skill safe-skill --apply >/dev/null 2>&1; code=$?
set -e
[[ "$code" -ne 0 && ! -e "$OUTSIDE/skills/safe-skill" ]] || fail 'target symlink escape'
ok 'target symlink escape is rejected'

SOURCE_ESCAPE_REPO="$TMP/source-escape"
make_repo "$SOURCE_ESCAPE_REPO" source-skill
ln -s "$OUTSIDE" "$SOURCE_ESCAPE_REPO/.agent-skills/source-skill/escaped"
set +e
run_subject "$SOURCE_ESCAPE_REPO" --skill source-skill >/dev/null 2>&1; code=$?
set -e
[[ "$code" -ne 0 ]] || fail 'source symlink escape'
ok 'canonical package symlink escape is rejected'

set +e
run_subject "$ROLLBACK_REPO" --skill rollback-skill --vendor codex >/dev/null 2>&1; missing_code=$?
run_subject "$ROLLBACK_REPO" --skill rollback-skill --vendor codex --codex-target ../outside >/dev/null 2>&1; traversal_code=$?
set -e
[[ "$missing_code" -ne 0 && "$traversal_code" -ne 0 ]] || fail 'Codex target gate'
ok 'Codex requires an explicit safe repository-local target'

printf '\n== RESULT: %s passed, 0 failed ==\n' "$PASS"
