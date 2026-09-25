'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type SettingsActionState = { error?: string; success?: string }

export async function saveSettings(_previous: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const fullName = String(formData.get('full_name') ?? '').trim()
  const timezone = String(formData.get('timezone') ?? '').trim()
  const weekStartsOn = Number(formData.get('week_starts_on'))
  const emailDigest = formData.get('email_digest') === 'on'
  if (!fullName || fullName.length > 100) return { error: 'El nombre es obligatorio y debe tener máximo 100 caracteres.' }
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) return { error: 'Selecciona el inicio de semana.' }
  try {
    new Intl.DateTimeFormat('es', { timeZone: timezone })
  } catch {
    return { error: 'Selecciona una zona horaria válida.' }
  }

  const { error } = await supabase.rpc('update_my_settings', {
    p_full_name: fullName,
    p_timezone: timezone,
    p_week_starts_on: weekStartsOn,
    p_email_digest: emailDigest,
  })
  if (error) {
    return { error: 'No se pudieron guardar todas las preferencias. Revisa la configuración de la base de datos e inténtalo de nuevo.' }
  }

  revalidatePath('/')
  return { success: 'Configuración guardada.' }
}
