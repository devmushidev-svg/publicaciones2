'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type RecommendationActionState = { error?: string; success?: string }

export async function saveRecommendationSettings(_previous: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const postsPerDay = Number(formData.get('posts_per_day'))
  const minimumRepeatDays = Number(formData.get('minimum_repeat_days'))
  const balanceWindowDays = Number(formData.get('balance_window_days'))
  if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > 10) return { error: 'Elige entre 1 y 10 sugerencias al día.' }
  if (!Number.isInteger(minimumRepeatDays) || minimumRepeatDays < 0 || minimumRepeatDays > 365) return { error: 'El descanso debe estar entre 0 y 365 días.' }
  if (!Number.isInteger(balanceWindowDays) || balanceWindowDays < 1 || balanceWindowDays > 365) return { error: 'El periodo de equilibrio debe estar entre 1 y 365 días.' }

  const { data: categories, error: categoriesError } = await supabase.from('categories').select('id').eq('user_id', user.id).eq('is_archived', false)
  if (categoriesError) return { error: 'No se pudieron cargar tus categorías.' }

  const categoryRows = []
  for (const category of categories ?? []) {
    const rawShare = String(formData.get(`target_${category.id}`) ?? '').trim()
    const percent = rawShare === '' ? null : Number(rawShare)
    const priority = Number(formData.get(`priority_${category.id}`) ?? 2)
    if ((percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) || !Number.isInteger(priority) || priority < 0 || priority > 5) {
      return { error: 'Revisa los porcentajes (0–100) y prioridades (0–5) de tus categorías.' }
    }
    categoryRows.push({
      category_id: category.id,
      target_share: percent === null ? null : percent / 100,
      priority,
      is_enabled: formData.get(`enabled_${category.id}`) === 'on',
    })
  }
  const { error } = await supabase.rpc('save_my_recommendation_settings', {
    p_posts_per_day: postsPerDay,
    p_minimum_repeat_days: minimumRepeatDays,
    p_balance_window_days: balanceWindowDays,
    p_categories: categoryRows.map(({ category_id, target_share, priority, is_enabled }) => ({ category_id, target_share, priority, is_enabled })),
  })
  if (error) return { error: 'No se pudieron guardar juntas las reglas. Comprueba que la migración de recomendaciones esté aplicada.' }

  revalidatePath('/')
  return { success: 'Preferencias del recomendador guardadas.' }
}
