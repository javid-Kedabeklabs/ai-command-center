# Testing

The test layers are:

- Pure schema, port, and scheduler fixtures.
- API/runtime integration suites for interrupted features, MCP, triggers, evaluations, permissions, restart recovery, and Company World consistency.
- The original live smoke suite.
- TypeScript checking and Vite production build.

Run the current checkpoint:

```sh
node scripts/schema-tests.mjs
node scripts/port-tests.mjs
node scripts/scheduler-tests.mjs
node scripts/phase0-contract-tests.mjs
node scripts/mcp-transport-tests.mjs
node scripts/trigger-tests.mjs
node scripts/evaluation-gate-tests.mjs
node scripts/security-policy-tests.mjs
node scripts/company-world-tests.mjs
scripts/autonomy/test-supervisor.sh
scripts/autonomy/doctor.sh
bash scripts/smoke.sh
cd web && npx tsc --noEmit && npm run build
```

Never report a pass without executing the relevant suite against the current server build.
