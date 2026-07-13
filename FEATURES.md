# AI Command Center — Technical Feature Specification

## 0. Purpose of this document
This describes a **locally-hosted, multi-engine AI operations platform** ("AI Command Center") running on a single Mac. It is a working system, not a proposal. Use this doc to (a) understand every implemented feature, (b) test them, and (c) propose additional features to make it a complete, sellable product. A "gaps & candidate features" section is included at the end to guide extension.

---

## 1. System overview

The Command Center is a **web dashboard** (browser UI at `http://localhost:1717`) that orchestrates three local AI engines. Everything runs **100% on-device** — no cloud dependency unless the user explicitly adds a cloud API key. Target machine: **Apple Mac Studio, M3 Ultra, 512 GB unified memory** (GPU wired-memory limit raised to 480 GB).

```
Browser UI (React) ──HTTP/SSE──> Node/Express server (localhost:1717)
                                     ├─> LM Studio   (LLMs)          localhost:1234  (OpenAI-compatible /v1 + native /api/v0)
                                     ├─> OpenCode    (agent runtime) CLI: `opencode run`
                                     └─> ComfyUI     (image gen)     localhost:8188
```

All three engines + the dashboard **auto-start at login** via macOS LaunchAgents/LaunchDaemons and self-restart on crash (KeepAlive).

---

## 2. Technology stack

- **Backend:** Node.js 26, Express, single file `server/index.js`. Server-Sent Events (SSE) for all live updates. No database — JSON files on disk.
- **Frontend:** Vite + React 18 + TypeScript. React Flow (`@xyflow/react`) for the node canvas. `marked` for markdown. Single-page app, dark "mission-control" theme.
- **LLM serving:** LM Studio (MLX engine, Apple-Silicon-native) + `lms` CLI.
- **Agent runtime:** OpenCode (terminal agent: reads/writes files, runs shell commands, delegates to subagents).
- **Image gen:** ComfyUI (PyTorch MPS backend) with an API-format workflow builder.
- **Project location:** `~/command-center` (git repo). Vault: `~/AgentBrain`. Agent workspaces: `~/agents-workspace`. Image models: `~/ComfyUI/models/checkpoints`.

---

## 3. The three engines

### 3.1 LM Studio (LLMs)
- OpenAI-compatible endpoint `http://localhost:1234/v1` (chat completions, streaming) + native REST `http://localhost:1234/api/v0/models` (returns per-model `state: loaded|not-loaded`, `max_context_length`, etc.).
- Models are MLX-quantized. Loaded/unloaded on demand via `lms` CLI. Only a subset resident in RAM at once.
- Installed models (examples): `qwen/qwen3-coder-30b`, `qwen/qwen3-30b-a3b-2507`, `openai/gpt-oss-20b`, plus larger ones downloading (`qwen3-235b`, `glm-4.6`, `qwen3-coder-480b`, `deepseek-v3.1`).

### 3.2 OpenCode (agent runtime)
- Executes agents headlessly: `opencode run "<task>" --agent <name>` or `--model <ref>`.
- Model refs are provider-prefixed: `lmstudio/<id>` (local), `anthropic/<id>`, `openai/<id>` (cloud).
- Agents are markdown files at `~/.config/opencode/agent/cc-*.md` with front-matter (model, permissions) + a system prompt body.
- Permissions per agent set to `allow` for edit/bash/webfetch/external_directory (full machine access — this is a dedicated agent machine with no personal data).
- Native subagent support (delegation) exists and is used by the "orchestrator" node type.

### 3.3 ComfyUI (image generation)
- HTTP API at `http://localhost:8188`: `POST /prompt` (submit workflow), `GET /history/{id}` (results), `GET /view` (image bytes), `GET /system_stats`.
- Server builds API-format workflows parameterized by model family (Flux vs SDXL) — CheckpointLoader → CLIP encode → KSampler → VAE decode → SaveImage.
- Image models: `flux1-schnell-fp8` (fast, 4-step), `juggernaut-xl-v9` (SDXL, uncensored), `flux1-dev-fp8` (quality). Uncensored by design (no content filter).

---

## 4. Feature catalog (by dashboard page)

### 4.1 Dashboard
- Live meters (updated every 2.5s via SSE): **RAM used/total**, **disk free/total**, count of **loaded vs on-disk models**, **active agent/workflow runs**.
- **Service health** row: LM Studio, OpenCode, ComfyUI — online/offline with endpoint.
- **Loaded-in-memory** list (model id + context length). **Active downloads** with % progress.

### 4.2 Models
- Lists every local model with state dot (● loaded / ○ on disk / ⬇ downloading), arch, quantization, max context.
- **Load** a model (choose context window: 32k / 128k / 256k) with full GPU offload; **Unload**; **Download new** model by typing its repo name (streams progress).
- Backed by `lms` CLI (`load`/`unload`/`get`) + LM Studio `/api/v0`.

### 4.3 Chat
- ChatGPT-style streaming chat with any local model. Model picker (● loaded = instant, ○ = loads on first message). Markdown rendering. Clear-conversation.
- Streams token deltas from LM Studio `/v1/chat/completions` proxied through the server.

### 4.4 Agents
- **CRUD agents**: emoji avatar, name, model (local/cloud), role/system prompt, working folder.
- Each agent is mirrored to a native OpenCode agent file (role prompt in system slot, full permissions).
- **Run a task**: type plain-English task → agent executes via OpenCode (writes files, runs commands, self-corrects) → **live activity feed** (SSE) shows every step → **run history** with persisted transcripts.
- Auto-loads the agent's local model with ≥64k context before running (agents need large context; OpenCode's system prompt overflows small windows).
- Seeded agents: 🛠 Coder, 🧠 Reasoner, ⚡ Quick.
- All agents share the **AgentBrain** (see 4.5) — instructed to follow rules, use skills, and record learnings.

### 4.5 Brain (AgentBrain — shared knowledge vault)
- Plain-markdown vault at `~/AgentBrain` with four sections: **00-Rules** (behavior laws), **10-Skills** (how-to playbooks), **20-Knowledge** (facts), **30-Memory** (agent-written learnings, one file per agent).
- Dashboard page = **file tree + editor + markdown preview + link map**. Link map is an SVG graph: nodes grouped by section, edges = `[[wikilink]]` references parsed server-side.
- Create/edit/delete files. Path-traversal protected (only `.md` inside the vault).
- Same files are editable in **Obsidian** (installed) — two windows onto one dataset; edits apply to the next agent run with no restart.
- Agents both **read** (rules/skills via `~/.config/opencode/AGENTS.md`) and **write** (append to `30-Memory/<agent>.md`).

### 4.6 Studio (image generation)
- Model switcher (⚡ Flux / 🎨 SDXL), **prompt**, **negative prompt** (SDXL only), **size** (square/portrait/landscape), **steps** (auto per model or manual).
- Generate → polls ComfyUI → displays image → **gallery** of recent generations (click to reopen).
- ~30s per 1024×1024 image on MPS (incl. first-run model load). Uncensored.

### 4.7 Workflows (Workflow Studio — visual orchestration)
The core orchestration engine. A **drag-and-drop node canvas** (React Flow) that runs multi-agent pipelines.

**Node types:**
- **Input** — workflow entry (holds the run input).
- **Agent** — one bounded step: pick a model (local/cloud/role), write an instruction template.
- **Orchestrator** — an agent given a goal + allowed to decompose and delegate to OpenCode subagents (autonomous mode).
- **Critic** — worker↔reviewer loop: worker drafts → reviewer critiques → worker revises → repeats until reviewer replies "APPROVED" or `maxIters` reached. Separate worker & reviewer models.
- **Parallel** — runs the instruction across N models simultaneously (conceptually), then a **judge** model merges/selects the best answer.
- **Output** — collects the final result.

**Instruction templating:** `{{input}}` = workflow input; `{{nodeId}}` = an upstream node's output. Nodes wired by edges; execution is **topological** (Kahn's algorithm). A **shared workspace** per run (`~/agents-workspace/pipelines/<runId>/`) acts as a filesystem data bus so steps can pass files, not just text.

**Live run:** each node lights up by status (queued→running→done/failed) via SSE; a text feed shows every step. Runs are persisted with a final result.

**Per-step model choice:** every agent/critic/parallel node independently uses a **local model, a cloud model, or a role** (see tier profiles). Local and cloud can be mixed in one workflow.

**AI Build (✨):** describe a goal in plain English → a local model designs the whole node/edge graph (auto-laid-out) → loads into the canvas for review/edit/save.

**Tier profiles (🎚):** a profile maps abstract **roles** (`planner`, `worker`, `reviewer`, `cheap`) → concrete models. Nodes can reference `role:worker` instead of a fixed model. Selecting a tier at run time (e.g. Premium vs Lite) swaps every role-bound node's model at once — build once, deploy at any power/cost level. Editable in a Tiers modal. Seeded: "Premium (big local)", "Lite (fast/small)".

**Cloud providers (☁️):** add Anthropic/OpenAI API keys in a modal → cloud models (Claude, GPT) become selectable in every model dropdown. Keys are written only into OpenCode's config, never returned to the browser or included in exports.

**Bundle export/import (⬇/⬆):** export the entire setup — agents + workflows + AgentBrain + tier profiles (NOT keys) — as one portable JSON file. Import recreates it on another machine. This is the "portable company / company-in-a-box" primitive.

---

## 5. Data & storage (no database — JSON + files)
- `~/command-center/data/agents.json` — agent definitions.
- `~/command-center/data/workflows/*.json` — workflow graphs `{id, name, nodes[], edges[]}`.
- `~/command-center/data/profiles.json` — tier profiles `{id, name, roles{}}`.
- `~/command-center/data/providers.json` — which cloud providers are configured (names only).
- `~/command-center/data/runs/*.json` — persisted run transcripts (agents + workflows).
- `~/AgentBrain/**/*.md` — the shared brain.
- `~/.config/opencode/opencode.json` — model providers (incl. cloud API keys) + agent config.
- `~/.config/opencode/agent/cc-*.md` — generated agent files.

---

## 6. Complete API reference (server, localhost:1717)

**System / live**
- `GET /api/system` — RAM, disk, service health, loaded models, active runs, downloads.
- `GET /api/events` — SSE stream of the above (every 2.5s).

**Models (LLM)**
- `GET /api/models` — local models with state.
- `POST /api/models/load` `{id, context}` · `POST /api/models/unload` `{id}` · `POST /api/models/download` `{name}`.

**Chat**
- `POST /api/chat` `{model, messages[]}` — streaming text response.

**Agents**
- `GET /api/agents` · `POST /api/agents` (create/update) · `DELETE /api/agents/:id`.
- `POST /api/agents/:id/run` `{task}` → `{runId}`.
- `GET /api/runs/:id/events` (SSE) · `POST /api/runs/:id/stop` · `GET /api/runs`.

**Brain**
- `GET /api/brain/tree` · `GET /api/brain/file?path=` · `POST /api/brain/file` `{path, content}` · `DELETE /api/brain/file?path=` · `GET /api/brain/graph` (nodes + wikilink edges).

**Studio (image)**
- `GET /api/studio/models` · `POST /api/studio/generate` `{model, prompt, negative, width, height, steps}` → `{promptId}` · `GET /api/studio/result/:id` · `GET /api/studio/image?filename=&subfolder=&type=` · `GET /api/studio/gallery`.

**Providers (cloud)**
- `GET /api/providers` (no keys) · `POST /api/providers` `{provider, apiKey}` · `DELETE /api/providers/:name`.
- `GET /api/allmodels` — unified list: local + configured cloud + role refs, each `{ref, provider, label, kind}`.

**Tier profiles**
- `GET /api/profiles` → `{profiles[], roles[]}` · `POST /api/profiles` · `DELETE /api/profiles/:id`.

**Workflows**
- `GET /api/workflows` · `GET /api/workflows/:id` · `POST /api/workflows` · `DELETE /api/workflows/:id`.
- `POST /api/workflows/:id/run` `{input, profileId?}` → `{runId}`.
- `GET /api/workflows/runs/:runId/events` (SSE, per-node events).
- `POST /api/workflows/generate` `{goal}` → a designed workflow graph.

**Bundles**
- `GET /api/bundle/export` (downloadable JSON) · `POST /api/bundle/import` `{bundle}` → `{summary}`.

---

## 7. Security / permissions model
- Server binds to `127.0.0.1` only (not exposed to network). No auth (single-user local).
- Agents run with **full machine access** (file + shell) — intentional; this is a dedicated agent machine with no personal data. `sudo` is the hard limit (no password automation).
- Path-traversal protection on Brain file APIs (`.md` only, inside vault).
- Cloud API keys stored only in OpenCode config; never returned by any read endpoint; excluded from bundle exports.

---

## 8. Known limitations & gotchas (important for testing)
- **gpt-oss-20b cannot drive OpenCode tools** (its tool format is incompatible) — fine for plain Chat, unreliable as an Agent/Workflow executor. Use Qwen models for agents.
- **Local models are unreliable as fully-autonomous orchestrators** — they drift/loop. Deterministic pipelines are the reliable path; the Orchestrator node is opt-in and best-effort.
- **Video generation is not implemented** (planned via ComfyUI + LTX-Video/Wan; slow on Mac/MPS — compute-bound, not memory-bound).
- **Parallel node runs local branches sequentially** (LM Studio loads one model at a time), so "parallel" over local models thrashes model load/unload; genuinely parallel only across cloud models.
- **Cloud model catalogs are curated static lists** in the server (not fetched live); model IDs may need updating.
- **No token/cost accounting, no auth, no multi-tenancy, no scheduling.**
- **Process/port note:** orphaned Node processes can hold `:1717` across restarts and serve stale code; the fix is to kill the port owner and reload the LaunchAgent.
- **Agents need ≥64k context** to run; the server auto-loads local models accordingly (adds latency on first use of a model).

---

## 9. Gaps & candidate features (for the next AI to consider)
Grouped by theme; these are NOT yet implemented.

**Orchestration**
- Conditional/branching nodes (if/else, routing by model output), loops with exit conditions, human-in-the-loop approval nodes, scheduled/triggered runs (cron, webhook, file-watch), retry/back-off per node, timeouts, cancellation of in-flight workflow runs.
- Sub-workflow nodes (a workflow used as a node in another).
- Streaming node outputs (token-level) to the canvas.

**Models & RAG**
- Embeddings + vector store + retrieval nodes (RAG); document ingestion.
- Vision/multimodal model support in Chat/Agents (image input).
- Speculative decoding / model scheduler to keep several small models hot for true parallelism.
- Live-fetched cloud model catalogs; more providers (OpenRouter, Groq, local Ollama).

**Media**
- Video generation (LTX-Video/Wan), audio/TTS/voice, image-to-image / inpaint / upscale nodes, ControlNet/LoRA management in Studio.

**Product / sellability**
- Auth + multi-user/multi-tenant, role-based access.
- Cost & token/usage dashboards, per-run analytics, observability/tracing/logs UI.
- Bundle marketplace / templated "company" packs per vertical (support desk, content agency, research desk).
- One-click deploy/installer, licensing, update mechanism.
- MCP (Model Context Protocol) server manager — connect external tools/data sources to agents.
- Browser automation for agents (controlled Chrome: browse/click/fill).
- Secrets management UI, encrypted key storage.
- Versioning/history for workflows and brain (git-backed), diff/rollback.
- Export runs as reports; notifications (email/Slack) on completion.

---

## 10. How to run & test
- **Open:** `http://localhost:1717` (auto-starts at login; Desktop launcher "Start Command Center" as fallback).
- **Smoke tests (curl):**
  - `GET /api/system` — should show 512 GB RAM, services online.
  - `POST /api/agents/coder/run {"task":"create hello.txt containing WORKS"}` then poll `GET /api/runs/:id/events` — file should appear in `~/agents-workspace/coder/`.
  - `POST /api/workflows/content-factory/run {"input":"a topic"}` — 3-model pipeline produces an article.
  - `POST /api/workflows/generate {"goal":"..."}` — returns a designed graph.
  - `POST /api/studio/generate {"model":"flux1-schnell-fp8.safetensors","prompt":"..."}` then poll result — returns a PNG.
  - `GET /api/bundle/export` — full portable bundle, contains no API keys.
- **Example workflows preloaded:** "Content Factory" (pipeline), "Critic Test" (critic loop), "Parallel Test" (parallel-judge).

---
*Everything above is implemented and verified end-to-end on the target machine unless explicitly marked "not implemented" or in the gaps section.*
