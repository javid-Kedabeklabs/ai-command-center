# Operations

The service binds to `127.0.0.1:1717`. Check health with `curl http://127.0.0.1:1717/api/system`. A packaged installation uses launchd label `com.local.commandcenter`; inspect rather than assuming it exists. Install, inspect, or remove that owned service with `npm run service -- install <install-root>`, `npm run service -- status`, and `npm run service -- uninstall`.

Packaged releases keep immutable code under `<install-root>/releases`, atomically select it through `<install-root>/current`, and keep authoritative state separately under `<install-root>/data`. Stop the service before install, upgrade, restore, or rollback. Every upgrade creates a hash-verified pre-upgrade backup and receipt. See `docs/BACKUP_AND_RESTORE.md` for exact commands and recovery semantics.

Use `scripts/autonomy/status.sh`, `stop.sh`, `resume.sh`, and `doctor.sh` for the Codex implementation supervisor. `resume.sh` creates the `state/autonomy.enabled` marker watched by launchd; `stop.sh` removes it and interrupts bounded work/backoff. Runtime logs live under `logs/autonomy/`, are private and retention-bounded; application state lives under `data/` and must be backed up before migrations.

Emergency stop is available in the UI and at `POST /api/killall`. The product listener remains loopback-only. Optional external APIs, MCP servers, webhooks, and model services are outbound or separately authenticated capabilities; local-first does not mean offline-only and does not authorize exposing the product listener to a network.

The future collaboration runner has separate status/stop/doctor/cleanup controls under `scripts/collaboration/`. Until those fixture-tested controls and a reviewed clean base exist, do not launch a modifying Claude worktree from the current dirty checkout. Never terminate unrelated interactive Codex or Claude processes; only registered owned process groups may be cancelled.
