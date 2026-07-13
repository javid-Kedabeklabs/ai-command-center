#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"

bool=false
command -v codex >/dev/null 2>&1 && codex_installed=true || codex_installed=false
command -v claude >/dev/null 2>&1 && claude_installed=true || claude_installed=false

sanitize_version() {
  LC_ALL=C tr '\r\n\t' '   ' | sed -E 's/[^A-Za-z0-9._() +\/-]/?/g; s/  +/ /g; s/^ //; s/ $//' | cut -c1-160
}

codex_version="unavailable"
if [[ "$codex_installed" == true ]]; then
  codex_version="$(codex --version 2>/dev/null | sanitize_version || true)"
  [[ -n "$codex_version" ]] || codex_version="unknown"
fi

claude_version="unavailable"
claude_help=""
auth_output=""
auth_exit=127
if [[ "$claude_installed" == true ]]; then
  claude_version="$(claude --version 2>/dev/null | sanitize_version || true)"
  [[ -n "$claude_version" ]] || claude_version="unknown"
  claude_help="$(claude --help 2>/dev/null || true)"
  set +e
  auth_output="$(claude auth status 2>&1)"
  auth_exit=$?
  set -e
fi

auth_summary="$(node - "$auth_exit" 3<<<"$auth_output" <<'NODE' || true
const fs = require('node:fs')
const exitCode = Number(process.argv[2])
const raw = fs.readFileSync(3, 'utf8').slice(0, 100_000)
let value = null
try { value = JSON.parse(raw) } catch {}
const lower = raw.toLowerCase()
const loggedIn = value && typeof value === 'object' && typeof value.loggedIn === 'boolean'
  ? value.loggedIn
  : exitCode === 0 && !/not logged in|unauthorized|authentication required/.test(lower)
const methodSource = String(value?.authMethod || value?.authenticationMethod || '').toLowerCase()
let method = 'unknown'
if (/oauth|claude\.ai|subscription/.test(methodSource)) method = 'subscription'
else if (/api.?key/.test(methodSource)) method = 'api-key'
else if (/bedrock/.test(methodSource)) method = 'bedrock'
else if (/vertex/.test(methodSource)) method = 'vertex'
else if (/foundry/.test(methodSource)) method = 'foundry'
const planSource = String(value?.subscriptionType || value?.subscription || value?.plan || value?.accountType || '').toLowerCase()
let subscription = 'unknown'
for (const allowed of ['enterprise', 'team', 'pro', 'max', 'api']) {
  if (planSource === allowed || planSource.includes(allowed)) { subscription = allowed; break }
}
if (!loggedIn) { method = 'none'; subscription = 'none' }
process.stdout.write(`${loggedIn ? 'true' : 'false'}|${method}|${subscription}`)
NODE
)"
IFS='|' read -r authenticated auth_method subscription <<<"${auth_summary:-false|unknown|unknown}"

supports_fable=false; [[ "$claude_help" == *"fable"* ]] && supports_fable=true
supports_max_effort=false; [[ "$claude_help" == *"low, medium, high, xhigh, max"* ]] && supports_max_effort=true
supports_worktree=false; [[ "$claude_help" == *"--worktree"* ]] && supports_worktree=true
supports_stream_json=false; [[ "$claude_help" == *"stream-json"* ]] && supports_stream_json=true
supports_max_turns=false; [[ "$claude_help" == *"--max-turn"* ]] && supports_max_turns=true

git_repository=false
git_root=""
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git_repository=true
  git_root="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
fi

disk_available_kb="unknown"
disk_available_kb="$(df -Pk "$ROOT" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
[[ "$disk_available_kb" =~ ^[0-9]+$ ]] || disk_available_kb="unknown"

worktree_count=0
if [[ "$git_repository" == true ]]; then
  worktree_count="$(git -C "$ROOT" worktree list --porcelain 2>/dev/null | awk '$1 == "worktree" {count++} END {print count+0}')"
fi

process_records=""
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  pid="$(awk '{print $1}' <<<"$line")"
  ppid="$(awk '{print $2}' <<<"$line")"
  pgid="$(awk '{print $3}' <<<"$line")"
  executable="$(awk '{print $4}' <<<"$line")"
  name="$(basename -- "$executable")"
  case "$name" in claude|codex) ;; *) continue ;; esac
  cwd=""
  if command -v lsof >/dev/null 2>&1; then
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | awk 'substr($0,1,1)=="n" {print substr($0,2); exit}' || true)"
  fi
  [[ "$cwd" == "$ROOT" || "$cwd" == "$ROOT"/* ]] || continue
  process_records+="${pid}|${ppid}|${pgid}|${name}"$'\n'
done < <(ps -axo pid=,ppid=,pgid=,comm= 2>/dev/null || true)

export DOCTOR_ROOT="$ROOT" DOCTOR_CODEX_INSTALLED="$codex_installed" DOCTOR_CODEX_VERSION="$codex_version"
export DOCTOR_CLAUDE_INSTALLED="$claude_installed" DOCTOR_CLAUDE_VERSION="$claude_version"
export DOCTOR_AUTHENTICATED="$authenticated" DOCTOR_AUTH_METHOD="$auth_method" DOCTOR_SUBSCRIPTION="$subscription"
export DOCTOR_FABLE="$supports_fable" DOCTOR_MAX_EFFORT="$supports_max_effort" DOCTOR_WORKTREE="$supports_worktree"
export DOCTOR_STREAM_JSON="$supports_stream_json" DOCTOR_MAX_TURNS="$supports_max_turns"
export DOCTOR_GIT_REPOSITORY="$git_repository" DOCTOR_GIT_ROOT="$git_root" DOCTOR_DISK_KB="$disk_available_kb"
export DOCTOR_WORKTREE_COUNT="$worktree_count" DOCTOR_PROCESSES="$process_records"
node <<'NODE'
const truth = name => process.env[name] === 'true'
const processes = (process.env.DOCTOR_PROCESSES || '').trim().split('\n').filter(Boolean).map(line => {
  const [pid, parentPid, processGroupId, executable] = line.split('|')
  return { pid: Number(pid), parentPid: Number(parentPid), processGroupId: Number(processGroupId), executable }
})
const disk = process.env.DOCTOR_DISK_KB === 'unknown' ? null : Number(process.env.DOCTOR_DISK_KB)
console.log(JSON.stringify({
  schemaVersion: 1,
  repository: { root: process.env.DOCTOR_ROOT, isGitRepository: truth('DOCTOR_GIT_REPOSITORY'), gitRootMatches: process.env.DOCTOR_GIT_ROOT === process.env.DOCTOR_ROOT, worktreeCount: Number(process.env.DOCTOR_WORKTREE_COUNT), diskAvailableKb: disk },
  codex: { installed: truth('DOCTOR_CODEX_INSTALLED'), version: process.env.DOCTOR_CODEX_VERSION },
  claude: {
    installed: truth('DOCTOR_CLAUDE_INSTALLED'), version: process.env.DOCTOR_CLAUDE_VERSION,
    authentication: { authenticated: truth('DOCTOR_AUTHENTICATED'), method: process.env.DOCTOR_AUTH_METHOD, subscription: process.env.DOCTOR_SUBSCRIPTION },
    capabilities: { fable: truth('DOCTOR_FABLE'), maxEffort: truth('DOCTOR_MAX_EFFORT'), worktree: truth('DOCTOR_WORKTREE'), streamJson: truth('DOCTOR_STREAM_JSON'), maxTurnsFlag: truth('DOCTOR_MAX_TURNS') },
  },
  possibleConflictingProcesses: processes,
}, null, 2))
NODE
