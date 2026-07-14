# Autonomous execution

The supervisor is continuity infrastructure, not a permission bypass. Every Codex worker is a separate bounded noninteractive turn running with repository `workspace-write` access and approval policy `never`. It cannot silently obtain credentials, purchase capacity, evade usage limits, or authorize security-sensitive external services.

## Lifecycle

1. An atomic directory lock prevents duplicate supervisors.
2. Repository, CLI, login, Codex doctor, disk, and migration guards run.
3. The supervisor reads durable state and launches one worker through a hard wall-time wrapper with TERM-to-KILL escalation.
4. JSONL events and the final message are timestamped under `logs/autonomy/`.
5. The worker must persist a summary containing the exact iteration ID and one exact next task; stale files fail closed.
6. Successful iterations continue; capacity errors back off from 60 seconds to at most one hour.
7. Repeated identical failure, migration risk, credentials, licensing, conflicting user work, or possible corruption stops for a user decision.

Before dispatch, the supervisor now reconciles the semantic control plane in `state/autonomy-control.json` and the typed host-operation queue in `state/host-operations/`. A task marked `WAITING_FOR_HOST` or `WAITING_HOST_OPERATION` cannot launch another sandbox worker. Completed receipts are evidence only: the trusted lead must explicitly change the task status after checking every postcondition. Three unchanged semantic progress states trip `HALT_NO_PROGRESS`.

States: `INITIALIZING`, `AUDITING`, `IMPLEMENTING`, `TESTING`, `REPAIRING`, `WAITING_FOR_CAPACITY`, `WAITING_FOR_AUTH`, `WAITING_FOR_USER_DECISION`, `BLOCKED`, `COMPLETED`, `STOPPED`, and `FAILED_SAFELY`.

## Safety and recovery

- `scripts/autonomy/stop.sh` removes the durable enabled marker, creates a stop request, and interrupts active work/backoff within the configured poll interval.
- `scripts/autonomy/resume.sh` creates `state/autonomy.enabled`, clears the request, and starts exactly one supervisor.
- `scripts/autonomy/status.sh` shows state, lock, next work, and logs.
- `scripts/autonomy/doctor.sh` performs non-mutating readiness checks.
- `scripts/autonomy/uninstall-launch-agent.sh` removes only the login service; state and logs remain.
- A `.migration-in-progress` marker or `DANGEROUS_MIGRATION` blocker prevents automatic continuation.
- The LaunchAgent uses `KeepAlive/PathState` on the enabled marker. Unexpected crashes restart with throttling; intentional stop, completion, or fail-closed terminal states remove the marker and remain stopped.
- Logs are private by default, bounded by retention, and runtime state/results remain ignored by Git.
- Host requests are restricted to named repository/service/localhost resources and seven typed operations. The controller invokes argument arrays directly, never model-generated shell text. Requests carry expiry and idempotency keys; receipts are durable. Failed requests remain auditable and can only be superseded by an explicit existing replacement.
- Backups validate every include before creating a destination, copy only allowlisted trigger evidence, hash the binary worktree patch and copied files, and reject symlinks, traversal, or tampered manifest paths.

The supervisor never treats a successful Codex exit as product completion. Completion requires `state/next-task.md` to contain `Status: COMPLETED`, which workers may write only after the acceptance contract is proven.

## Self-challenge and open-question ledger

At every meaningful decision boundary, completed slice, security-sensitive change, surprising result, or major milestone, the lead performs a brief adversarial reflection: what assumption could be wrong, what evidence would disprove it, and whether the work advances the real objective rather than only satisfying the current test. A material unanswered question must be recorded in `docs/OPEN_QUESTIONS.md` with a stable ID, impact, current evidence, next evidence needed, owner, and review date. Questions are not silently deleted. They move through `OPEN`, `ANSWERED`, `CLOSED`, or `SUPERSEDED`; `ANSWERED` and `CLOSED` require cited repository evidence, while `SUPERSEDED` must name the replacing question or decision. Each relevant work slice reviews the ledger and closes entries when the required evidence exists. The owner can therefore request the current open-question inventory at any time without relying on conversation memory.

Verification: `node scripts/autonomy/control-plane-tests.mjs` (8/8), `node scripts/autonomy/host-controller-tests.mjs` (6/6), `zsh scripts/autonomy/test-supervisor.sh` (7/7), and `node scripts/open-question-ledger-tests.mjs`.

## Multi-worker amendment

Each Codex iteration may use internal subagents for independent bounded work, the four-slot Qwen factory for tool-free advice/test design/review, and already-approved Claude task packets through the collaboration layer. Codex remains lead. Claude and Qwen capacity/authentication are tracked independently. A worker success never implies integration; modifying work must retain its branch/worktree/commit/evidence until Codex reviews and tests it. If Codex is capacity-limited, other workers may finish only previously approved bounded work and may not integrate or assume lead authority. See `docs/DUAL_AGENT_ARCHITECTURE.md` and `docs/LOCAL_MODEL_FACTORY.md`.
