# Operations

The service binds to `127.0.0.1:1717`. Check health with `curl http://127.0.0.1:1717/api/system`. This machine may use launchd label `com.local.commandcenter`; inspect rather than assuming it exists.

Use `scripts/autonomy/status.sh`, `stop.sh`, `resume.sh`, and `doctor.sh` for the Codex implementation supervisor. `resume.sh` creates the `state/autonomy.enabled` marker watched by launchd; `stop.sh` removes it and interrupts bounded work/backoff. Runtime logs live under `logs/autonomy/`, are private and retention-bounded; application state lives under `data/` and must be backed up before migrations.

Emergency stop is available in the UI and at `POST /api/killall`. Do not expose the current unauthenticated local service to a network.

The future collaboration runner has separate status/stop/doctor/cleanup controls under `scripts/collaboration/`. Until those fixture-tested controls and a reviewed clean base exist, do not launch a modifying Claude worktree from the current dirty checkout. Never terminate unrelated interactive Codex or Claude processes; only registered owned process groups may be cancelled.
