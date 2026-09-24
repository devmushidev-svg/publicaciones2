import {
  ArrowUpRight,
  BookOpen,
  FilePlus2,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  MoreHorizontal,
  PenLine,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react'

const posts = [
  { time: '09:00', title: 'Rutinas simples para empezar el día', category: 'Bienestar', color: 'bg-[#e8c8a9]' },
  { time: '13:30', title: 'Lo que aprendimos esta semana', category: 'Comunidad', color: 'bg-[#c4d9d2]' },
  { time: '19:00', title: 'Una mirada detrás de escena', category: 'Marca', color: 'bg-[#d7c9e8]' },
]

const ideas = ['Cómo nació nuestra forma de trabajar', '3 aprendizajes de este mes', 'El mito que queremos desmontar']
const chartHeights = [28, 38, 31, 54, 42, 64, 49, 72, 63, 88, 70, 96]

export function DashboardOverview() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-sm text-[#8a9188]">Martes, 23 de septiembre de 2026</p>
          <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Buenos días, Ana<span className="text-[#c18d32]">.</span></h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-[#747b72]">Tu contenido está tomando forma. Aquí tienes lo importante para avanzar hoy.</p>
        </div>
        <button className="flex w-fit items-center gap-2 rounded-xl bg-[#222824] px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-[#39413b]"><Plus className="size-4" />Crear publicación</button>
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-3xl bg-[#222824] p-6 text-white sm:p-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.17em] text-[#adb9ac]"><Sparkles className="size-3.5 text-[#f5c86a]" />Recomendado para hoy</div>
              <h2 className="max-w-lg font-serif text-3xl leading-tight sm:text-4xl">Elige historias que conecten con tu comunidad.</h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-[#b4bdb4]">Hoy conviene mostrar el lado humano de la marca. Llevas 11 días sin publicar contenido de comunidad.</p>
            </div>
            <button aria-label="Más opciones" className="rounded-full p-2 text-[#aeb7ae] hover:bg-white/10"><MoreHorizontal className="size-5" /></button>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3"><button className="flex items-center gap-2 rounded-xl bg-[#f5c86a] px-4 py-2.5 text-sm font-semibold text-[#3c321c] hover:bg-[#f8d582]">Ver recomendación <ArrowUpRight className="size-4" /></button><span className="rounded-full border border-white/15 px-3 py-2 text-xs text-[#b4bdb4]">Basado en 48 publicaciones</span></div>
        </div>
        <div className="rounded-3xl border border-[#dedfd8] bg-[#fbfbf8] p-6 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="text-sm text-[#7f877e]">Rendimiento de ayer</p><p className="mt-2 text-3xl font-semibold tracking-tight">+24.8%</p></div><div className="flex size-11 items-center justify-center rounded-2xl bg-[#e2eee5] text-[#518060]"><TrendingUp className="size-5" /></div></div>
          <div className="mt-7 flex h-14 items-end gap-1.5">{chartHeights.map((height, i) => <div key={i} className={`flex-1 rounded-t-sm ${i > 8 ? 'bg-[#6e9d79]' : 'bg-[#c6ddca]'}`} style={{ height: `${height}%` }} />)}</div>
          <div className="mt-3 flex justify-between text-[11px] text-[#9aa198]"><span>Alcance total</span><span>12.4k personas</span></div>
        </div>
      </section>

      <section className="mt-8 grid gap-8 xl:grid-cols-[1.35fr_0.65fr]">
        <div>
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-serif text-2xl">Publicaciones de hoy</h2><p className="mt-1 text-sm text-[#858c84]">Una agenda equilibrada para mantener el ritmo.</p></div><button className="text-sm font-medium text-[#65705f] hover:underline">Ver calendario</button></div>
          <div className="overflow-hidden rounded-2xl border border-[#dedfd8] bg-[#fbfbf8]">{posts.map((post, i) => <div key={post.time} className={`flex items-center gap-4 px-4 py-4 sm:px-5 ${i !== posts.length - 1 ? 'border-b border-[#e5e6e0]' : ''}`}><span className="w-12 text-xs font-medium text-[#959b93]">{post.time}</span><div className={`size-11 shrink-0 rounded-xl ${post.color}`}><ImageIcon className="mx-auto mt-3 size-5 text-[#6c716b]/50" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{post.title}</p><p className="mt-1 text-xs text-[#929990]">{post.category} · Instagram + Facebook</p></div><button aria-label={`Editar ${post.title}`} className="rounded-lg p-2 text-[#929990] hover:bg-[#eef0eb]"><PenLine className="size-4" /></button></div>)}</div>
        </div>
        <div>
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-serif text-2xl">Ideas nuevas</h2><p className="mt-1 text-sm text-[#858c84]">Para cuando necesites inspiración.</p></div><Lightbulb className="size-5 text-[#c18d32]" /></div>
          <div className="flex flex-col gap-3">{ideas.map((idea, i) => <button key={idea} className="group flex items-center gap-3 rounded-2xl border border-[#dedfd8] bg-[#fbfbf8] p-4 text-left hover:border-[#c5cfc1]"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f1e6c9] text-xs font-semibold text-[#87682b]">0{i + 1}</span><span className="flex-1 text-sm font-medium leading-5">{idea}</span><ArrowUpRight className="size-4 text-[#a2aaa1] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></button>)}</div>
          <button className="mt-4 flex items-center gap-2 text-sm font-medium text-[#65705f] hover:underline"><Lightbulb className="size-4" />Generar más ideas</button>
        </div>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        <button className="flex items-center gap-3 rounded-2xl border border-dashed border-[#c8ccc4] bg-transparent p-4 text-left hover:bg-[#eef0eb]"><FilePlus2 className="size-5 text-[#778476]" /><span><strong className="block text-sm">Crear desde cero</strong><small className="text-xs text-[#929990]">Escribe una nueva publicación</small></span></button>
        <button className="flex items-center gap-3 rounded-2xl border border-dashed border-[#c8ccc4] bg-transparent p-4 text-left hover:bg-[#eef0eb]"><BookOpen className="size-5 text-[#778476]" /><span><strong className="block text-sm">Explorar biblioteca</strong><small className="text-xs text-[#929990]">Reutiliza contenido existente</small></span></button>
        <button className="flex items-center gap-3 rounded-2xl border border-dashed border-[#c8ccc4] bg-transparent p-4 text-left hover:bg-[#eef0eb]"><Hash className="size-5 text-[#778476]" /><span><strong className="block text-sm">Ver rendimiento</strong><small className="text-xs text-[#929990]">Aprende qué funciona mejor</small></span></button>
      </section>
    </div>
  )
}
