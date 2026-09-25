import {
  ArrowUpRight,
  BookOpen,
  FilePlus2,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { OverviewData } from '@/lib/dashboard/overview'

type DashboardOverviewProps = {
  userName: string
  overview: OverviewData
  onNavigate: (section: string) => void
  onCreatePublication: () => void
}

const numberFormat = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 })

function timeLabel(value: string | null, timeZone: string) {
  if (!value) return 'Sin hora'
  return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(value))
}

export function DashboardOverview({ userName, overview, onNavigate, onCreatePublication }: DashboardOverviewProps) {
  const bars = overview.chart.map((value) => overview.chart.length ? (value / Math.max(...overview.chart, 1)) * 100 : 0)
  const greetingName = userName.split(/\s+/)[0]
  const hasReachData = overview.chart.some((value) => value > 0)

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-sm capitalize text-[#8a9188]">{overview.todayLabel}</p>
          <h1 className="font-serif text-4xl sm:text-5xl">Buenos días, {greetingName}<span className="text-[#c18d32]">.</span></h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-[#747b72]">Este es el resumen de tu espacio de contenido.</p>
        </div>
        <button onClick={onCreatePublication} className="flex w-fit items-center gap-2 rounded-xl bg-[#222824] px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-[#39413b]"><Plus className="size-4" />Crear publicación</button>
      </div>

      {overview.error && <p role="status" className="mb-5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">Algunos datos no se pudieron cargar. Actualiza la página para volver a intentarlo.</p>}

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-3xl bg-[#222824] p-6 text-white sm:p-8">
          <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase text-[#adb9ac]"><Sparkles className="size-3.5 text-[#f5c86a]" />Tu espacio de trabajo</div>
          <h2 className="max-w-lg font-serif text-3xl leading-tight sm:text-4xl">{overview.publications.length ? 'Tu contenido de hoy ya está en marcha.' : 'Dale forma a tu próxima publicación.'}</h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-[#b4bdb4]">{overview.publications.length ? `Tienes ${overview.publications.length} ${overview.publications.length === 1 ? 'publicación programada' : 'publicaciones programadas'} para hoy.` : 'Cuando programes contenido, aquí tendrás a la vista lo que toca publicar.'}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3"><span className="rounded-full border border-white/15 px-3 py-2 text-xs text-[#b4bdb4]">{overview.ideas.length} {overview.ideas.length === 1 ? 'idea pendiente' : 'ideas pendientes'}</span></div>
        </div>
        <div className="rounded-3xl border border-[#dedfd8] bg-[#fbfbf8] p-6 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="text-sm text-[#7f877e]">Alcance de ayer</p><p className="mt-2 text-3xl font-semibold">{hasReachData ? numberFormat.format(overview.reachYesterday) : 'Sin datos'}</p></div><div className="flex size-11 items-center justify-center rounded-2xl bg-[#e2eee5] text-[#518060]"><TrendingUp className="size-5" /></div></div>
          <div aria-label="Alcance diario de los últimos doce días" className="mt-7 flex h-14 items-end gap-1.5">
            {bars.map((height, index) => <div key={index} className={`flex-1 rounded-t-sm ${height > 0 ? 'bg-[#6e9d79]' : 'bg-[#e5e9e2]'}`} style={{ height: `${Math.max(height, 5)}%` }} />)}
          </div>
          <div className="mt-3 flex justify-between gap-2 text-[11px] text-[#9aa198]"><span>Últimos 12 días</span><span>{!hasReachData ? 'Aún no hay mediciones' : overview.reachChange === null ? 'Sin comparación' : `${overview.reachChange >= 0 ? '+' : ''}${overview.reachChange.toFixed(1)}% vs. día anterior`}</span></div>
        </div>
      </section>

      <section className="mt-8 grid gap-8 xl:grid-cols-[1.35fr_0.65fr]">
        <div>
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-serif text-2xl">Publicaciones de hoy</h2><p className="mt-1 text-sm text-[#858c84]">Tu calendario para mantener el ritmo.</p></div><button onClick={() => onNavigate('Calendario')} className="text-sm font-medium text-[#65705f] hover:underline">Ver calendario</button></div>
          <div className="overflow-hidden rounded-2xl border border-[#dedfd8] bg-[#fbfbf8]">
            {overview.publications.length ? overview.publications.map((post, index) => (
              <div key={post.id} className={`flex items-center gap-4 px-4 py-4 sm:px-5 ${index !== overview.publications.length - 1 ? 'border-b border-[#e5e6e0]' : ''}`}>
                <span className="w-12 shrink-0 text-xs font-medium text-[#959b93]">{timeLabel(post.scheduled_for, overview.timezone)}</span>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e8ece5]"><ImageIcon className="size-5 text-[#7a8477]" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{post.title}</p><p className="mt-1 truncate text-xs text-[#929990]">{post.category || 'Sin categoría'}{post.platforms.length ? ` · ${post.platforms.join(' + ')}` : ''}</p></div>
              </div>
            )) : <p className="px-5 py-8 text-sm text-[#858c84]">No tienes publicaciones programadas para hoy.</p>}
          </div>
        </div>
        <div>
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-serif text-2xl">Ideas nuevas</h2><p className="mt-1 text-sm text-[#858c84]">Tu lista para cuando necesites inspiración.</p></div><Lightbulb className="size-5 text-[#c18d32]" /></div>
          <div className="flex flex-col gap-3">
            {overview.ideas.length ? overview.ideas.map((idea, index) => <button key={idea.id} onClick={() => onNavigate('Ideas')} className="group flex items-center gap-3 rounded-2xl border border-[#dedfd8] bg-[#fbfbf8] p-4 text-left hover:border-[#c5cfc1]"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f1e6c9] text-xs font-semibold text-[#87682b]">{String(index + 1).padStart(2, '0')}</span><span className="flex-1 text-sm font-medium leading-5">{idea.title}</span><ArrowUpRight className="size-4 text-[#a2aaa1] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></button>) : <p className="rounded-2xl border border-[#dedfd8] bg-[#fbfbf8] p-4 text-sm text-[#858c84]">Todavía no hay ideas guardadas.</p>}
          </div>
          <button onClick={() => onNavigate('Ideas')} className="mt-4 flex items-center gap-2 text-sm font-medium text-[#65705f] hover:underline"><Lightbulb className="size-4" />Añadir una idea</button>
        </div>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        <button onClick={onCreatePublication} className="flex items-center gap-3 rounded-2xl border border-dashed border-[#c8ccc4] bg-transparent p-4 text-left hover:bg-[#eef0eb]"><FilePlus2 className="size-5 text-[#778476]" /><span><strong className="block text-sm">Crear desde cero</strong><small className="text-xs text-[#929990]">Escribe una nueva publicación</small></span></button>
        <button onClick={() => onNavigate('Biblioteca')} className="flex items-center gap-3 rounded-2xl border border-dashed border-[#c8ccc4] bg-transparent p-4 text-left hover:bg-[#eef0eb]"><BookOpen className="size-5 text-[#778476]" /><span><strong className="block text-sm">Explorar biblioteca</strong><small className="text-xs text-[#929990]">Reutiliza contenido existente</small></span></button>
        <button onClick={() => onNavigate('Rendimiento')} className="flex items-center gap-3 rounded-2xl border border-dashed border-[#c8ccc4] bg-transparent p-4 text-left hover:bg-[#eef0eb]"><Hash className="size-5 text-[#778476]" /><span><strong className="block text-sm">Ver rendimiento</strong><small className="text-xs text-[#929990]">Aprende qué funciona mejor</small></span></button>
      </section>
    </div>
  )
}
