# AI Command Center — Session Handoff & Project Map

> **Read this first.** Last updated 2026-07-13 after the autonomous implementation contract checkpoint. The contract and evidence in `docs/MASTER_PLAN.md`, `docs/IMPLEMENTATION_STATUS.md`, and `state/last-run-summary.md` supersede older completion claims later in this historical handoff.

## Current contract checkpoint

- Phases 0–3 are verified. Phases 4–10 have substantial, focused-test-backed slices but remain incomplete. Phases 11–14 remain open.
- Current focused evidence: schema 9/9, ports 5/5, comments 10/10, component manifests 10/10, scheduler 5/5, per-run resources 5/5, process-global model scheduling 8/8, reusable components 9/9, runtime recovery 36/36, MCP registry/client 12/12 plus live transports 4/4, Keychain secret registry/API/runtime/live 4/4 + 5/5 + 5/5 + 5/5, provider environment 1/1, durable trigger store 17/17, deterministic schedules 13/13, live trigger API 10/10, folder foundation 9/9, folder service 2/2, real folder two-restart recovery 5/5, security 4/4, smoke 30/30, atomic persistence 6/6, and multi-trigger manager helpers/API 6/6. The integrated browser/Axe gate covers all four complexity modes and every persisted trigger state and passed 90/90 repeated runs. Phase 5 is verified. The additive exact lifecycle core now passes 16 pure lifecycle checks, 2 live lifecycle checks, immutable evidence 7/7, exact evaluation 9/9, import 4/4, security 4/4, Phase 0 contract 37/37, live secret references 5/5, trigger store 17/17, reusable components 9/9, smoke 30/30, TypeScript, and production build on isolated state. Host receipt `host-b532365979b0ff78` completed with HTTP 200; the integrated host service still requires a final post-commit reload and verification.
- Three additive execution/agent amendments are active: Codex-lead/Claude-worker collaboration (`docs/DUAL_AGENT_ARCHITECTURE.md`), the controlled local Qwen factory (`docs/LOCAL_MODEL_FACTORY.md`), and Agent Primitives/Role Cards (`docs/AGENT_ROLE_MAPPING.md`). The semantic autonomy/host controller passes 8/8 + 6/6 + supervisor 7/7. Collaboration foundations pass 22/22, runner/provenance 11/11, state/process 10/10, and worktree/integration 7/7. The first real modifying Fable pilot was scope-clean, tested, built, reviewed, and integrated. The local factory passes 14/14 plus API 1/1 and now mechanically verifies exact source citations; the current model benchmark baseline is recorded. Role Card foundations pass 12/12. Legacy-agent migration has not occurred.
- Real additions include schema v2, typed ports, graph parallelism, checkpoints/resume/retry/cancellation, nested subworkflows, persistent nested groups with cycle-safe authoring, recursive collapse/disable/run behavior, inherited subworkflow resource/permission/local-only ceilings with bounded depth, non-escalating retry/recovery reconstruction, parent cancellation/pause propagation, exact version-pinned child snapshots with explicit UI advancement, a redacted reusable-component catalog with pinned insertion and dependency-safe lifecycle actions, persistent non-executable canvas comments with semantic anchors and resolution, and deterministic dependency-aware component manifests with quarantined review/import, plus executable MCP with a validated registry, review-gated local servers, minimal stdio environments, scoped tools, redacted discovery/evidence, persistent triggers, custom-node wizard, plugin trust enforcement, Evaluation Lab/promotion gates, and Level 1 Company World Operations Map.
- Safe default is scoped `standard` agent permissions. Full access must be explicit. Imported executable packages install disabled and untrusted. Generic HTTP/MCP credentials and provider API keys use macOS Keychain; only opaque names persist, and provider children receive a minimal environment.
- Level 2/3 Company World, cinematic 3D, SQLite event storage, complete packaging, and final hardening are not complete. Process-global FIFO model concurrency and optional explicit-memory estimates are implemented and host-verified across workflow, agent, chat, direct model, and embedding calls; unknown estimates remain concurrency-only. Provider API keys use macOS Keychain and are injected only into child-process environments.

---

## 0. TL;DR — what this is

**AI Command Center** = a local-first "AI company operating system" running entirely on a **Mac Studio M3 Ultra, 512 GB RAM**. It's a web dashboard at **http://localhost:1717** that orchestrates local LLMs, autonomous coding agents, visual multi-agent workflows, a knowledge base (RAG), and local **image + video generation** — all on-device, no cloud required (cloud is optional).

The product is local-first and cloud-optional. Do not assume the machine contains no sensitive data. Use least privilege; unrestricted access is an explicit owner choice, never the product default.

---

## 1. Folder map (where everything lives)

### The dashboard app — `~/command-center/` (git repo)
```
~/command-center/
  server/index.js         # main Node/Express host; incremental modules now live under server/workflows, runtime, and triggers
  web/
    index.html
    src/
      App.tsx             # application shell + non-workflow pages (React)
      WorkflowStudio.tsx  # Workflow Studio v2 workspace and canvas UI
      api.ts              # typed API client + SSE helpers
      styles.css          # dark "mission-control" theme
      main.tsx
  dist/                   # built frontend (vite build output; server serves this)
  data/                   # JSON persistence (NO database — see §5)
    agents.json           # agent definitions
    workflows/*.json      # workflow graphs {id,name,nodes,edges}
    profiles.json         # tier profiles (role->model)
    providers.json        # which cloud providers are configured (NO keys; values live in macOS Keychain)
    runs/*.json           # persisted run transcripts (agent + workflow)
    knowledge/*.json      # RAG sources: {id,name,chunks:[{text,embedding[768]}]}
    audit.log             # governance audit trail (JSONL)
    server.log            # server stdout (from the LaunchAgent)
  docs/                   # architecture/audit/status docs
  scripts/
    smoke.sh              # 30 API/runtime smoke tests — run after any change
    verify_image_model.py # reads the model name embedded in a ComfyUI PNG (traceability)
  package.json  vite.config.ts  tsconfig.json
  FEATURES.md             # full feature spec (also copied to docs/CURRENT_ARCHITECTURE.md)
  HANDOFF.md              # THIS FILE
```

### Related data locations (outside the repo)
```
~/AgentBrain/                     # shared agent knowledge vault (plain markdown; Obsidian-compatible)
    00-Rules/ 10-Skills/ 20-Knowledge/ 30-Memory/
~/agents-workspace/               # agents' working folders + workflow run workspaces
    <agent-id>/                   # each agent's sandbox
    pipelines/<runId>/            # per-workflow-run shared workspace (files = the data bus)
~/.config/opencode/
    opencode.json                 # provider metadata and MCP servers (provider API-key values are not stored here)
    agent/cc-*.md                 # generated OpenCode agent files (one per dashboard agent)
    AGENTS.md                     # global instruction: agents follow ~/AgentBrain
~/ComfyUI/models/
    checkpoints/                  # image models (.safetensors) — see §6
    diffusion_models/             # chroma UNET (symlink), other UNET-only models
    text_encoders/                # t5xxl_fp8_e4m3fn, clip_l  (Flux/Chroma need these)
    vae/                          # flux-ae.safetensors
~/.lmstudio/models/               # local LLMs (MLX). DeepSeek-R1 downloading here.
~/.civitai_token                  # Civitai API key (perms 600; used for gated model downloads)
~/command-center-backups/         # timestamped backups of repo+data
~/local-ai-cheatsheet.md          # quick command reference for the local AI stack
~/Desktop/Start Command Center.command  # double-click launcher (fallback)
```

---

## 2. The three engines (backends the dashboard drives)

| Engine | What | Endpoint / entry | Auto-start |
|---|---|---|---|
| **LM Studio** | Local LLMs (MLX) + embeddings | `http://localhost:1234` (OpenAI `/v1` + native `/api/v0`); `lms` CLI at `~/.lmstudio/bin` | app |
| **OpenCode** | Agent runtime (files/shell/subagents) | CLI `opencode run --agent cc-<id>` / `--model <ref>` | n/a |
| **ComfyUI** | Image + video generation | `http://localhost:8188` | LaunchAgent `com.local.comfyui` |
| **Command Center** | The dashboard itself | `http://localhost:1717` | LaunchAgent `com.local.commandcenter` |

Also: GPU memory unlocked to 480 GB via LaunchDaemon `com.local.gpumem` (`iogpu.wired_limit_mb=491520`).

**Restart the dashboard after backend edits:** `launchctl kickstart -k gui/$(id -u)/com.local.commandcenter`
(If stale code serves / port stuck: `lsof -ti tcp:1717 | xargs kill -9` then `launchctl kickstart`.)

---

## 3. What was built (the journey)

Starting point was a bare Mac. Built in order:
1. **Local LLM stack** — Homebrew, LM Studio + MLX, `lms` CLI, GPU-limit unlock, OpenCode + Aider agentic CLIs, downloaded starter LLMs.
2. **AI Command Center dashboard** — Dashboard, Models, Chat, Agents, Brain pages; 3 auto-start services.
3. **Image Studio** — ComfyUI + Flux/SDXL image generation.
4. **Workflow Studio** — React Flow visual multi-agent canvas; node types input/agent/orchestrator/critic/parallel/output; per-node model choice; tier profiles; AI-build; cloud providers; bundle export/import.
5. **Product transformation (30-part spec, scoped by architect judgment)** — Phases:
   - **0** Audit/backup/smoke/baseline
   - **1** Complexity modes (Easy/Guided/Pro/Developer) + Home/AI-Overview + adaptive nav + canvas UX + progressive inspectors
   - **2** AI Architect (context-aware, reversible change diffs)
   - **3** Preflight + Safe Run
   - **4** Simple vs Detailed run views + plain-language error cards
   - **5** Template Center + onboarding + scoped Website Builder template
   - **6** Run Center + Artifact Center + pause/resume/cancel
   - **7** Model Policies (Fast/Balanced/Premium/Local-only)
   - **8** Knowledge & Memory (RAG: ingest/embed/search + Search node)
   - **9** Tools & MCP registry
   - **10** Security & Governance (per-agent permission presets, 🛑 emergency stop, audit log)
   - **11** Evaluations (deterministic Check node)
   - **12** UX polish (⌘K command palette, canvas undo/redo)
   - **14** Durability slice (persist-at-start + restart reconcile → "interrupted")
   - **15** Skills Library (attach playbooks to agents)
   - **16** Local **video generation** (LTXV) — verified
   - Historical deferrals are no longer final decisions. The current contract requires evidence-driven persistence evolution, checkpoint recovery, and controlled learning; see the master plan.
6. **Creative model stack** — many uncensored image models + video model (see §6).
7. **Workflow Studio v2** — rebuilt the workflow experience around the five-region blueprint: command bar, intent-searchable node library, infinite canvas/Easy outcome view, five-step Guided builder, progressive inspector, dockable AI Architect with visible diffs, and resizable tabbed execution panel. Twenty-three runtime primitives now cover agents, bounded loops/maps, decisions, approvals, Python/shell/JSON, file/folder/PDF ingestion, Obsidian read/write, HTTP, validation, and output; broader catalog items are visibly marked PLANNED rather than faked. Added named layouts, workflow settings/variables, local-only and duration enforcement, context limits, retries, checkpoints, automatic version history/restore, skill attachment, and the 16-node Premium 3D Website Studio template.

**Workflow runner correctness hardening (same v2 pass):** workflow schemas and IDs are validated; cycles and unsupported node types are rejected; unknown nodes no longer silently execute as agents; failed OpenCode subprocesses, searches, and quality gates now fail the run instead of allowing a false completion; new workflow names no longer overwrite an existing workflow. `scripts/smoke.sh` now deletes the exact temporary workflow ID returned by the API (the prior test leaked `-smoke-tmp.json`).

Every phase: built → tested → `scripts/smoke.sh`. Current suite: 30/30. Git tags: `baseline-v0`, `spine-v1`, `platform-v2`, `platform-v3`.

---

## 4. Feature surface (what the dashboard does today)

Pages (nav adapts to complexity mode): **Home** (NL command box + status), **Templates**, **Workflows** (visual canvas + AI Architect + preflight + run views), **Studio** (🖼 Image / 🎬 Video), **Runs** (Run Center), **Results** (Artifact Center), **Knowledge** (RAG), **Skills**, **Agents**, **Agent Rules** (AgentBrain), **Models**, **Chat**, **System** (meters + audit), **Tools** (MCP).

Complexity modes are **presentation-only** — the same canonical workflow powers all modes; switching never alters logic. `useMode()` + `<AtLeast mode="pro">` gate UI in `App.tsx`.

---

## 5. Persistence model (important)

**No database — plain JSON files + markdown.** This is deliberate (Phase 13 SQLite migration was evaluated and DEFERRED as risky with no user benefit at this scale). Workflow definitions live in `data/workflows`; content-addressed snapshots live in `data/workflow-versions/<workflow-id>` with 50-version retention. If you consider migrating, do it carefully with migration + tests; JSON currently passes all 30 smoke tests. Secrets: cloud keys live only in `~/.config/opencode/opencode.json` (never returned by any API, never in bundle exports); Civitai token in `~/.civitai_token`.

---

## 6. Creative model stack (image + video)

Image models in `~/ComfyUI/models/checkpoints/` (the dashboard shows friendly names + 🔞/📷/⚡ tags; incomplete downloads marked "downloading" and blocked):

| File | Label | Notes |
|---|---|---|
| flux1-schnell-fp8 | Flux Schnell | fast, filtered, all-in-one |
| flux1-dev-fp8 | Flux Dev | quality, filtered, all-in-one |
| juggernaut-xl-v9 | Juggernaut XL | SDXL, uncensored |
| autismmix-pony | AutismMix | Pony/SDXL, uncensored |
| ponyDiffusionV6XL | Pony V6 | SDXL, uncensored, huge LoRA ecosystem |
| persephone-flux | Persephone | Flux NSFW (model-only → needs external CLIP+VAE) |
| fluxedup-flux | Fluxed Up | Flux NSFW (model-only → external CLIP+VAE) |
| chroma-unlocked-v48 | Chroma | UNET-only, T5-only encoder, real CFG (see wiring below) |
| ltxv-2b-0.9.6-distilled | (video) | LTXV text-to-video, hidden from image list |
| ponyv7-auraflow | (pending) | Pony V7 = AuraFlow arch — NOT yet wired, hidden |

**Workflow families (in `server/index.js` `buildWorkflow`):**
- **SDXL/Pony** → CheckpointLoaderSimple; Pony models auto-get `score_9, score_8_up…` tags + `dpmpp_2m_sde`/CFG 7.
- **Flux** → CheckpointLoaderSimple(model+vae) + **DualCLIPLoader** (t5xxl+clip_l external) — because many Civitai Flux checkpoints ship model-only. For truly model-only ones, VAE is also external (`flux-ae`). CFG 1, euler/simple.
- **Chroma** → `buildChromaWorkflow`: UNETLoader + CLIPLoader(type `chroma`, T5-only) + VAELoader(flux-ae) + KSampler(cfg 4.5, euler/**beta**). Chroma file is symlinked into `diffusion_models/` so UNETLoader sees it.
- **Video (LTXV)** → `buildVideoWorkflow`: CheckpointLoaderSimple + CLIPLoader(ltxv) + EmptyLTXVLatentVideo + LTXVConditioning + KSampler + SaveAnimatedWEBP. `/api/studio/video`, gated on model presence.

Required Flux/Chroma support files (already downloaded): `text_encoders/t5xxl_fp8_e4m3fn.safetensors`, `text_encoders/clip_l.safetensors`, `vae/flux-ae.safetensors`.

**Traceability:** ComfyUI embeds the real ckpt/unet name in every PNG. Verify independently: `python3 ~/command-center/scripts/verify_image_model.py <file.png>`. The dashboard also shows "Generated with <model>" under each image.

---

## 7. Local LLM stack

In LM Studio (`~/.lmstudio/models`), MLX quantized. Installed/working: `qwen3-coder-30b`, `qwen3-30b-a3b-2507`, `gpt-oss-20b` (⚠️ gpt-oss can't drive OpenCode tools — chat only; use Qwen for agents). Embeddings: `text-embedding-nomic-embed-text-v1.5` (768-dim, used by RAG).

**Model policies** resolve at run time: `policy:fast|balanced|premium|local` → a concrete model (size-ranked local, or cloud if a provider key is set). New workflow nodes default to `policy:balanced` so beginners never pick model IDs.

---

## 8. CURRENT STATE — where we left off (2026-07-13 ~21:20)

**Working & verified:** entire dashboard (all pages), advanced Workflow Studio v2 vertical slice, 8 image models (6 uncensored) incl. Chroma, local video (LTXV), RAG, agents, workflows. Workflow Studio: TypeScript/build clean, server syntax clean, code-split production bundle, browser screenshot checked at 1728×1117, runtime primitives and approvals exercised directly, API smoke suite 30/30. See `docs/WORKFLOW_STUDIO_ARCHITECTURE.md`.

**Running in the background (downloads):**
- **DeepSeek-R1-4bit (671B, ~420 GB)** → downloading to `~/.lmstudio/models/mlx-community/DeepSeek-R1-4bit/` via **direct curl** (script: `scratchpad/dl_r1_curl.sh`, log: `scratchpad/r1_curl.log`). ~35 MB/s, ETA ~1 AM. NOTE: `lms get` STALLS on huge models (both 235B and R1 froze) — that's why we use curl of the 88 shards. Auto-resumes. When done it appears in LM Studio automatically. **Verify all 88 shards landed** when complete.
- **Pony V7 (AuraFlow, ~13 GB)** → `~/ComfyUI/models/checkpoints/ponyv7-auraflow.safetensors`, ~77% done. **TODO: wire the AuraFlow workflow** (ComfyUI supports AuraFlow; needs its own buildWorkflow branch), then un-hide from the studio/models exclusion regex, test, verify.

**Paused / abandoned:** Qwen3-235B download stalled at 71 GB of 132 GB (`~/.lmstudio/models/lmstudio-community/Qwen3-235B-A22B-Instruct-2507-MLX-4bit`). Can resume later with the curl-shard method if wanted. GLM-4.6 and Qwen3-Coder-480B were queued but never started (the old stalled queue).

**Immediate next steps:**
1. Implement the shared governance mutation boundary and close the documented production lock/environment bypasses.
2. Continue the exact candidate/evaluation/lifecycle sequence in `docs/GOVERNANCE_HARDENING_PLAN.md`; keep Production untrusted until its complete gate passes.
3. Add Role Card persistence/runtime adapters and a migration-preview API/UI without modifying legacy agent data.
4. Add durable collaboration ownership leases/restart recovery before expanding Fable beyond one modifying worker.
5. Run the Qwen3-Coder-Next A/B evaluation opportunistically; retain the current factory alias unless every promotion gate passes.

---

## 9. How to run / test / verify

- **Open:** http://localhost:1717 (auto-starts at login).
- **Smoke tests:** `~/command-center/scripts/smoke.sh` (30 checks; run after ANY change).
- **Type-check + build frontend:** `cd ~/command-center && npx tsc --noEmit && npx vite build`
- **Restart dashboard:** `launchctl kickstart -k gui/$(id -u)/com.local.commandcenter`
- **Image model verify:** `python3 ~/command-center/scripts/verify_image_model.py [png]`
- **Emergency stop all agents:** the 🛑 button in the dashboard top bar, or `POST /api/killall`.

---

## 10. Hard-won gotchas (don't relearn these)

- **`opencode run` spawned from Node needs `stdio:['ignore',...]`** — an open stdin pipe hangs it forever. Also set `env.PWD = cwd`.
- **OpenCode agents need `permission: {edit/bash/webfetch/external_directory: allow}}`** or headless runs stall waiting for approval. Agents need **≥64k context**; server auto-loads local models accordingly.
- **gpt-oss-20b can't drive OpenCode tools** (harmony tool format) — chat only.
- **`lms get` stalls silently on huge (100GB+) models** — use direct curl of HF shards with `-C -` resume + `--retry`.
- **Civitai downloads:** token as **query param** `?token=…` (Authorization header 403s); HEAD 403s on signed URLs but GET works.
- **Many Civitai Flux checkpoints are model-only** (no bundled CLIP/VAE) → load t5xxl+clip_l+flux-ae externally.
- **Video/Chroma/AuraFlow models must be excluded from the image dropdown** until their special workflow is wired, or they glitch. Filter regex is in `/api/studio/models`.
- **Studio dropdown polling bug (fixed):** use functional `setModel(prev => prev || …)` — a stale closure was resetting the selection every 8s.
- **Stale process on :1717** can serve old code after a restart — kill the port owner then kickstart.
- **This Node runs real `Date.now()`/`Math.random()`** (unlike the workflow-tool sandbox) — fine to use.

---

## 11. Docs index (`~/command-center/docs/`)
- `IMPLEMENTATION_STATUS.md` — phase-by-phase status (living doc; update it as you go)
- `FEATURE_AUDIT.md` — evidence-based feature classification
- `CURRENT_ARCHITECTURE.md` / `../FEATURES.md` — full feature spec
- Backups: `~/command-center-backups/` · rollback git tags listed in §3.

---
*If you're an AI starting fresh: read §1, §8, and §10, run `scripts/smoke.sh` to confirm health, then continue from "Immediate next steps" in §8.*
