'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { publicationPlatforms } from '@/lib/dashboard/publications'
import type { ScheduleActionState } from '@/lib/dashboard/schedule'
import { dateTimeInputToIso } from '@/lib/date-time'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const platformValues = new Set<string>(publicationPlatforms.map(({ value }) => value))

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim()
}

async function authenticated() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

function scheduleError(code: string | undefined, message: string | undefined): string {
  if (code === 'P0002') return message?.includes('Campaign') ? 'La campaña no existe o está archivada.' : 'No encontramos esa publicación o programación activa.'
  if (code === '23505') return 'Esa publicación ya está programada ese mismo día.'
  if (code === '55000') return message?.includes('cancelled') || message?.includes('recorded use')
    ? 'Esta programación ya no se puede modificar: está cancelada o ya tiene uso registrado.'
    : 'Solo se pueden mover programaciones pendientes.'
  if (code === '22023') {
    if (message?.includes('outside the campaign')) return 'La fecha queda fuera de la vigencia de la campaña.'
    if (message?.includes('future')) return 'Elige una fecha y hora futuras.'
    if (message?.includes('reused')) return 'Esta solicitud ya se usó con otros datos. Cierra y vuelve a abrir el formulario.'
    return 'Revisa los datos de la programación.'
  }
  return 'No se pudo guardar la programación. Comprueba que la migración de calendario esté aplicada.'
}

export async function schedulePublication(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  const { supabase, user } = await authenticated()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const requestId = field(formData, 'request_id')
  const publicationId = field(formData, 'publication_id')
  const campaignId = field(formData, 'campaign_id')
  const timezone = field(formData, 'timezone') || 'America/Tegucigalpa'
  const notes = field(formData, 'notes')
  const platforms = [...new Set(formData.getAll('platforms').map(String))]
  if (!uuidPattern.test(requestId)) return { error: 'No pudimos validar el formulario. Ciérralo e inténtalo de nuevo.' }
  if (!uuidPattern.test(publicationId)) return { error: 'Selecciona una publicación.' }
  if (campaignId && !uuidPattern.test(campaignId)) return { error: 'Selecciona una campaña válida.' }
  if (platforms.some((platform) => !platformValues.has(platform))) return { error: 'Selecciona plataformas válidas.' }
  if (notes.length > 1000) return { error: 'Las notas deben tener máximo 1000 caracteres.' }

  const plannedFor = dateTimeInputToIso(field(formData, 'planned_for'), timezone)
  if (!plannedFor) return { error: 'La fecha u hora no existe en tu zona horaria.' }
  if (new Date(plannedFor).getTime() < Date.now() - 5 * 60_000) return { error: 'Elige una fecha y hora futuras.' }

  const { error } = await supabase.rpc('schedule_my_publication', {
    p_id: requestId,
    p_publication_id: publicationId,
    p_planned_for: plannedFor,
    p_platforms: platforms,
    p_campaign_id: campaignId || null,
    p_notes: notes,
  })
  if (error) return { error: scheduleError(error.code, error.message) }
  revalidatePath('/')
  return { success: 'Publicación programada. Recuerda registrar su uso cuando salga.' }
}

export async function reschedulePost(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  const { supabase, user } = await authenticated()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const id = field(formData, 'id')
  const campaignId = field(formData, 'campaign_id')
  const timezone = field(formData, 'timezone') || 'America/Tegucigalpa'
  if (!uuidPattern.test(id)) return { error: 'No encontramos esa programación.' }
  if (campaignId && !uuidPattern.test(campaignId)) return { error: 'Selecciona una campaña válida.' }
  const plannedFor = dateTimeInputToIso(field(formData, 'planned_for'), timezone)
  if (!plannedFor) return { error: 'La fecha u hora no existe en tu zona horaria.' }

  const { error } = await supabase.rpc('reschedule_my_post', { p_id: id, p_planned_for: plannedFor, p_campaign_id: campaignId || null })
  if (error) return { error: scheduleError(error.code, error.message) }
  revalidatePath('/')
  return { success: 'Programación movida.' }
}

/** Used by drag and drop: moves a slot to another ISO instant computed on the client. */
export async function moveScheduledPost(id: string, plannedForIso: string, campaignId: string | null): Promise<ScheduleActionState> {
  const { supabase, user } = await authenticated()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  if (!uuidPattern.test(id) || (campaignId && !uuidPattern.test(campaignId)) || Number.isNaN(Date.parse(plannedForIso))) {
    return { error: 'No se pudo mover la programación.' }
  }
  const { error } = await supabase.rpc('reschedule_my_post', { p_id: id, p_planned_for: new Date(plannedForIso).toISOString(), p_campaign_id: campaignId })
  if (error) return { error: scheduleError(error.code, error.message) }
  revalidatePath('/')
  return { success: 'Programación movida.' }
}

export async function cancelScheduledPost(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  const { supabase, user } = await authenticated()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const id = field(formData, 'id')
  if (!uuidPattern.test(id)) return { error: 'No encontramos esa programación.' }
  const { error } = await supabase.rpc('cancel_my_scheduled_post', { p_id: id })
  if (error) return { error: scheduleError(error.code, error.message) }
  revalidatePath('/')
  return { success: 'Programación cancelada.' }
}

export async function saveCampaign(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  const { supabase, user } = await authenticated()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const id = field(formData, 'id')
  const name = field(formData, 'name')
  const goal = field(formData, 'goal')
  const color = field(formData, 'color') || '#526e58'
  const startsOn = field(formData, 'starts_on')
  const endsOn = field(formData, 'ends_on')
  const targetValue = field(formData, 'target_posts')
  const target = targetValue ? Number(targetValue) : null

  if (id && !uuidPattern.test(id)) return { error: 'No encontramos esa campaña.' }
  if (!name || name.length > 120) return { error: 'El nombre es obligatorio y debe tener máximo 120 caracteres.' }
  if (goal.length > 1000) return { error: 'El objetivo debe tener máximo 1000 caracteres.' }
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return { error: 'Elige un color válido.' }
  if (!datePattern.test(startsOn) || !datePattern.test(endsOn) || Number.isNaN(Date.parse(startsOn)) || Number.isNaN(Date.parse(endsOn))) {
    return { error: 'Indica fechas de inicio y fin válidas.' }
  }
  if (endsOn < startsOn) return { error: 'La fecha de fin no puede ser anterior al inicio.' }
  if ((Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000 > 366) return { error: 'Una campaña puede durar como máximo un año.' }
  if (target !== null && (!Number.isInteger(target) || target < 1 || target > 1000)) return { error: 'La meta debe ser un número entre 1 y 1000.' }

  const { error } = await supabase.rpc('save_my_campaign', {
    p_id: id || null, p_name: name, p_goal: goal, p_color: color, p_starts_on: startsOn, p_ends_on: endsOn, p_target_posts: target,
  })
  if (error) {
    if (error.code === '22023' && error.message.includes('outside')) {
      const count = Number.parseInt(error.message, 10)
      return { error: `${Number.isFinite(count) ? count : 'Algunas'} programaciones quedarían fuera de las nuevas fechas. Muévelas o cancélalas primero.` }
    }
    if (error.code === 'P0002') return { error: 'No encontramos esa campaña.' }
    if (error.code === '22023') return { error: 'Revisa los datos de la campaña.' }
    return { error: 'No se pudo guardar la campaña. Comprueba que la migración de calendario esté aplicada.' }
  }
  revalidatePath('/')
  return { success: 'Campaña guardada.' }
}

export async function setCampaignArchived(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  const { supabase, user } = await authenticated()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }
  const id = field(formData, 'id')
  const archived = field(formData, 'archived') === 'true'
  if (!uuidPattern.test(id)) return { error: 'No encontramos esa campaña.' }
  const { error } = await supabase.rpc('set_my_campaign_archived', { p_id: id, p_archived: archived })
  if (error) return { error: 'No se pudo actualizar la campaña.' }
  revalidatePath('/')
  return { success: archived ? 'Campaña archivada.' : 'Campaña restaurada.' }
}
