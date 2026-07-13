import fs from 'node:fs'

export function readUserFile(root, requestedPath) {
  return fs.readFileSync(`${root}/${requestedPath}`, 'utf8')
}
