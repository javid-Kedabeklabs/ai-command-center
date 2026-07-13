import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PRODUCT_LAUNCH_AGENT_LABEL, renderProductLaunchAgent } from '../server/operations/launch-agent.js'

const [command, rootArg] = process.argv.slice(2)
const domain = `gui/${process.getuid()}`
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PRODUCT_LAUNCH_AGENT_LABEL}.plist`)

if (command === 'install' && rootArg) {
  const installRoot = path.resolve(rootArg)
  if (!fs.existsSync(path.join(installRoot, 'current', 'server', 'index.js'))) throw new Error('install root does not contain an active release')
  fs.mkdirSync(path.dirname(plist), { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(installRoot, 'logs'), { recursive: true, mode: 0o700 })
  fs.writeFileSync(plist, renderProductLaunchAgent({ installRoot }), { mode: 0o600 })
  try { execFileSync('launchctl', ['bootout', `${domain}/${PRODUCT_LAUNCH_AGENT_LABEL}`], { stdio: 'ignore' }) } catch {}
  execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' })
  console.log(JSON.stringify({ status: 'installed', label: PRODUCT_LAUNCH_AGENT_LABEL, plist, installRoot }, null, 2))
} else if (command === 'uninstall') {
  try { execFileSync('launchctl', ['bootout', `${domain}/${PRODUCT_LAUNCH_AGENT_LABEL}`], { stdio: 'ignore' }) } catch {}
  fs.rmSync(plist, { force: true })
  console.log(JSON.stringify({ status: 'uninstalled', label: PRODUCT_LAUNCH_AGENT_LABEL, plist }, null, 2))
} else if (command === 'status') {
  const result = execFileSync('launchctl', ['print', `${domain}/${PRODUCT_LAUNCH_AGENT_LABEL}`], { encoding: 'utf8' })
  process.stdout.write(result)
} else {
  console.error('usage: node scripts/product-launch-agent.mjs install <install-root> | uninstall | status')
  process.exit(2)
}
