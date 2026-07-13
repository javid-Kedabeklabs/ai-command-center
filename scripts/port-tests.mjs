import assert from 'node:assert/strict'
import { PORT_TYPES, coerceValue, portsCompatible, suggestedConverter, validateSchema } from '../server/workflows/ports.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`) }

console.log('== typed ports ==')

test('complete canonical vocabulary is present', () => {
  for (const type of ['any','text','number','boolean','object','array','table','file','files','control','error','approval','artifact','memory','image','audio','video','code','stream']) assert(PORT_TYPES.includes(type), type)
})

test('compatible families connect without coercion', () => {
  assert(portsCompatible('object', 'data'))
  assert(portsCompatible('file', 'files'))
  assert(portsCompatible('memory', 'text'))
  assert(!portsCompatible('image', 'text'))
})

test('explicit safe coercion must match destination', () => {
  assert(portsCompatible('text', 'object', 'object'))
  assert(!portsCompatible('text', 'object', 'number'))
  assert.deepEqual(coerceValue('{"score":9}', 'object'), { score: 9 })
  assert.equal(coerceValue('true', 'boolean'), true)
  assert.throws(() => coerceValue('not-a-number', 'number'), /safely converted/)
})

test('JSON Schema subset reports nested actionable paths', () => {
  const schema = { type: 'object', required: ['summary', 'score'], properties: { summary: { type: 'string', minLength: 5 }, score: { type: 'number', minimum: 0, maximum: 100 } } }
  assert.deepEqual(validateSchema({ summary: 'Complete', score: 90 }, schema), [])
  const errors = validateSchema({ summary: 'bad', score: 120 }, schema)
  assert(errors.some(error => error.includes('$.summary')))
  assert(errors.some(error => error.includes('$.score')))
})

test('invalid connections suggest a repair node', () => {
  assert.match(suggestedConverter('image', 'text'), /OCR|Vision/)
  assert.match(suggestedConverter('files', 'text'), /Document Reader/)
  assert.match(suggestedConverter('text', 'object'), /JSON Transform/)
})

console.log(`\n== RESULT: ${passed} passed, 0 failed ==`)
