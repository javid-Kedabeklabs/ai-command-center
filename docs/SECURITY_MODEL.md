# Security Model

Trust boundaries include user input, workflow definitions, imported packages, executable nodes, local files, network/MCP services, model providers, and secrets.

Current controls:

- Loopback server binding plus a request boundary that rejects non-loopback or wrong-port Host headers, non-local Origins, and cross-site browser fetch metadata before routing. Safe GETs establish an HttpOnly `SameSite=Strict` per-process session; browser-origin mutations require that session while originless loopback CLI/internal trigger calls remain supported. Extra development origins must be explicit loopback HTTP origins. Emergency stop additionally requires an explicit intent header.
- Isolated run workspaces and cached Python environments.
- Bounded process/HTTP/MCP timeouts and process-group cancellation.
- Explicit node/workflow permission denials.
- Local-only enforcement for models, HTTP, and remote MCP.
- Plugin trust review and disabled-by-default imports.
- Production locks, audited unlocks, approvals, and emergency stop.
- Central release-visible redaction covers JSON API responses, live run events, persisted run/checkpoint records, audit writes, text artifact reads, and bundle exports. Exact Keychain/provider values are registered with the in-process redactor when stored or resolved; sensitive header/credential fields and common bearer/query credential forms are redacted. Audit-write failure is surfaced to stderr rather than silently discarded. Deterministic canary and live Keychain tests prove the resolved value is absent from canonical files and public surfaces.
- Generic workflow/tool credentials use opaque, versioned metadata in `data/secret-references.json` and values in macOS Keychain. Metadata APIs are no-store and never resolve values. HTTP and remote MCP transports resolve bearer references only at the call boundary; missing/denied references, header injection, inline credential headers, URL credentials, and legacy inline MCP credentials fail closed. Live tests prove no resolved value in canonical JSON, public APIs/exports, run evidence, audit, or MCP configuration.
- Provider child processes receive only execution-essential environment keys plus the specifically configured OpenAI/Anthropic credentials; unrelated host variables and `NODE_OPTIONS` are excluded.
- Webhook credentials use strict hash-only operational records outside workflow JSON, token-free bearer endpoints, one-time no-store disclosure, timing-safe atomic authentication/reservation, expected-generation rotation, permanent revocation, uniform delivery-auth failures, and deny-wins `receive-webhooks` permission checks. The legacy token-in-path endpoint is deprecated compatibility and is no longer emitted for new credentials.
- Collaboration task packets, protected-path validation, exclusive file scopes, independent vendor-capacity classification, structured-result validation, and secret redaction foundations.
- Agent-role composition uses referenced permission profiles and isolated resolution; migration previews preserve but explicitly flag broad legacy permissions for review.

Open controls include comprehensive network allowlists, stronger process sandboxing, signed packages, non-bearer credential schemes, symlink-safe filesystem access across every adapter, environment permission ceilings, durable approval/recovery evidence, and a full threat-model review. Non-loopback service exposure remains unsupported.

Claude Code is treated as an external powerful process. It may not receive production secrets, unrestricted home access, permission bypass, or direct primary-checkout mutation. A modifying worker requires a reviewed base, repository-scoped worktree, owned process, allowed-path diff, related commit, and Codex integration gate. Live dispatch remains deferred until those controls and fixture tests are complete.
