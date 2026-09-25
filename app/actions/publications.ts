'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PublicationActionState, PublicationStatus } from '@/lib/dashboard/publications'
import { publicationPlatforms } from '@/lib/dashboard/publications'
import { dateTimeInputToIso } from '@/lib/date-time'

const statuses = new Set<PublicationStatus>(['draft', 'scheduled', 'published', 'archived'])
const platformValues = new Set<string>(publicationPlatforms.map(({ value }) => value))

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim()
}

export async function savePublication(
  _previous: PublicationActionState,
  formData: FormData,
): Promise<PublicationActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const id = value(formData, 'id')
  const title = value(formData, 'title')
  const body = String(formData.get('body') ?? '').trim()
  const categoryId = value(formData, 'category_id')
  const status = value(formData, 'status') as PublicationStatus
  const scheduledValue = value(formData, 'scheduled_for')
  const timezone = value(formData, 'timezone') || 'America/Tegucigalpa'
  const platforms = formData.getAll('platforms').map(String).filter((platform) => platformValues.has(platform))
  const mediaIds = [...new Set(formData.getAll('media_asset_ids').map(String).filter(Boolean))]
  const tagIds = [...new Set(formData.getAll('tag_ids').map(String).filter(Boolean))]

  if (!title || title.length > 200) return { error: 'El título es obligatorio y debe tener máximo 200 caracteres.' }
  if (!statuses.has(status)) return { error: 'Selecciona un estado válido.' }
  if (status === 'scheduled' && !scheduledValue) return { error: 'Indica cuándo se publicará.' }
  if (mediaIds.length > 20 || tagIds.length > 30) return { error: 'Selecciona hasta 20 archivos y 30 etiquetas.' }
  if ([...mediaIds, ...tagIds].some((item) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item))) {
    return { error: 'La selección de archivos o etiquetas no es válida.' }
  }

  const scheduledFor = scheduledValue ? dateTimeInputToIso(scheduledValue, timezone) : null
  if (scheduledValue && !scheduledFor) return { error: 'La fecha u hora no existe en la zona horaria seleccionada.' }

  if (categoryId) {
    const { data: category, error } = await supabase.from('categories').select('id,name,is_archived').eq('id', categoryId).eq('user_id', user.id).maybeSingle()
    if (error || !category) return { error: 'Selecciona una categoría válida.' }
    if (category.is_archived) {
      if (!id) return { error: 'Esa categoría está archivada.' }
      const { data: current } = await supabase.from('publications').select('category_id').eq('id', id).eq('user_id', user.id).maybeSingle()
      if (current?.category_id !== categoryId) return { error: 'Esa categoría está archivada.' }
    }
  }

  const { error } = await supabase.rpc('save_my_publication', {
    p_id: id || null,
    p_title: title,
    p_body: body,
    p_category_id: categoryId || null,
    p_status: status,
    p_scheduled_for: status === 'scheduled' ? scheduledFor : null,
    p_published_at: status === 'published' ? (value(formData, 'published_at') || new Date().toISOString()) : null,
    p_platforms: platforms,
    p_media_ids: mediaIds,
    p_tag_ids: tagIds,
  })
  if (error) {
    if (error.code === '23503') return { error: 'Una categoría, imagen o etiqueta seleccionada ya no está disponible.' }
    if (error.code === 'P0002') return { error: 'No encontramos esa publicación.' }
    return { error: 'No se pudo guardar la publicación. Revisa que la migración de biblioteca esté aplicada.' }
  }

  revalidatePath('/')
  return { success: 'Publicación guardada.' }
}

export async function archivePublication(
  _previous: PublicationActionState,
  formData: FormData,
): Promise<PublicationActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const id = value(formData, 'id')
  if (!id) return { error: 'No encontramos la publicación.' }

  const { data, error } = await supabase
    .from('publications')
    .update({ status: 'archived', scheduled_for: null })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error || !data) return { error: 'No se pudo archivar la publicación.' }
  revalidatePath('/')
  return { success: 'Publicación archivada.' }
}
