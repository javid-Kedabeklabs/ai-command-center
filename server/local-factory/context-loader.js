import fs from 'node:fs'
import path from 'node:path'
import { validateLocalFactoryPath } from './task-schema.js'

const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)

export function loadLocalFactoryContext({ repositoryRoot, files, maxInputBytes }) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required')
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  if (!Array.isArray(files)) throw new Error('files must be an array')
  let totalBytes = 0
  const documents = []
  for (const [index, value] of files.entries()) {
    const relativePath = validateLocalFactoryPath(value, `files[${index}]`)
    const lexical = path.resolve(root, relativePath)
    if (!isInside(root, lexical)) throw new Error('context path escaped the repository')
    const stat = fs.lstatSync(lexical)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`context file must be a regular non-symlink file: ${relativePath}`)
    const real = fs.realpathSync(lexical)
    if (!isInside(root, real)) throw new Error('context file resolved outside the repository')
    const bytes = stat.size
    if (bytes > maxInputBytes || totalBytes + bytes > maxInputBytes) throw new Error('local factory context exceeds the task input budget')
    const content = fs.readFileSync(real, 'utf8')
    if (Buffer.byteLength(content, 'utf8') !== bytes) throw new Error(`context file is not supported UTF-8 text: ${relativePath}`)
    totalBytes += bytes
    documents.push(Object.freeze({ path: relativePath, bytes, content }))
  }
  return Object.freeze({ documents: Object.freeze(documents), totalBytes })
}
