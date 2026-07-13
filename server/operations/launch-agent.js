import path from 'node:path'

export const PRODUCT_LAUNCH_AGENT_LABEL = 'com.local.commandcenter'

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function renderProductLaunchAgent({ installRoot, nodePath = process.execPath, port = 1717 }) {
  const root = path.resolve(installRoot), current = path.join(root, 'current'), data = path.join(root, 'data'), logs = path.join(root, 'logs')
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) throw new Error('LaunchAgent port must be between 1024 and 65535')
  const strings = values => values.map(value => `      <string>${xml(value)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PRODUCT_LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings([nodePath, path.join(current, 'server', 'index.js')])}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(current)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>${Number(port)}</string>
    <key>ACC_DATA_DIR</key><string>${xml(data)}</string>
    <key>ACC_ALLOW_EXTERNAL_DATA_DIR</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logs, 'server.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, 'server-error.log'))}</string>
</dict>
</plist>
`
}
