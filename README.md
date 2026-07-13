# ◉ AI Command Center

Your personal mission-control dashboard for local AI on the Mac Studio (M3 Ultra, 512 GB).
Everything runs 100% on-device — no cloud, no API bills.

**Open it: http://localhost:1717** (it auto-starts at login; or double-click
"Start Command Center" on the Desktop).

## What each page does
- **Dashboard** — live RAM/disk meters, service health, what's loaded, active runs
- **Models** — every local model: ● loaded / ○ on disk. Load (pick context size), unload, download new ones by name
- **Chat** — talk to any local model, streaming, markdown
- **Agents** — create agents (avatar, name, model, role prompt). Hit ▶ Run task and watch the live feed as the agent writes files / runs commands via OpenCode. Full run history below.
- **Pipelines / MCP** — coming next

## How it works
```
Browser (localhost:1717)
   └► Node server (server/index.js)
        ├► LM Studio  localhost:1234  (models + chat)
        ├► lms CLI                    (load/unload/download)
        └► opencode run --agent cc-…  (agent task execution)
```
- Agents are mirrored as native OpenCode agents in `~/.config/opencode/agent/cc-*.md`
  (role prompt in the system slot, permissions pre-allowed so headless runs never stall).
- Agent workspaces live in `~/agents-workspace/<agent>/`.
- Data (agents, run transcripts) persists in `data/`.

## Commands
```bash
npm run launch   # rebuild UI + start server
npm start        # start server (uses last build)
npm run build    # rebuild UI only
```

## Hard-won integration notes (do not lose)
1. `opencode run` spawned from Node needs `stdio: ['ignore', …]` — an open stdin pipe hangs it forever.
2. Set `env.PWD = cwd` when spawning — opencode trusts `$PWD` for its project root.
3. Custom opencode agents need an explicit `permission: {edit/bash/webfetch: allow}` block, or headless runs stall waiting for approval.
4. Agent models need ≥64k context — OpenCode's system prompt overflows small windows (the server auto-reloads models with more context when needed).
5. gpt-oss-20b hangs as an *agent* driver (harmony tool format vs LM Studio); it's fine for plain chat. Use Qwen models for agents.
