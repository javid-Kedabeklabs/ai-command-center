export const PORT_TYPES = Object.freeze(['any', 'text', 'number', 'boolean', 'object', 'array', 'table', 'file', 'files', 'control', 'error', 'approval', 'artifact', 'memory', 'image', 'audio', 'video', 'code', 'stream', 'data'])

const p = (id, type, label, required = true, schema) => ({ id, type, label, required, ...(schema ? { schema } : {}) })

export const NODE_CONTRACTS = Object.freeze({
  input: { inputs: [], outputs: [p('output', 'text', 'Request')] },
  'file-input': { inputs: [], outputs: [p('files', 'files', 'Files', true, { type: 'array', items: { type: 'string' } })] },
  'folder-input': { inputs: [], outputs: [p('files', 'files', 'Files', true, { type: 'array', items: { type: 'string' } })] },
  agent: { inputs: [p('input', 'any', 'Context')], outputs: [p('output', 'text', 'Result')] },
  orchestrator: { inputs: [p('input', 'any', 'Goal')], outputs: [p('output', 'text', 'Result')] },
  critic: { inputs: [p('input', 'text', 'Draft')], outputs: [p('output', 'text', 'Improved result')] },
  parallel: { inputs: [p('input', 'any', 'Goal')], outputs: [p('output', 'text', 'Judged result')] },
  map: { inputs: [p('items', 'array', 'Items')], outputs: [p('results', 'array', 'Results')] },
  search: { inputs: [p('query', 'text', 'Query')], outputs: [p('results', 'text', 'Passages')] },
  'pdf-reader': { inputs: [p('files', 'files', 'PDF files')], outputs: [p('text', 'text', 'Document text')] },
  'obsidian-read': { inputs: [], outputs: [p('note', 'memory', 'Note')] },
  'obsidian-write': { inputs: [p('content', 'any', 'Content')], outputs: [p('artifact', 'artifact', 'Note path')] },
  check: { inputs: [p('input', 'any', 'Value')], outputs: [p('valid', 'any', 'Validated value'), p('error', 'error', 'Failure', false)] },
  if: { inputs: [p('input', 'any', 'Value')], outputs: [p('true', 'control', 'Yes'), p('false', 'control', 'No')] },
  delay: { inputs: [p('input', 'any', 'Value')], outputs: [p('output', 'any', 'Value')] },
  'human-approval': { inputs: [p('input', 'any', 'Review item')], outputs: [p('approved', 'approval', 'Approved'), p('rejected', 'error', 'Rejected', false)] },
  python: { inputs: [p('input', 'any', 'JSON input')], outputs: [p('output', 'data', 'stdout')] },
  shell: { inputs: [p('stdin', 'any', 'stdin')], outputs: [p('stdout', 'text', 'stdout')] },
  'json-transform': { inputs: [p('json', 'data', 'JSON')], outputs: [p('json', 'data', 'JSON')] },
  'read-file': { inputs: [p('path', 'artifact', 'Path', false)], outputs: [p('content', 'text', 'Content')] },
  'write-file': { inputs: [p('content', 'any', 'Content')], outputs: [p('artifact', 'artifact', 'File')] },
  http: { inputs: [p('body', 'any', 'Body', false)], outputs: [p('response', 'data', 'Response')] },
  mcp: { inputs: [p('arguments', 'object', 'Arguments', false)], outputs: [p('result', 'data', 'Tool result')] },
  subworkflow: { inputs: [p('input', 'any', 'Workflow input')], outputs: [p('output', 'any', 'Workflow output')] },
  custom: { inputs: [p('input', 'any', 'Input')], outputs: [p('output', 'any', 'Output')] },
  output: { inputs: [p('input', 'any', 'Result')], outputs: [] },
})

export function contractForNode(node, customDefinitions = []) {
  if (node?.type === 'custom') {
    const definition = customDefinitions.find(x => x.id === node.data?.customNodeId)
    if (definition) return { inputs: definition.inputs || NODE_CONTRACTS.custom.inputs, outputs: definition.outputs || NODE_CONTRACTS.custom.outputs }
  }
  if (node?.ports?.inputs || node?.ports?.outputs) return { inputs: node.ports.inputs || [], outputs: node.ports.outputs || [] }
  return NODE_CONTRACTS[node?.type] || { inputs: [], outputs: [] }
}

const families = {
  data: new Set(['object', 'array', 'table', 'data']),
  file: new Set(['file', 'files', 'artifact']),
  text: new Set(['text', 'code', 'memory']),
  media: new Set(['image', 'audio', 'video']),
}

export function portsCompatible(sourceType, targetType, coercion) {
  let effective = sourceType
  if (coercion) {
    if (!supportedCoercions(sourceType).includes(coercion)) return false
    effective = coercion
  }
  if (effective === 'any' || targetType === 'any' || effective === targetType) return true
  if (families.data.has(effective) && targetType === 'data') return true
  if (effective === 'file' && targetType === 'files') return true
  if (effective === 'artifact' && ['file', 'files'].includes(targetType)) return true
  if (['memory', 'code'].includes(effective) && targetType === 'text') return true
  return false
}

export function supportedCoercions(sourceType) {
  if (sourceType === 'text') return ['number', 'boolean', 'object', 'array', 'code']
  if (sourceType === 'number' || sourceType === 'boolean') return ['text']
  if (['object', 'array', 'table', 'data'].includes(sourceType)) return ['text']
  if (sourceType === 'file') return ['files', 'artifact']
  if (sourceType === 'artifact') return ['file', 'files']
  return []
}

export function coerceValue(value, targetType) {
  if (!targetType || targetType === 'any' || targetType === 'data') return value
  if (targetType === 'text' || targetType === 'code') return typeof value === 'string' ? value : JSON.stringify(value)
  if (targetType === 'number') { const result = Number(value); if (!Number.isFinite(result)) throw new Error('value cannot be safely converted to a number'); return result }
  if (targetType === 'boolean') { if (value === true || value === 'true') return true; if (value === false || value === 'false') return false; throw new Error('value must be true or false') }
  if (targetType === 'object' || targetType === 'array') { const parsed = typeof value === 'string' ? JSON.parse(value) : value; if (targetType === 'array' ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`value is not a ${targetType}`); return parsed }
  if (targetType === 'files') return Array.isArray(value) ? value : [value]
  return value
}

export function validateSchema(value, schema, at = '$') {
  if (!schema || typeof schema !== 'object') return []
  const errors = []
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (schema.type && type !== schema.type) errors.push(`${at} must be ${schema.type}, received ${type}`)
  if (schema.enum && !schema.enum.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))) errors.push(`${at} is not an allowed value`)
  if (typeof value === 'string') { if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at} must contain at least ${schema.minLength} characters`); if (schema.pattern) try { if (!new RegExp(schema.pattern).test(value)) errors.push(`${at} does not match the required pattern`) } catch { errors.push(`${at} uses an invalid schema pattern`) } }
  if (typeof value === 'number') { if (schema.minimum != null && value < schema.minimum) errors.push(`${at} must be at least ${schema.minimum}`); if (schema.maximum != null && value > schema.maximum) errors.push(`${at} must be at most ${schema.maximum}`) }
  if (Array.isArray(value)) { if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at} needs at least ${schema.minItems} items`); if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, `${at}[${index}]`))) }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}.${key} is required`)
    for (const [key, childSchema] of Object.entries(schema.properties || {})) if (key in value) errors.push(...validateSchema(value[key], childSchema, `${at}.${key}`))
  }
  return errors
}

export function suggestedConverter(sourceType, targetType) {
  if (['image'].includes(sourceType) && targetType === 'text') return 'OCR or Vision Model'
  if (['file', 'files', 'artifact'].includes(sourceType) && targetType === 'text') return 'Document Reader or Read File'
  if (sourceType === 'text' && ['object', 'array', 'data'].includes(targetType)) return 'JSON Transform or Schema Validator'
  if (['object', 'array', 'table', 'data'].includes(sourceType) && targetType === 'text') return 'Template Renderer or JSON Transform'
  if (families.media.has(sourceType) && !families.media.has(targetType)) return 'Media Analysis or Format Converter'
  return 'Data Transformer'
}

export function portCatalog(customDefinitions = []) {
  return { portTypes: PORT_TYPES, contracts: NODE_CONTRACTS, custom: customDefinitions }
}
