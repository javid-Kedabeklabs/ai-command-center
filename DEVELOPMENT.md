# Development

Prerequisites: Node.js, npm, and optional local services such as LM Studio, OpenCode, and ComfyUI.

```sh
npm install
cd web && npm install && cd ..
node server/index.js
```

The application serves on `http://127.0.0.1:1717`. On this development machine, `com.local.commandcenter` may manage the server with launchd; restart it using `launchctl kickstart -k gui/$(id -u)/com.local.commandcenter`.

Before editing, run `git status --short` and preserve unrelated changes. Use `node --check server/index.js`, `cd web && npx tsc --noEmit && npm run build`, focused scripts in `scripts/`, and `scripts/smoke.sh`.
