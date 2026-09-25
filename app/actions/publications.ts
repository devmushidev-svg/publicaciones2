'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PublicationActionState, PublicationStatus } from '@/lib/dashboard/publications'
import { publicationPlatforms } from '@/lib/dashboard/publications'

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
  const category = value(formData, 'category')
  const status = value(formData, 'status') as PublicationStatus
  const scheduledValue = value(formData, 'scheduled_for')
  const platforms = formData.getAll('platforms').map(String).filter((platform) => platformValues.has(platform))

  if (!title || title.length > 200) return { error: 'El título es obligatorio y debe tener máximo 200 caracteres.' }
  if (!statuses.has(status)) return { error: 'Selecciona un estado válido.' }
  if (status === 'scheduled' && !scheduledValue) return { error: 'Indica cuándo se publicará.' }

  const scheduledFor = scheduledValue ? new Date(scheduledValue) : null
  if (scheduledFor && Number.isNaN(scheduledFor.getTime())) return { error: 'La fecha de programación no es válida.' }

  const payload = {
    title,
    body,
    category: category || null,
    status,
    scheduled_for: status === 'scheduled' ? scheduledFor?.toISOString() : null,
    published_at: status === 'published' ? (value(formData, 'published_at') || new Date().toISOString()) : null,
    platforms,
  }

  if (id) {
    const { data, error } = await supabase
      .from('publications')
      .update(payload)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle()
    if (error || !data) return { error: 'No se pudo actualizar la publicación.' }
  } else {
    const { error } = await supabase.from('publications').insert({ ...payload, user_id: user.id })
    if (error) return { error: 'No se pudo crear la publicación.' }
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
