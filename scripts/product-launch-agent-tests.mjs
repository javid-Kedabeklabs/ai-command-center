import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderProductLaunchAgent } from '../server/operations/launch-agent.js'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-launch-agent-'))
try {
  const installRoot = path.join(temp, 'Command & Center')
  const document = renderProductLaunchAgent({ installRoot, nodePath: '/opt/node & tools/node', port: 18181 })
  assert.match(document, /com\.local\.commandcenter/)
  assert.match(document, /ACC_ALLOW_EXTERNAL_DATA_DIR/)
  assert.match(document, /<string>1<\/string>/)
  assert.match(document, /Command &amp; Center\/data/)
  assert.match(document, /current\/server\/index\.js/)
  assert.match(document, /<key>KeepAlive<\/key><true\/>/)
  assert.match(document, /server-error\.log/)
  const plist = path.join(temp, 'agent.plist')
  fs.writeFileSync(plist, document)
  const lint = spawnSync('plutil', ['-lint', plist], { encoding: 'utf8' })
  assert.equal(lint.status, 0, lint.stderr || lint.stdout)
  assert.throws(() => renderProductLaunchAgent({ installRoot, port: 80 }), /between 1024 and 65535/)
  console.log('product LaunchAgent tests: 9/9 passed')
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
