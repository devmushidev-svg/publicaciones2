'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { publicationHistoryPageSize, type PublicationActionState, type PublicationHistoryRecord } from '@/lib/dashboard/publications'
import { publicationPlatforms } from '@/lib/dashboard/publications'
import { dateTimeInputToIso } from '@/lib/date-time'

const allowedPlatforms = new Set<string>(publicationPlatforms.map(({ value }) => value))
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim()
}

export async function markPublicationUsed(
  _previous: PublicationActionState,
  formData: FormData,
): Promise<PublicationActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const publicationId = field(formData, 'publication_id')
  const idempotencyKey = field(formData, 'idempotency_key')
  const localDate = field(formData, 'published_at')
  const timezone = field(formData, 'timezone') || 'America/Tegucigalpa'
  const copy = String(formData.get('copy') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim()
  const platforms = [...new Set(formData.getAll('platforms').map(String))]

  if (!uuidPattern.test(publicationId) || !uuidPattern.test(idempotencyKey)) {
    return { error: 'No pudimos validar esta publicación. Cierra e intenta de nuevo.' }
  }
  if (!platforms.length || platforms.some((platform) => !allowedPlatforms.has(platform))) {
    return { error: 'Selecciona al menos una plataforma válida.' }
  }
  if (notes.length > 2000) return { error: 'Las notas deben tener máximo 2000 caracteres.' }

  const publishedAt = dateTimeInputToIso(localDate, timezone)
  if (!publishedAt) return { error: 'Indica una fecha y hora válidas para la publicación.' }
  if (new Date(publishedAt).getTime() > Date.now() + 5 * 60 * 1000) {
    return { error: 'La fecha de publicación no puede estar en el futuro.' }
  }

  const { error } = await supabase.rpc('record_my_publication_use', {
    p_publication_id: publicationId,
    p_idempotency_key: idempotencyKey,
    p_platforms: platforms,
    p_published_at: publishedAt,
    p_copy: copy,
    p_notes: notes,
  })

  if (error) {
    if (error.code === 'P0002') return { error: 'No encontramos esa publicación activa.' }
    if (error.code === '22023') return { error: 'Los datos cambiaron. Cierra y vuelve a registrar el uso.' }
    return { error: 'No se pudo guardar el historial. Revisa que la migración del historial esté aplicada.' }
  }

  revalidatePath('/')
  return { success: 'Uso registrado en el historial.' }
}

export async function loadMorePublicationHistory(offset: number): Promise<{ rows: PublicationHistoryRecord[]; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { rows: [], error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return { rows: [], error: 'No se pudo cargar el historial.' }

  const { data, error } = await supabase
    .from('publication_history')
    .select('id,publication_id,idempotency_key,platform,published_at,title_snapshot,copy_snapshot,category_snapshot,tags_snapshot,media_snapshot,notes')
    .eq('user_id', user.id)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + publicationHistoryPageSize - 1)

  if (error) return { rows: [], error: 'No se pudo cargar más historial.' }
  return { rows: (data ?? []) as unknown as PublicationHistoryRecord[] }
}
