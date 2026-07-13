# Backup and restore

AI Command Center backups are versioned, hash-verified copies of authoritative local state. They include workflow definitions and immutable versions, runs and receipts, triggers, governance and evaluation records, plugins and custom-node metadata, profiles and provider metadata, knowledge, and audit history.

Backups intentionally exclude rebuildable Python environments, server logs, and workflow caches. They include Keychain reference metadata but **never Keychain secret values**. After restoring to another macOS account or host, configure the referenced secrets in Keychain again.

Stop AI Command Center before creating or restoring a backup so the single-writer snapshot is consistent.

```sh
node scripts/backup.mjs create ./data /absolute/path/to/backup
node scripts/backup.mjs verify /absolute/path/to/backup
```

Verification prints the receipt SHA-256. Restore requires that exact receipt as an explicit destructive-operation confirmation:

```sh
node scripts/backup.mjs restore /absolute/path/to/backup ./data \
  --confirm-receipt <receipt-sha256>
```

Restore validates the manifest, every payload hash, and every JSON document before changing the destination. The previous data directory is atomically renamed to the `rollbackDir` reported in the restore receipt. Keep that directory until the restored application has passed its health and workflow checks.

The deterministic contract is exercised by:

```sh
npm run test:backup
```

## Versioned installation and rollback

Packed releases install beneath a separate installation root. Code lives in immutable `releases/<version>-<archive-hash>` directories, `current` is an atomic symlink to the active release, and authoritative state remains in the shared `data` directory. Each upgrade backs up that shared state before activation and writes a receipt that binds the archive hash, previous release, and backup receipt.

```sh
npm pack --pack-destination /tmp
node scripts/release-lifecycle.mjs install /tmp/ai-command-center-0.1.0.tgz "$HOME/Applications/AI Command Center"
node scripts/product-launch-agent.mjs install "$HOME/Applications/AI Command Center"
```

Stop the LaunchAgent before upgrade or rollback. Rollback requires the exact install receipt SHA and restores both the previous immutable code release and its pre-upgrade data snapshot:

```sh
node scripts/release-lifecycle.mjs rollback "$HOME/Applications/AI Command Center" <install-receipt.json> \
  --confirm-receipt <receipt-sha256>
```
