# MCP Integration

Register MCP servers in the Tool Control Center or through `POST /api/tools/mcp`. IDs use letters, numbers, dots, underscores, and hyphens. Duplicate IDs return a conflict and never overwrite an existing definition. Local stdio and remote Streamable HTTP transports support initialize, `tools/list`, and `tools/call`. Use discovery before configuring an MCP workflow node.

New local commands are created disabled and untrusted. Review the exact launch command, then explicitly approve it through the Tool Control Center or `PUT /api/tools/mcp/:id` with `{ "reviewed": true, "enabled": true }`. Editing a local executable definition returns it to review. Legacy enabled local definitions retain their behavior with an explicit `trusted-legacy` migration marker.

Stdio children receive only `HOME`, `PATH`, `TMPDIR`, locale/system path keys when present, plus `COMMAND_CENTER_MCP` and `COMMAND_CENTER_MCP_SERVER_ID`. The parent process environment, provider keys, tokens, cookies, passwords, and arbitrary configured environment values are not forwarded. New definitions reject inline credentials and environment blocks; use opaque authentication references rather than workflow values.

Discovery stores only bounded, redacted tool names, descriptions, input schemas, enabled state, and server/version/transport provenance. Server `scopes.allowTools`/`denyTools` and workflow or node `mcpServers`, `mcpTools`, `denyMcpServers`, and `denyMcpTools` compose deny-wins with the existing `tools` permission and local-only policy.

Calls use bounded timeouts and cancellation, reject malformed frames, and normalize transport/HTTP/protocol/server errors. Run evidence contains only server ID, tool name, status, normalized redacted error metadata, and timestamps. Arguments, auth headers, raw secret values, and unrestricted tool output are excluded from evidence. Deterministic fixtures live in `scripts/fixtures/`.
