# Feature Audit (evidence-based)

Date: 2026-07-12. Method: 22-endpoint smoke test (`scripts/smoke.sh`, all PASS) + code inspection + prior manual end-to-end verification this session. Classification per requested taxonomy.

| Feature | Status | Evidence |
|---|---|---|
| Dashboard: live RAM/disk/service meters (SSE) | VERIFIED_WORKING | `/api/system` + `/api/events`; smoke PASS, shows 512 GB, 3 services |
| Models: list/load/unload/download | VERIFIED_WORKING | `/api/models` PASS; load/unload manually verified this session |
| Chat: streaming with local model | VERIFIED_WORKING | Manually verified ("DASHBOARD CHAT WORKS") |
| Agents: CRUD | VERIFIED_WORKING | `/api/agents` PASS, 3 seeded |
| Agents: run task via OpenCode + live feed + history | VERIFIED_WORKING | Coder wrote hello.txt end-to-end; `/api/runs` PASS |
| Brain: tree/editor/preview/link-map | VERIFIED_WORKING | `/api/brain/*` PASS incl. path-traversal blocked (400) |
| Brain ↔ Obsidian shared vault | VERIFIED_WORKING | Same files; Obsidian installed |
| Studio: image gen (Flux/SDXL) via ComfyUI | VERIFIED_WORKING | 1024² PNG produced in ~30s; `/api/studio/*` PASS |
| Workflows: visual canvas (React Flow) | VERIFIED_WORKING | Content Factory ran 3-model chain end-to-end |
| Workflow node types: input/agent/orchestrator/output | VERIFIED_WORKING | Executed |
| Workflow node types: critic loop | VERIFIED_WORKING | draft→review→approve verified |
| Workflow node types: parallel+judge | VERIFIED_WORKING | 2 models → judge verified |
| Per-node model choice (local/cloud/role) | VERIFIED_WORKING | `/api/allmodels` returns 7 incl. role refs |
| Tier profiles (role→model swap) | VERIFIED_WORKING | Lite profile resolved role:worker |
| Cloud providers (add key, no leak) | VERIFIED_WORKING (untested with a real key) | `/api/providers` PASS, no key leak; add-key path not exercised with a live key |
| AI Build (model designs a workflow) | VERIFIED_WORKING | Generated valid graphs with chosen model |
| Bundle export/import | VERIFIED_WORKING | Round-trip verified; no secrets in bundle |
| Auto-start services (LaunchAgents/Daemon) | VERIFIED_WORKING | Dashboard + ComfyUI + GPU-limit daemons loaded |
| Orchestrator node (autonomous delegation) | PARTIALLY_WORKING | Runs, but reliability of local-model autonomous delegation is unproven; best-effort |
| Video generation | NOT_IMPLEMENTED | Planned; no code |
| MCP manager | NOT_IMPLEMENTED | Nav stub "SOON" only |
| Complexity modes (Easy/Guided/Pro/Developer) | NOT_IMPLEMENTED | New requirement |
| AI Architect (context-aware, diffs) | NOT_IMPLEMENTED | AI Build exists; full Architect does not |
| Onboarding / first-run | NOT_IMPLEMENTED | New |
| Template Center | PARTIALLY_WORKING | 3 example workflows exist; no template gallery/metadata |
| Preflight / Safe Run | NOT_IMPLEMENTED | New |
| Simple vs Detailed run views | PARTIALLY_WORKING | One live feed exists; no simple story view |
| Plain-language error cards | NOT_IMPLEMENTED | Raw feed only |
| SQLite persistence / durable engine | NOT_IMPLEMENTED | Currently JSON files; runs are in-memory + persisted transcripts |
| RAG / embeddings / memory scopes | NOT_IMPLEMENTED | Only the markdown AgentBrain exists |
| Evaluation laboratory | NOT_IMPLEMENTED | New |
| Skill Foundry | NOT_IMPLEMENTED | AgentBrain skills (markdown) exist; no foundry |
| Secure sandboxed code execution | PARTIALLY_WORKING | Agents run shell via OpenCode with full perms; no sandbox/limits |
| macOS Keychain secrets | NOT_IMPLEMENTED | Keys live in opencode.json (gitignored, local) |
| Creative Website Studio | NOT_IMPLEMENTED | New, very large |

## Summary
- **Working core (verified):** dashboard, models, chat, agents, brain, image studio, workflow canvas with 6 node types, tier profiles, AI-build, bundles, auto-start. This is a genuinely functional local multi-agent app.
- **Biggest gaps vs. the new vision:** complexity modes, full AI Architect, onboarding, preflight/safe-run, plain-language errors, durable engine, RAG/memory, evals, sandboxing, and the Website Studio.
- **Security note:** agents currently run with FULL permissions by default (user's earlier explicit choice) — this conflicts with new Principle #15. See SECURITY_AUDIT / open question.
