import { extractResponseText, parseCopyVariants, type CopyVariant } from './copy.ts'

export type CopyFailureCode = 'insufficient_quota' | 'rate_limit' | 'timeout' | 'provider' | 'invalid_output'

export type CopyGenerationResult =
  | { ok: true; variants: CopyVariant[]; inputTokens: number; outputTokens: number }
  | { ok: false; failureCode: CopyFailureCode; inputTokens: number; outputTokens: number }

type RequestOptions = {
  apiKey: string
  model: string
  brief: string
  platforms: string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const instructions = 'Eres estratega de contenido para redes sociales en español. Escribe en español natural, respeta estrictamente los datos del brief, no inventes cifras, testimonios, promociones ni afirmaciones verificables. Produce tres enfoques realmente distintos. El contenido es un borrador para revisión humana, nunca afirmes que fue publicado.'

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    variants: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          angle: { type: 'string' }, headline: { type: 'string' }, body: { type: 'string' }, callToAction: { type: 'string' },
        }, required: ['angle', 'headline', 'body', 'callToAction'],
      },
    },
  }, required: ['variants'],
}

function tokens(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

// Calls the OpenAI Responses API and classifies every failure so the caller can record it
// and show a specific message. It never throws.
export async function requestCopyVariants({ apiKey, model, brief, platforms, fetchImpl = fetch, timeoutMs = 45_000 }: RequestOptions): Promise<CopyGenerationResult> {
  let inputTokens = 0
  let outputTokens = 0
  let response: Response
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1800,
        instructions,
        input: `Brief del usuario:\n${brief}\n\nPlataformas objetivo: ${platforms.join(', ')}. Adapta la longitud y el tono a estas plataformas. Devuelve exactamente tres variantes.`,
        text: { format: { type: 'json_schema', name: 'social_copy_variants', strict: true, schema } },
      }),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { ok: false, failureCode: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'provider', inputTokens, outputTokens }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; type?: string } }
    const quota = body.error?.code === 'insufficient_quota' || body.error?.type === 'insufficient_quota'
    const failureCode: CopyFailureCode = response.status === 429 ? (quota ? 'insufficient_quota' : 'rate_limit') : 'provider'
    return { ok: false, failureCode, inputTokens, outputTokens }
  }

  let payload: { usage?: { input_tokens?: unknown; output_tokens?: unknown }; status?: unknown }
  try {
    payload = await response.json()
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { ok: false, failureCode: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'invalid_output', inputTokens, outputTokens }
  }
  inputTokens = tokens(payload.usage?.input_tokens)
  outputTokens = tokens(payload.usage?.output_tokens)

  try {
    const parsed = JSON.parse(extractResponseText(payload)) as { variants?: unknown }
    return { ok: true, variants: parseCopyVariants(parsed.variants), inputTokens, outputTokens }
  } catch {
    return { ok: false, failureCode: 'invalid_output', inputTokens, outputTokens }
  }
}
