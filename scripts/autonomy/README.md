# Autonomous supervisor

This directory provides a bounded external supervisor for repository-managed Codex iterations. It uses the installed CLI's supported noninteractive interface: `codex exec`, JSONL events, an output-last-message file, `workspace-write`, and approval policy `never`. It deliberately does not use the sandbox-bypass flag.

Commands:

```bash
scripts/autonomy/doctor.sh
scripts/autonomy/status.sh
scripts/autonomy/resume.sh
scripts/autonomy/stop.sh
scripts/autonomy/install-launch-agent.sh
scripts/autonomy/uninstall-launch-agent.sh
```

`resume.sh` creates the durable `state/autonomy.enabled` marker and starts the supervisor. The LaunchAgent watches that marker, restarts unexpected crashes with throttling, and stays stopped after an intentional stop or completed contract. `stop.sh` removes the marker and cancels the bounded active worker. Capacity waits are interruptible. Every Codex iteration has a hard timeout and must write fresh continuation state containing its exact iteration ID. Three identical failures require a user decision.

Codex remains the lead and integration authority. Bounded Codex subagents, the read-only Qwen factory, and isolated Fable workers may accelerate independent work. Qwen/Fable output never integrates automatically.

Review `docs/AUTONOMOUS_EXECUTION.md` before enabling unattended operation.
