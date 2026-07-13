# Security Model

Trust boundaries include user input, workflow definitions, imported packages, executable nodes, local files, network/MCP services, model providers, and secrets.

Current controls:

- Loopback server binding and path traversal guards.
- Isolated run workspaces and cached Python environments.
- Bounded process/HTTP/MCP timeouts and process-group cancellation.
- Explicit node/workflow permission denials.
- Local-only enforcement for models, HTTP, and remote MCP.
- Plugin trust review and disabled-by-default imports.
- Production locks, audited unlocks, approvals, and emergency stop.
- Secret-leak smoke checks and secret references in the schema.
- Generic workflow/tool credentials use opaque, versioned metadata in `data/secret-references.json` and values in macOS Keychain. Metadata APIs are no-store and never resolve values. HTTP and remote MCP transports resolve bearer references only at the call boundary; missing/denied references, header injection, inline credential headers, URL credentials, and legacy inline MCP credentials fail closed. Live tests prove no resolved value in canonical JSON, public APIs/exports, run evidence, audit, or MCP configuration.
- Provider child processes receive only execution-essential environment keys plus the specifically configured OpenAI/Anthropic credentials; unrelated host variables and `NODE_OPTIONS` are excluded.
- Webhook credentials use strict hash-only operational records outside workflow JSON, token-free bearer endpoints, one-time no-store disclosure, timing-safe atomic authentication/reservation, expected-generation rotation, permanent revocation, uniform delivery-auth failures, and deny-wins `receive-webhooks` permission checks. The legacy token-in-path endpoint is deprecated compatibility and is no longer emitted for new credentials.
- Collaboration task packets, protected-path validation, exclusive file scopes, independent vendor-capacity classification, structured-result validation, and secret redaction foundations.
- Agent-role composition uses referenced permission profiles and isolated resolution; migration previews preserve but explicitly flag broad legacy permissions for review.

Open controls include comprehensive network allowlists, stronger process sandboxing, signed packages, CSRF/session protection if non-loopback access is introduced, non-bearer credential schemes, and a full threat-model review.

Claude Code is treated as an external powerful process. It may not receive production secrets, unrestricted home access, permission bypass, or direct primary-checkout mutation. A modifying worker requires a reviewed base, repository-scoped worktree, owned process, allowed-path diff, related commit, and Codex integration gate. Live dispatch remains deferred until those controls and fixture tests are complete.
