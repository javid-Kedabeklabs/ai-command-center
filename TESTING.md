# Testing

The authoritative release command is:

```sh
npm run verify:release
```

It runs 26 deterministic gates spanning runtime recovery, replay-safe controls, triggers/subworkflows, secret canaries, disk-full/soak/performance hardening, backup/restore, packaging/install/upgrade/rollback, supply-chain review, evaluations/learning, TypeScript/build, and ten live Playwright/Axe/visual journeys.

The test layers are:

- Pure schema, port, and scheduler fixtures.
- API/runtime integration suites for interrupted features, MCP, triggers, evaluations, permissions, restart recovery, and Company World consistency.
- The original live smoke suite.
- TypeScript checking and Vite production build.

Useful focused checkpoints include:

```sh
npm run test:fast
npm run test:hardening
npm run test:backup
npm run test:browser
npx tsc --noEmit
npm run build
```

Never report a pass without executing the relevant suite against the current server build.
