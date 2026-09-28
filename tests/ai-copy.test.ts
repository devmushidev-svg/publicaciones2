import assert from 'node:assert/strict'
import test from 'node:test'
import { extractResponseText, parseCopyVariants } from '../lib/ai/copy.ts'

test('extracts structured text from Responses API output items', () => {
  const text = extractResponseText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"variants":[]}' }] }] })
  assert.equal(text, '{"variants":[]}')
})

test('validates exactly three complete, bounded variants', () => {
  const variants = ['A', 'B', 'C'].map((angle) => ({ angle, headline: 'Título', body: 'Texto', callToAction: 'Conoce más' }))
  assert.equal(parseCopyVariants(variants).length, 3)
  assert.throws(() => parseCopyVariants(variants.slice(0, 2)), /invalid_output/)
  assert.throws(() => parseCopyVariants([{ ...variants[0], body: '' }, ...variants.slice(1)]), /invalid_output/)
  assert.throws(() => parseCopyVariants([{ ...variants[0], body: 'x'.repeat(3001) }, ...variants.slice(1)]), /invalid_output/)
})

test('rejects malformed or empty provider responses', () => {
  assert.throws(() => extractResponseText({ output: [] }), /invalid_output/)
  assert.throws(() => parseCopyVariants(null), /invalid_output/)
})
