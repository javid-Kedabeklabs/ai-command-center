# API Reference

Core route groups currently include:

- `/api/workflows`, versions, run, promote, unlock, and typed connection preview.
- `/api/runs`, detail, events, pause, resume, stop, and artifacts.
- `/api/tools/mcp`, discovery, update, and deletion.
- `/api/secret-references` for metadata-only Keychain credential references, rotation, usage, and deletion.
- `/api/triggers`, history, test, secure webhook delivery, and workflow trigger creation.
- `/api/custom-nodes` and `/api/plugins` including trust review and enable/disable.
- `/api/evaluations` and `/api/learning`.
- `/api/company-world/state` for the real operational projection.
- `/api/agents`, models, profiles, knowledge, skills, templates, audit, and system state.

Errors use JSON `{ "error": "plain-language message" }` where practical. This file is a living overview; an OpenAPI document remains planned.

Webhook creation returns `webhookToken` plus a token-free `webhookEndpoint` once with `Cache-Control: no-store`. New deliveries call `POST /api/triggers/webhook/:id` with `Authorization: Bearer <token>` and a bounded `Idempotency-Key`; the legacy token-in-path route remains accepted only for compatibility and is marked deprecated. `POST /api/triggers/:id/webhook-secret/rotate` requires JSON, `X-Command-Center-Intent: webhook-credential-change`, `Idempotency-Key`, and the current `expectedRevision`. It returns a replacement token once; an idempotent replay never rediscloses it. `POST /api/triggers/:id/webhook-secret/revoke` permanently removes operational authority. Trigger lists expose only `webhookCredentialStatus` and `secretRevision`, never token or hash material. Rotation/revocation is generation-guarded, lock-aware, `receive-webhooks` permission-aware, restart-persistent, and immediately rejects new old-token admissions; already authenticated work may finish.

Secret-reference reads return metadata only (`id`, label, revision, configured/status, store, usage count) with `Cache-Control: no-store`. `POST /api/secret-references`, `PUT /api/secret-references/:id/value`, and `DELETE /api/secret-references/:id` require JSON plus `X-Command-Center-Intent: secret-reference-change`; rotation and deletion require `expectedRevision`, and deletion returns 409 while a workflow or MCP server still uses the reference. Credential values are written to macOS Keychain and are never returned. HTTP nodes and remote MCP servers support bearer `authRef`; resolution occurs immediately before transport. Inline credential headers, URL userinfo, secret-named query parameters, MCP environment values, and MCP authorization fields fail closed.
