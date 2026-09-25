'use client'

import { useState } from 'react'
import { BarChart3, MousePointerClick, UsersRound, Eye, Heart } from 'lucide-react'
import type { PublicationRecord } from '@/lib/dashboard/publications'

export type MetricRecord = { id: string; publication_id: string | null; platform: string; measured_on: string; reach: number; impressions: number; engagements: number; clicks: number }
const platformNames: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', x: 'X' }
const periods = [7, 30, 90] as const

export function DashboardPerformance({ metrics, publications, hasError }: { metrics: MetricRecord[]; publications: PublicationRecord[]; hasError: boolean }) {
  const [period, setPeriod] = useState<(typeof periods)[number]>(30)
  const start = new Date()
  start.setDate(start.getDate() - period + 1)
  const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  const rows = metrics.filter((metric) => metric.measured_on >= startKey)
  const totals = rows.reduce((sum, row) => ({ reach: sum.reach + row.reach, impressions: sum.impressions + row.impressions, engagements: sum.engagements + row.engagements, clicks: sum.clicks + row.clicks }), { reach: 0, impressions: 0, engagements: 0, clicks: 0 })
  const dayMap = new Map<string, number>()
  const platformMap = new Map<string, { reach: number; impressions: number; engagements: number; clicks: number }>()
  const publicationMap = new Map<string, number>()
  for (const row of rows) {
    dayMap.set(row.measured_on, (dayMap.get(row.measured_on) ?? 0) + row.reach)
    const platform = platformMap.get(row.platform) ?? { reach: 0, impressions: 0, engagements: 0, clicks: 0 }
    platform.reach += row.reach
    platform.impressions += row.impressions
    platform.engagements += row.engagements
    platform.clicks += row.clicks
    platformMap.set(row.platform, platform)
    if (row.publication_id) publicationMap.set(row.publication_id, (publicationMap.get(row.publication_id) ?? 0) + row.reach)
  }
  const byDay = Array.from({ length: period }, (_, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    return [key, dayMap.get(key) ?? 0] as [string, number]
  })
  const byPlatform = [...platformMap.entries()].sort((a, b) => b[1].reach - a[1].reach)
  const byPublication = [...publicationMap.entries()].map(([id, reach]) => ({ publication: publications.find((item) => item.id === id), reach })).filter((item): item is { publication: PublicationRecord; reach: number } => Boolean(item.publication)).sort((a, b) => b.reach - a.reach).slice(0, 5)
  const maxReach = Math.max(1, ...byDay.map(([, reach]) => reach))
  const number = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 })
  const stats = [
    { label: 'Alcance acumulado', value: totals.reach, icon: UsersRound, color: 'text-[#52785b] bg-[#e2eee5]' },
    { label: 'Impresiones', value: totals.impressions, icon: Eye, color: 'text-[#526d87] bg-[#e5edf4]' },
    { label: 'Interacciones', value: totals.engagements, icon: Heart, color: 'text-[#a15d48] bg-[#f5e8e2]' },
    { label: 'Clics', value: totals.clicks, icon: MousePointerClick, color: 'text-[#87682b] bg-[#f1e6c9]' },
  ]

  return <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase text-[#74816f]">Espacio de trabajo</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Rendimiento</h1><p className="mt-2 text-sm text-[#747b72]">Resultados registrados para tus publicaciones.</p></div><div className="flex rounded-md border border-[#d7dad2] p-1" role="group" aria-label="Período de métricas">{periods.map((value) => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)} className={`rounded px-3 py-1.5 text-xs font-medium ${period === value ? 'bg-[#222824] text-white' : 'text-[#687168] hover:bg-[#eef0eb]'}`}>{value} días</button>)}</div></div>
    {hasError && <p role="status" className="mb-5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No se pudieron cargar todas las métricas.</p>}
    {rows.length ? <>
      <p className="mb-4 text-xs text-[#858c84]">Totales de {period} días; se suman las mediciones guardadas en ese período.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, icon: Icon, color }) => <article key={label} className="flex items-center justify-between border-b border-[#dedfd8] bg-[#fbfbf8] p-4"><div><p className="text-xs text-[#7f877e]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{number.format(value)}</p></div><div className={`flex size-10 items-center justify-center rounded-full ${color}`}><Icon className="size-4" /></div></article>)}</div>
      <div className="mt-8 grid gap-8 xl:grid-cols-[1.3fr_0.7fr]">
        <section><div className="mb-3 flex items-center gap-2"><BarChart3 className="size-4 text-[#74816f]" /><h2 className="font-serif text-xl">Alcance diario</h2></div><div className="flex h-56 items-end gap-1 border-b border-[#dedfd8] px-1 sm:gap-2">{byDay.map(([date, reach]) => <div key={date} title={`${date}: ${number.format(reach)}`} className="group flex h-full min-w-0 flex-1 flex-col justify-end"><span className="mb-1 hidden truncate text-center text-[10px] text-[#747b72] group-hover:block">{number.format(reach)}</span><div className="min-h-1 rounded-t-sm bg-[#6e9d79]" style={{ height: `${Math.max(2, reach / maxReach * 100)}%` }} /></div>)}</div><div className="mt-2 flex justify-between text-[10px] text-[#929990]"><span>{byDay[0]?.[0] ?? ''}</span><span>{byDay.at(-1)?.[0] ?? ''}</span></div></section>
        <section><h2 className="mb-3 font-serif text-xl">Por plataforma</h2>{byPlatform.length ? <div className="divide-y divide-[#e3e4de]">{byPlatform.map(([platform, values]) => <div key={platform} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{platformNames[platform] ?? platform}</p><p className="mt-1 text-xs text-[#858c84]">{number.format(values.impressions)} impresiones · {number.format(values.engagements)} interacciones</p></div><span className="text-sm font-semibold tabular-nums">{number.format(values.reach)}</span></div>)}</div> : <p className="py-8 text-sm text-[#858c84]">No hay métricas por plataforma en este período.</p>}</section>
      </div>
      <section className="mt-8"><h2 className="mb-3 font-serif text-xl">Publicaciones con mayor alcance</h2>{byPublication.length ? <div className="divide-y divide-[#e3e4de] border-y border-[#e3e4de]">{byPublication.map(({ publication, reach }) => <div key={publication.id} className="flex items-center justify-between gap-4 py-3"><span className="truncate text-sm font-medium">{publication.title}</span><span className="shrink-0 text-sm tabular-nums text-[#596258]">{number.format(reach)}</span></div>)}</div> : <p className="py-5 text-sm text-[#858c84]">Hay métricas, pero no están asociadas a publicaciones.</p>}</section>
    </> : <div className="flex flex-col items-center py-20 text-center"><div className="mb-4 flex size-11 items-center justify-center rounded-full bg-[#e8ebe3] text-[#667361]"><BarChart3 className="size-5" /></div><h2 className="text-sm font-semibold">{hasError ? 'No pudimos consultar las métricas' : 'Aún no hay métricas'}</h2><p className="mt-1 max-w-md text-sm text-[#838a81]">{hasError ? 'Comprueba la conexión con Supabase e inténtalo de nuevo.' : 'Cuando se registren resultados de tus redes, el alcance, las impresiones y las interacciones aparecerán aquí. No mostramos cifras de ejemplo.'}</p></div>}
  </section>
}
