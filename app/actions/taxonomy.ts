'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type TaxonomyActionState = { error?: string; success?: string }
type TaxonomyKind = 'category' | 'tag'

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

export async function saveTaxonomyItem(_previous: TaxonomyActionState, formData: FormData): Promise<TaxonomyActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const kind = field(formData, 'kind') as TaxonomyKind
  const id = field(formData, 'id')
  const name = field(formData, 'name')
  const color = field(formData, 'color') || '#71866f'
  if (kind !== 'category' && kind !== 'tag') return { error: 'Tipo de elemento no válido.' }
  if (!name || name.length > (kind === 'category' ? 80 : 50)) return { error: 'Escribe un nombre válido.' }
  if (kind === 'category' && !/^#[\da-f]{6}$/i.test(color)) return { error: 'Selecciona un color válido.' }

  const table = kind === 'category' ? 'categories' : 'tags'
  const payload = kind === 'category' ? { name, color } : { name }
  const result = id
    ? await supabase.from(table).update(payload).eq('id', id).eq('user_id', user.id).select('id').maybeSingle()
    : await supabase.from(table).insert({ ...payload, user_id: user.id }).select('id').maybeSingle()
  if (result.error) {
    return { error: result.error.code === '23505' ? 'Ya existe un elemento con ese nombre.' : 'No se pudo guardar. Inténtalo de nuevo.' }
  }
  if (id && !result.data) return { error: 'No encontramos ese elemento.' }

  revalidatePath('/')
  return { success: kind === 'category' ? 'Categoría guardada.' : 'Etiqueta guardada.' }
}

export async function archiveTaxonomyItem(_previous: TaxonomyActionState, formData: FormData): Promise<TaxonomyActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const kind = field(formData, 'kind') as TaxonomyKind
  const id = field(formData, 'id')
  if ((kind !== 'category' && kind !== 'tag') || !id) return { error: 'No encontramos ese elemento.' }
  const table = kind === 'category' ? 'categories' : 'tags'
  const { data, error } = await supabase.from(table).update({ is_archived: true }).eq('id', id).eq('user_id', user.id).select('id').maybeSingle()
  if (error || !data) return { error: 'No se pudo archivar el elemento.' }

  revalidatePath('/')
  return { success: 'Elemento archivado.' }
}
