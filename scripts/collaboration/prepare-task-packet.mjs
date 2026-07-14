#!/usr/bin/env node

import fs from 'node:fs'
import { prepareTaskPacket } from '../../server/collaboration/packet-preparer.js'

const chunks = []
let size = 0
for await (const chunk of process.stdin) {
  size += chunk.length
  if (size > 256 * 1024) throw new Error('task draft exceeds 256 KiB')
  chunks.push(chunk)
}
if (!chunks.length) throw new Error('read a JSON task draft from stdin')
const draft = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const result = prepareTaskPacket({ repositoryRoot: fs.realpathSync(process.cwd()), draft })
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
