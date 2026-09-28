'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { extractResponseText, parseCopyVariants, type CopyVariant } from '@/lib/ai/copy'

export type AiCopyState = { error?: string; success?: string; variants?: CopyVariant[]; generationId?: string; used?: number; limit?: number }

const allowedPlatforms = new Set(['instagram', 'facebook', 'linkedin', 'tiktok', 'x', 'whatsapp'])
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

function errorMessage(code: string) {
  if (code === 'insufficient_quota') return 'Se agotó el crédito disponible del proveedor de IA.'
  if (code === 'rate_limit') return 'El proveedor está ocupado. Espera un momento y vuelve a intentar.'
  if (code === 'timeout') return 'La generación tardó demasiado. Inténtalo de nuevo.'
  if (code === 'provider') return 'No se pudo conectar con el proveedor de IA.'
  if (code === 'invalid_output') return 'La IA no devolvió variantes válidas. Intenta con una indicación más concreta.'
  if (code === 'database') return 'No se pudo registrar el uso. Comprueba que la migración de IA esté aplicada.'
  return 'No se pudo generar el contenido.'
}

export async function generateAiCopy(_previous: AiCopyState, formData: FormData): Promise<AiCopyState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  if (!process.env.OPENAI_API_KEY) return { error: 'Falta configurar OPENAI_API_KEY como variable privada en Vercel para activar la generación.' }

  const brief = String(formData.get('brief') ?? '').trim()
  const rawPlatforms = formData.getAll('platforms').map(String)
  const platforms = [...new Set(rawPlatforms.filter((platform) => allowedPlatforms.has(platform)))]
  if (brief.length < 10 || brief.length > 3000) return { error: 'Describe el contenido con entre 10 y 3000 caracteres.' }
  if (!platforms.length) return { error: 'Selecciona al menos una plataforma.' }

  const { data: reservation, error: reserveError } = await supabase.rpc('start_my_ai_copy_generation', {
    p_brief: brief,
    p_platforms: platforms,
    p_model: model,
  })
  if (reserveError) {
    if (reserveError.code === '54000') return { error: 'Alcanzaste el límite de 30 generaciones de este mes.' }
    return { error: errorMessage('database') }
  }
  const reserved = Array.isArray(reservation) ? reservation[0] : reservation
  const generationId = reserved?.generation_id as string | undefined
  if (!generationId) return { error: errorMessage('database') }

  let variants: CopyVariant[] | null = null
  let failureCode = 'provider'
  let inputTokens = 0
  let outputTokens = 0
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1800,
        instructions: 'Eres estratega de contenido para redes sociales en español. Escribe en español natural, respeta estrictamente los datos del brief, no inventes cifras, testimonios, promociones ni afirmaciones verificables. Produce tres enfoques realmente distintos. El contenido es un borrador para revisión humana, nunca afirmes que fue publicado.',
        input: `Brief del usuario:\n${brief}\n\nPlataformas objetivo: ${platforms.join(', ')}. Adapta la longitud y el tono a estas plataformas. Devuelve exactamente tres variantes.`,
        text: {
          format: {
            type: 'json_schema',
            name: 'social_copy_variants',
            strict: true,
            schema: {
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
            },
          },
        },
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { code?: string; type?: string } }
      failureCode = response.status === 429 ? (body.error?.code === 'insufficient_quota' ? 'insufficient_quota' : 'rate_limit') : 'provider'
      throw new Error(failureCode)
    }
    const payload = await response.json() as { usage?: { input_tokens?: number; output_tokens?: number } }
    inputTokens = payload.usage?.input_tokens ?? 0
    outputTokens = payload.usage?.output_tokens ?? 0
    let parsed: { variants?: unknown }
    try {
      parsed = JSON.parse(extractResponseText(payload)) as { variants?: unknown }
    } catch {
      failureCode = 'invalid_output'
      throw new Error('invalid_output')
    }
    variants = parseCopyVariants(parsed.variants)
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') failureCode = 'timeout'
    else if (error instanceof Error && ['invalid_output', 'insufficient_quota', 'rate_limit'].includes(error.message)) failureCode = error.message
  }

  const { error: finishError } = await supabase.rpc('finish_my_ai_copy_generation', {
    p_generation_id: generationId,
    p_status: variants ? 'succeeded' : 'failed',
    p_variants: variants ?? [],
    p_failure_code: variants ? null : failureCode,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
  })
  if (finishError) return { error: errorMessage('database') }
  revalidatePath('/')
  if (!variants) return { error: errorMessage(failureCode), used: reserved?.used, limit: reserved?.monthly_limit }
  return { variants, generationId, used: reserved?.used, limit: reserved?.monthly_limit }
}

export async function saveGeneratedCopyAsDraft(_previous: AiCopyState, formData: FormData): Promise<AiCopyState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const title = String(formData.get('title') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  const generationId = String(formData.get('generation_id') ?? '')
  if (!title || title.length > 200 || !body || body.length > 3000) return { error: 'Revisa el título y el texto del borrador.' }

  const { data: publicationId, error: saveError } = await supabase.rpc('save_my_publication', {
    p_id: null, p_title: title, p_body: body, p_category_id: null, p_status: 'draft',
    p_scheduled_for: null, p_published_at: null, p_platforms: [], p_media_ids: [], p_tag_ids: [],
  })
  if (saveError) return { error: 'No se pudo guardar el borrador. Comprueba que la migración de biblioteca esté aplicada.' }
  if (generationId) {
    const { error } = await supabase.rpc('mark_my_ai_copy_saved', { p_generation_id: generationId, p_publication_id: publicationId })
    if (error) return { success: 'El borrador se guardó. No se pudo actualizar su registro de revisión.' }
  }
  revalidatePath('/')
  return { success: 'Borrador guardado. Ya aparece en Publicaciones.' }
}
