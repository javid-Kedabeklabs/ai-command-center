# Workflow Schema

Current `schemaVersion` is 2. Required workflow fields are identity/name plus node and edge arrays. Optional canonical fields include project/environment metadata, typed ports and JSON Schemas, variables, secret references, groups, sections, subworkflows, triggers, permissions, resource/retry/timeout policies, evaluations, promotion state, plugin provenance, artifact contracts, and checkpoint policy.

`secretReferences` is a metadata-only array. Each entry is `{ id, purpose, revision?, label? }`, where `purpose` is `provider|http|mcp|plugin|generic`; legacy string IDs migrate additively. IDs are lowercase opaque names, duplicates and unknown fields are rejected, and values are never valid workflow data. An HTTP node selects a bearer reference with `data.authRef`/`data.authMode: "bearer"`. Remote MCP definitions use the same fields in the MCP registry. The resolved value exists only for the outgoing call.

Migrations are additive and idempotent. Unknown root, node, edge, and group fields survive merge/save. Future versions fail with a conflict rather than being downgraded.

Port types: `any`, `text`, `number`, `boolean`, `object`, `array`, `table`, `file`, `files`, `control`, `error`, `approval`, `artifact`, `memory`, `image`, `audio`, `video`, `code`, and `stream` (plus the migrated legacy `data` family).

Static validation occurs on save and connection. Runtime validation occurs after mapping/coercion before destination execution.

Resource policies use `settings.resources` with optional integer limits from 1–32: `maxModelCalls`, `maxSubprocesses`, `maxHttpRequests`, and `maxMcpCalls`. A node may set a stricter local ceiling with the same fields under `node.runtime.resources`. Omitted limits retain safe runtime defaults and old documents are not rewritten merely to materialize defaults.

Agent assignments will add explicit `roleCardId`, Role Card version, optional `agentInstanceId`, assignment instructions/scope, and audited overrides. Existing agent IDs and label fields remain readable. The resolver—not the saved workflow—expands referenced instructions, skills, tools, scopes, rubrics, and permission profiles. Loops, gates, retries, budgets, scheduling, health, and rollback remain workflow/runtime fields rather than agent types.
