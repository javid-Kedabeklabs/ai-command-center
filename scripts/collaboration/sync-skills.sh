#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"
CANONICAL_ROOT="$ROOT/.agent-skills"
BACKUP_ROOT="$CANONICAL_ROOT/.sync-backups"
ACTION="dry-run"
VENDOR="claude"
MODE="copy"
SKILL=""
CODEX_TARGET=""
ROLLBACK_MANIFEST=""

usage() {
  cat >&2 <<'USAGE'
Usage:
  sync-skills.sh --skill <name> [--vendor claude|codex] [--codex-target <repo-relative-dir>] [--mode copy|symlink] [--apply]
  sync-skills.sh --rollback <repo-relative-manifest> --apply

Dry-run is the default. Apply always operates on one exact skill. Codex requires
an explicit project-local --codex-target because its project discovery path was
not confirmed locally.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill) [[ $# -ge 2 ]] || { usage; exit 64; }; SKILL="$2"; shift 2 ;;
    --vendor) [[ $# -ge 2 ]] || { usage; exit 64; }; VENDOR="$2"; shift 2 ;;
    --codex-target) [[ $# -ge 2 ]] || { usage; exit 64; }; CODEX_TARGET="$2"; shift 2 ;;
    --mode) [[ $# -ge 2 ]] || { usage; exit 64; }; MODE="$2"; shift 2 ;;
    --apply) ACTION="apply"; shift ;;
    --dry-run) ACTION="dry-run"; shift ;;
    --rollback) [[ $# -ge 2 ]] || { usage; exit 64; }; ROLLBACK_MANIFEST="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
valid_relative_path() {
  local value="$1" segment
  [[ -n "$value" && "$value" != /* && "$value" != '~'* && "$value" != *'\\'* && "$value" != *'//'* ]] || return 1
  IFS='/' read -r -a parts <<<"$value"
  for segment in "${parts[@]}"; do
    [[ -n "$segment" && "$segment" != '.' && "$segment" != '..' && "$segment" != *$'\n'* && "$segment" != *'|'* ]] || return 1
  done
}
assert_no_symlink_components() {
  local relative="$1" current="$ROOT" segment
  IFS='/' read -r -a parts <<<"$relative"
  for segment in "${parts[@]}"; do
    current="$current/$segment"
    [[ ! -L "$current" ]] || fail "path contains a symlink component: $relative"
  done
}
package_hash() {
  node - "$1" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(process.argv[2])
const entries = []
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('skill package contains a symlink')
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile()) entries.push(path.relative(root, full).split(path.sep).join('/'))
    else throw new Error('skill package contains an unsupported file type')
  }
}
walk(root)
const digest = crypto.createHash('sha256')
for (const relative of entries) {
  digest.update(relative); digest.update('\0'); digest.update(fs.readFileSync(path.join(root, relative))); digest.update('\0')
}
process.stdout.write(digest.digest('hex'))
NODE
}
validate_skill() {
  local directory="$1" expected="$2"
  [[ -d "$directory" && ! -L "$directory" ]] || fail "canonical skill directory is missing or is a symlink: $expected"
  [[ -f "$directory/SKILL.md" && ! -L "$directory/SKILL.md" ]] || fail "canonical skill requires a regular SKILL.md"
  if find "$directory" -type l -print -quit | grep -q .; then fail "canonical skill contains a symlink"; fi
  node - "$directory/SKILL.md" "$expected" <<'NODE'
const fs = require('node:fs')
const [file, expected] = process.argv.slice(2)
const text = fs.readFileSync(file, 'utf8')
const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
if (!match) { console.error('ERROR: SKILL.md requires YAML frontmatter'); process.exit(1) }
const values = {}
for (const raw of match[1].split(/\r?\n/)) {
  if (!raw.trim() || /^\s*#/.test(raw)) continue
  const field = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
  if (!field) { console.error('ERROR: unsupported multiline or malformed SKILL.md frontmatter'); process.exit(1) }
  let value = field[2].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  values[field[1]] = value
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.name || '') || values.name !== expected) {
  console.error('ERROR: SKILL.md name must match its directory'); process.exit(1)
}
if (!values.description || values.description.length < 10 || values.description.length > 1024) {
  console.error('ERROR: SKILL.md requires a bounded description'); process.exit(1)
}
NODE
}

if [[ -n "$ROLLBACK_MANIFEST" ]]; then
  [[ -z "$SKILL" && "$ACTION" == apply ]] || { usage; exit 64; }
  valid_relative_path "$ROLLBACK_MANIFEST" || fail "rollback manifest must be repository-relative and normalized"
  case "$ROLLBACK_MANIFEST" in .agent-skills/.sync-backups/*/manifest.json) ;; *) fail "rollback manifest is outside the synchronization backup area" ;; esac
  assert_no_symlink_components "$ROLLBACK_MANIFEST"
  MANIFEST="$ROOT/$ROLLBACK_MANIFEST"
  [[ -f "$MANIFEST" && ! -L "$MANIFEST" ]] || fail "rollback manifest is unavailable"
  record="$(node - "$MANIFEST" <<'NODE'
const fs = require('node:fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const fields = [value.schemaVersion, value.skill, value.vendor, value.mode, value.targetRelative, value.sourceHash, value.mutation]
  if (fields.some(item => typeof item === 'string' && item.includes('|'))) process.exit(2)
  process.stdout.write(fields.join('|'))
} catch { process.exit(3) }
NODE
)" || fail "rollback manifest is malformed"
  IFS='|' read -r schema skill vendor mode target_relative expected_hash mutation <<<"$record"
  [[ "$schema" == 1 && "$mutation" == created && "$skill" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || fail "rollback manifest is unsupported"
  valid_relative_path "$target_relative" || fail "rollback target is unsafe"
  if [[ "$vendor" == claude ]]; then
    [[ -z "$CODEX_TARGET" && "$target_relative" == ".claude/skills/$skill" ]] || fail "rollback target/vendor mismatch"
  elif [[ "$vendor" == codex ]]; then
    [[ -n "$CODEX_TARGET" ]] || fail "Codex rollback requires the original explicit --codex-target"
    valid_relative_path "$CODEX_TARGET" || fail "Codex rollback target is unsafe"
    case "$CODEX_TARGET" in .git|.git/*|.agent-skills|.agent-skills/*|.claude|.claude/*) fail "Codex rollback target overlaps a protected location" ;; esac
    [[ "$target_relative" == "$CODEX_TARGET/$skill" ]] || fail "Codex rollback target does not match the manifest"
  else fail "rollback vendor is unsupported"
  fi
  assert_no_symlink_components "$(dirname -- "$target_relative")"
  TARGET="$ROOT/$target_relative"
  [[ "$TARGET" != "$ROOT" && "$TARGET" == "$ROOT"/* ]] || fail "rollback target escapes repository"
  if [[ "$mode" == symlink ]]; then
    [[ -L "$TARGET" ]] || fail "rollback refuses a changed or missing symlink adapter"
    resolved="$(CDPATH= cd -- "$(dirname -- "$TARGET")" && CDPATH= cd -- "$(dirname -- "$(readlink -- "$TARGET")")" 2>/dev/null && pwd -P)/$(basename -- "$(readlink -- "$TARGET")")" || fail "rollback symlink cannot be resolved"
    [[ "$resolved" == "$ROOT/.agent-skills/$skill" ]] || fail "rollback refuses a locally changed symlink"
    rm -- "$TARGET"
  elif [[ "$mode" == copy ]]; then
    [[ -d "$TARGET" && ! -L "$TARGET" ]] || fail "rollback refuses a changed or missing copied adapter"
    current_hash="$(package_hash "$TARGET")" || fail "rollback target cannot be hashed"
    [[ "$current_hash" == "$expected_hash" ]] || fail "rollback refuses local modifications"
    rm -r -- "$TARGET"
  else fail "rollback manifest has an unsupported mode"
  fi
  printf 'ROLLED BACK %s from %s\n' "$skill" "$target_relative"
  exit 0
fi

[[ "$SKILL" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { usage; exit 64; }
[[ "$MODE" == copy || "$MODE" == symlink ]] || { usage; exit 64; }
[[ "$VENDOR" == claude || "$VENDOR" == codex ]] || { usage; exit 64; }
SOURCE_RELATIVE=".agent-skills/$SKILL"
SOURCE="$ROOT/$SOURCE_RELATIVE"
validate_skill "$SOURCE" "$SKILL"
SOURCE_HASH="$(package_hash "$SOURCE")" || fail "canonical skill package could not be hashed"

if [[ "$VENDOR" == claude ]]; then
  [[ -z "$CODEX_TARGET" ]] || fail "--codex-target is valid only for the Codex vendor"
  TARGET_ROOT_RELATIVE=".claude/skills"
else
  [[ -n "$CODEX_TARGET" ]] || fail "Codex project target is unconfirmed; provide --codex-target explicitly"
  valid_relative_path "$CODEX_TARGET" || fail "Codex target must be repository-relative and normalized"
  case "$CODEX_TARGET" in .git|.git/*|.agent-skills|.agent-skills/*|.claude|.claude/*) fail "Codex target overlaps a protected adapter/source location" ;; esac
  TARGET_ROOT_RELATIVE="$CODEX_TARGET"
fi
assert_no_symlink_components "$TARGET_ROOT_RELATIVE"
TARGET_RELATIVE="$TARGET_ROOT_RELATIVE/$SKILL"
TARGET="$ROOT/$TARGET_RELATIVE"
[[ "$TARGET" == "$ROOT"/* ]] || fail "target escapes repository"

state="ADD"
if [[ -L "$TARGET" ]]; then
  link="$(readlink -- "$TARGET")"
  resolved="$(CDPATH= cd -- "$(dirname -- "$TARGET")" && CDPATH= cd -- "$(dirname -- "$link")" 2>/dev/null && pwd -P)/$(basename -- "$link")" || resolved=""
  if [[ "$MODE" == symlink && "$resolved" == "$SOURCE" ]]; then state="UNCHANGED"; else state="CONFLICT"; fi
elif [[ -e "$TARGET" ]]; then
  if [[ "$MODE" == copy && -d "$TARGET" ]] && [[ "$(package_hash "$TARGET" 2>/dev/null || true)" == "$SOURCE_HASH" ]]; then state="UNCHANGED"; else state="CONFLICT"; fi
fi

case "$state" in
  UNCHANGED) printf 'UNCHANGED %s -> %s\n' "$SOURCE_RELATIVE" "$TARGET_RELATIVE"; exit 0 ;;
  CONFLICT)
    printf 'CONFLICT %s differs from canonical %s; refusing overwrite.\n' "$TARGET_RELATIVE" "$SOURCE_RELATIVE" >&2
    if [[ -d "$TARGET" && ! -L "$TARGET" ]]; then diff -ruN -- "$TARGET" "$SOURCE" || true; fi
    exit 2
    ;;
  ADD) printf '%s ADD %s -> %s (%s)\n' "$(tr '[:lower:]' '[:upper:]' <<<"$ACTION")" "$SOURCE_RELATIVE" "$TARGET_RELATIVE" "$MODE" ;;
esac
[[ "$ACTION" == apply ]] || exit 0

stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$-$SKILL-$VENDOR"
MANIFEST_DIR="$BACKUP_ROOT/$stamp"
MANIFEST="$MANIFEST_DIR/manifest.json"
mkdir -p -- "$MANIFEST_DIR"
export SYNC_SKILL="$SKILL" SYNC_VENDOR="$VENDOR" SYNC_MODE="$MODE" SYNC_TARGET="$TARGET_RELATIVE" SYNC_HASH="$SOURCE_HASH" SYNC_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node >"$MANIFEST" <<'NODE'
console.log(JSON.stringify({ schemaVersion: 1, skill: process.env.SYNC_SKILL, vendor: process.env.SYNC_VENDOR, mode: process.env.SYNC_MODE, targetRelative: process.env.SYNC_TARGET, sourceHash: process.env.SYNC_HASH, mutation: 'created', createdAt: process.env.SYNC_CREATED }, null, 2))
NODE
mkdir -p -- "$ROOT/$TARGET_ROOT_RELATIVE"
if [[ "$MODE" == symlink ]]; then
  relative_source="$(node -e 'const p=require("node:path"); process.stdout.write(p.relative(process.argv[1], process.argv[2]))' "$(dirname -- "$TARGET")" "$SOURCE")"
  ln -s -- "$relative_source" "$TARGET"
else
  TEMP_TARGET="$ROOT/$TARGET_ROOT_RELATIVE/.sync-$SKILL-$$"
  trap 'if [[ -n "${TEMP_TARGET:-}" && -e "$TEMP_TARGET" ]]; then rm -r -- "$TEMP_TARGET"; fi' EXIT
  cp -R -- "$SOURCE" "$TEMP_TARGET"
  mv -- "$TEMP_TARGET" "$TARGET"
fi
printf 'APPLIED %s\nROLLBACK ./%s --rollback %s --apply\n' "$TARGET_RELATIVE" "${0#./}" "${MANIFEST#"$ROOT/"}"
