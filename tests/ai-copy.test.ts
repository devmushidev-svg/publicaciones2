import assert from 'node:assert/strict'
import test from 'node:test'
import { extractResponseText, parseCopyVariants } from '../lib/ai/copy.ts'
import { requestCopyVariants } from '../lib/ai/provider.ts'

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

const variantsPayload = (variants: unknown) => ({
  usage: { input_tokens: 120, output_tokens: 340 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ variants }) }] }],
})
const threeVariants = ['A', 'B', 'C'].map((angle) => ({ angle, headline: 'Título', body: 'Texto', callToAction: 'Escríbenos' }))
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const baseRequest = { apiKey: 'test-key', model: 'test-model', brief: 'Promoción de temporada', platforms: ['instagram'] }

test('provider success returns three variants and token usage', async () => {
  let sentBody: { store?: boolean; model?: string } = {}
  const result = await requestCopyVariants({
    ...baseRequest,
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(String(init?.body))
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key')
      return jsonResponse(200, variantsPayload(threeVariants))
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.variants.length, 3)
  assert.equal(result.inputTokens, 120)
  assert.equal(result.outputTokens, 340)
  assert.equal(sentBody.store, false)
  assert.equal(sentBody.model, 'test-model')
})

test('provider quota, rate limit, and server errors are classified', async () => {
  const quota = await requestCopyVariants({ ...baseRequest, fetchImpl: async () => jsonResponse(429, { error: { code: 'insufficient_quota' } }) })
  const rate = await requestCopyVariants({ ...baseRequest, fetchImpl: async () => jsonResponse(429, { error: { code: 'rate_limit_exceeded' } }) })
  const server = await requestCopyVariants({ ...baseRequest, fetchImpl: async () => new Response('bad gateway', { status: 502 }) })
  const network = await requestCopyVariants({ ...baseRequest, fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.deepEqual([quota, rate, server, network].map((item) => !item.ok && item.failureCode), ['insufficient_quota', 'rate_limit', 'provider', 'provider'])
})

test('provider timeout is reported as timeout', async () => {
  const result = await requestCopyVariants({
    ...baseRequest,
    timeoutMs: 20,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      // AbortSignal.timeout timers do not keep the process alive; this one does.
      const keepAlive = setTimeout(() => reject(new Error('signal never aborted')), 2_000)
      init?.signal?.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal?.reason) })
    }),
  })
  assert.equal(!result.ok && result.failureCode, 'timeout')
})

test('provider invalid structured output is rejected but keeps token usage', async () => {
  const twoVariants = await requestCopyVariants({ ...baseRequest, fetchImpl: async () => jsonResponse(200, variantsPayload(threeVariants.slice(0, 2))) })
  const notJson = await requestCopyVariants({ ...baseRequest, fetchImpl: async () => jsonResponse(200, { usage: { input_tokens: 5 }, output: [{ content: [{ type: 'output_text', text: 'hola' }] }] }) })
  assert.equal(!twoVariants.ok && twoVariants.failureCode, 'invalid_output')
  assert.equal(twoVariants.inputTokens, 120)
  assert.equal(!notJson.ok && notJson.failureCode, 'invalid_output')
})
