import fs from 'node:fs'
import path from 'node:path'
import { installRelease, rollbackRelease } from '../server/operations/release-install.js'

const [command, first, second, flag, confirmation] = process.argv.slice(2)
if (command === 'install' && first && second) {
  const receipt = installRelease({ archive: first, installRoot: second })
  console.log(JSON.stringify(receipt, null, 2))
} else if (command === 'rollback' && first && second) {
  const receipt = JSON.parse(fs.readFileSync(path.resolve(second), 'utf8'))
  if (flag !== '--confirm-receipt' || confirmation !== receipt.receiptSha256) {
    console.error(`rollback requires: --confirm-receipt ${receipt.receiptSha256}`)
    process.exit(2)
  }
  console.log(JSON.stringify(rollbackRelease({ installRoot: first, receipt }), null, 2))
} else {
  console.error('usage: node scripts/release-lifecycle.mjs install <release.tgz> <install-root> | rollback <install-root> <install-receipt.json> --confirm-receipt <sha256>')
  process.exit(2)
}
