'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Save } from 'lucide-react'
import { saveRecommendationSettings, type RecommendationActionState } from '@/app/actions/recommendations'
import type { CategoryOption } from '@/components/dashboard/dashboard-taxonomy'

type Props = {
  categories: CategoryOption[]
  settings: { postsPerDay: number; minimumRepeatDays: number; balanceWindowDays: number }
  preferences: Array<{ category_id: string; target_share: number | null; priority: number; is_enabled: boolean }>
  hasError: boolean
}

export function DashboardRecommendationSettings({ categories, settings, preferences, hasError }: Props) {
  const router = useRouter()
  const [state, action, pending] = useActionState<RecommendationActionState, FormData>(saveRecommendationSettings, {})
  useEffect(() => { if (state.success) router.refresh() }, [router, state.success])
  const saved = new Map(preferences.map((item) => [item.category_id, item]))
  const activeCategories = categories.filter((category) => !category.is_archived)

  return <section className="mx-auto max-w-[1000px] px-5 pb-8 sm:px-8 lg:px-10">
    <div className="mb-5 border-t border-[#dedfd8] pt-6"><p className="text-xs font-semibold uppercase text-[#74816f]">Contenido inteligente</p><h2 className="mt-2 font-serif text-2xl">Recomendaciones diarias</h2><p className="mt-1 text-sm text-[#747b72]">Ajusta el ritmo, la variedad y el descanso antes de reutilizar contenido.</p></div>
    {(hasError || state.error) && <p role="alert" className="mb-4 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">{state.error || 'No se pudieron cargar las preferencias del recomendador. Comprueba que la migración esté aplicada.'}</p>}
    {state.success && <p role="status" className="mb-4 flex items-center gap-2 text-sm text-[#45694c]"><Check className="size-4" />{state.success}</p>}
    <form action={action} className="border-y border-[#dedfd8] py-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-medium">Sugerencias por día<select name="posts_per_day" defaultValue={settings.postsPerDay} className="mt-1.5 h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3">{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-sm font-medium">Días antes de reutilizar<input type="number" name="minimum_repeat_days" min={0} max={365} defaultValue={settings.minimumRepeatDays} className="mt-1.5 h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3" /></label>
        <label className="text-sm font-medium">Equilibrio de categorías (días)<input type="number" name="balance_window_days" min={1} max={365} defaultValue={settings.balanceWindowDays} className="mt-1.5 h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3" /></label>
      </div>
      {activeCategories.length > 0 && <div className="mt-6"><div className="mb-2 grid grid-cols-[1fr_6rem_6rem] gap-3 text-xs font-semibold text-[#858c84]"><span>Categoría</span><span>Objetivo %</span><span>Prioridad</span></div>{activeCategories.map((category) => {
        const preference = saved.get(category.id)
        return <div key={category.id} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-3 border-t border-[#e5e6e0] py-2.5">
          <label className="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" name={`enabled_${category.id}`} defaultChecked={preference?.is_enabled ?? true} className="size-4 accent-[#526e58]" /><span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: category.color }} /><span className="truncate">{category.name}</span></label>
          <input aria-label={`Porcentaje objetivo de ${category.name}`} name={`target_${category.id}`} type="number" min={0} max={100} step={1} defaultValue={preference?.target_share == null ? '' : Math.round(preference.target_share * 100)} placeholder="Auto" className="h-9 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-2 text-sm" />
          <input aria-label={`Prioridad de ${category.name}`} name={`priority_${category.id}`} type="number" min={0} max={5} defaultValue={preference?.priority ?? 2} className="h-9 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-2 text-sm" />
        </div>
      })}</div>}
      {!activeCategories.length && <p className="mt-5 text-sm text-[#858c84]">Crea categorías para definir su prioridad y proporción.</p>}
      <div className="mt-5 flex justify-end"><button type="submit" disabled={pending} className="flex h-10 items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-55"><Save className="size-4" />{pending ? 'Guardando…' : 'Guardar recomendaciones'}</button></div>
    </form>
  </section>
}
