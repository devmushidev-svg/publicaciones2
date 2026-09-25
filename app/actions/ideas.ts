'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type IdeaActionState = { error?: string; success?: string }
export type IdeaStatus = 'inbox' | 'planned' | 'used' | 'archived'

const statuses = new Set<IdeaStatus>(['inbox', 'planned', 'used', 'archived'])

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim()
}

export async function saveIdea(_previous: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const id = value(formData, 'id')
  const title = value(formData, 'title')
  const notes = String(formData.get('notes') ?? '').trim()
  const status = value(formData, 'status') as IdeaStatus
  if (!title || title.length > 240) return { error: 'El título es obligatorio y debe tener máximo 240 caracteres.' }
  if (!statuses.has(status) || status === 'used') return { error: 'Selecciona un estado válido.' }

  const result = id
    ? await supabase.from('ideas').update({ title, notes, status }).eq('id', id).eq('user_id', user.id).neq('status', 'used').select('id').maybeSingle()
    : await supabase.from('ideas').insert({ user_id: user.id, title, notes, status }).select('id').maybeSingle()
  if (result.error || !result.data) return { error: 'No se pudo guardar la idea.' }

  revalidatePath('/')
  return { success: 'Idea guardada.' }
}

export async function archiveIdea(_previous: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const id = value(formData, 'id')
  if (!id) return { error: 'No encontramos la idea.' }

  const { data, error } = await supabase.from('ideas').update({ status: 'archived' }).eq('id', id).eq('user_id', user.id).neq('status', 'used').select('id').maybeSingle()
  if (error || !data) return { error: 'No se pudo archivar la idea.' }
  revalidatePath('/')
  return { success: 'Idea archivada.' }
}

export async function convertIdeaToDraft(_previous: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const id = value(formData, 'id')
  if (!id) return { error: 'No encontramos la idea.' }

  const { data: idea, error: readError } = await supabase.from('ideas').select('title,notes,status').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (readError || !idea || idea.status === 'used' || idea.status === 'archived') return { error: 'Esta idea ya no se puede convertir.' }

  const { data: claimed, error: claimError } = await supabase.from('ideas').update({ status: 'used' }).eq('id', id).eq('user_id', user.id).in('status', ['inbox', 'planned']).select('id').maybeSingle()
  if (claimError || !claimed) return { error: 'La idea cambió; actualiza la página e inténtalo de nuevo.' }

  const { error: publicationError } = await supabase.from('publications').insert({
    user_id: user.id,
    title: idea.title.slice(0, 200),
    body: idea.notes,
    status: 'draft',
  })
  if (publicationError) {
    await supabase.from('ideas').update({ status: idea.status }).eq('id', id).eq('user_id', user.id).eq('status', 'used')
    return { error: 'No se pudo crear el borrador. La idea sigue disponible.' }
  }

  revalidatePath('/')
  return { success: 'Idea convertida en borrador.' }
}
