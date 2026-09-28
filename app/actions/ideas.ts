'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type IdeaActionState = { error?: string; success?: string }
export type IdeaStatus = 'inbox' | 'planned' | 'used' | 'archived'

const statuses = new Set<IdeaStatus>(['inbox', 'planned', 'used', 'archived'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const campaignId = value(formData, 'campaign_id') || null
  if (!title || title.length > 240) return { error: 'El título es obligatorio y debe tener máximo 240 caracteres.' }
  if (notes.length > 5000) return { error: 'Las notas deben tener máximo 5000 caracteres.' }
  if (!statuses.has(status) || status === 'used') return { error: 'Selecciona un estado válido.' }
  if (campaignId && !uuidPattern.test(campaignId)) return { error: 'Selecciona una campaña válida.' }

  const result = id
    ? await supabase.from('ideas').update({ title, notes, status, campaign_id: campaignId }).eq('id', id).eq('user_id', user.id).neq('status', 'used').select('id').maybeSingle()
    : await supabase.from('ideas').insert({ user_id: user.id, title, notes, status, campaign_id: campaignId }).select('id').maybeSingle()
  if (result.error?.code === '22023' || result.error?.code === '23503') return { error: 'Esa campaña ya no está disponible.' }
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

  if (!uuidPattern.test(id)) return { error: 'No encontramos la idea.' }

  // Atomic: creates the draft, marks the idea as used and links both. Retrying returns the same draft.
  const { error } = await supabase.rpc('convert_my_idea_to_draft', { p_idea_id: id })
  if (error) {
    if (error.code === 'P0002') return { error: 'No encontramos la idea.' }
    if (error.code === '55000') return { error: 'Esta idea ya no se puede convertir.' }
    return { error: 'No se pudo crear el borrador. La idea sigue disponible.' }
  }

  revalidatePath('/')
  return { success: 'Idea convertida en borrador.' }
}

export async function saveOpportunityAsIdea(_previous: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const sourceKey = value(formData, 'source_key')
  const title = value(formData, 'title').slice(0, 240)
  const notes = String(formData.get('notes') ?? '').trim().slice(0, 5000)
  const campaignId = value(formData, 'campaign_id') || null
  if (!sourceKey || sourceKey.length > 200 || !title) return { error: 'No se pudo guardar esta oportunidad.' }
  if (campaignId && !uuidPattern.test(campaignId)) return { error: 'No se pudo guardar esta oportunidad.' }

  const { error } = await supabase.rpc('save_my_opportunity_idea', { p_source_key: sourceKey, p_title: title, p_notes: notes, p_campaign_id: campaignId })
  if (error) return { error: 'No se pudo guardar la idea. Comprueba que la migración de ideas esté aplicada.' }
  revalidatePath('/')
  return { success: 'Guardada en tus ideas.' }
}
