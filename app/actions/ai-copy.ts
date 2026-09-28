'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { CopyVariant } from '@/lib/ai/copy'
import { requestCopyVariants } from '@/lib/ai/provider'

export type AiCopyState = { error?: string; success?: string; variants?: CopyVariant[]; generationId?: string; used?: number; limit?: number }

const allowedPlatforms = new Set(['instagram', 'facebook', 'linkedin', 'tiktok', 'x', 'whatsapp'])
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const result = await requestCopyVariants({ apiKey: process.env.OPENAI_API_KEY, model, brief, platforms })
  const variants: CopyVariant[] | null = result.ok ? result.variants : null
  const failureCode = result.ok ? '' : result.failureCode
  const inputTokens = result.inputTokens
  const outputTokens = result.outputTokens

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

  if (!uuidPattern.test(generationId)) return { error: 'No encontramos esa generación. Genera las propuestas de nuevo.' }

  const { error } = await supabase.rpc('save_my_ai_copy_draft', { p_generation_id: generationId, p_title: title, p_body: body })
  if (error) {
    if (error.code === 'P0002') return { error: 'No encontramos esa generación. Genera las propuestas de nuevo.' }
    if (error.code === '22023') return { error: 'Revisa el título y el texto del borrador.' }
    return { error: 'No se pudo guardar el borrador. Comprueba que la migración de IA esté aplicada.' }
  }
  revalidatePath('/')
  return { success: 'Borrador guardado. Ya aparece en Publicaciones.' }
}
