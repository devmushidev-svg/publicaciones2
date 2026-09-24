import {
  BarChart3,
  CalendarDays,
  CircleHelp,
  FolderOpen,
  LayoutDashboard,
  Lightbulb,
  PenLine,
  Settings,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react'

const navItems = [
  { label: 'Inicio', icon: LayoutDashboard },
  { label: 'Publicaciones', icon: PenLine },
  { label: 'Biblioteca', icon: FolderOpen },
  { label: 'Calendario', icon: CalendarDays },
  { label: 'Ideas', icon: Lightbulb },
  { label: 'Rendimiento', icon: BarChart3 },
]

const secondaryItems = [
  { label: 'Conexiones', icon: TrendingUp },
  { label: 'Configuración', icon: Settings },
]

type DashboardSidebarProps = {
  active: string
  onSelect: (label: string) => void
  onClose: () => void
}

export function DashboardSidebar({ active, onSelect, onClose }: DashboardSidebarProps) {
  return (
    <>
      <div className="mb-10 flex items-center justify-between px-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[#222824] text-[#f5c86a]"><Sparkles className="size-4" /></div>
          <span className="font-serif text-xl font-semibold tracking-tight">norte.</span>
        </div>
        <button aria-label="Cerrar menú" className="lg:hidden" onClick={onClose}><X className="size-5" /></button>
      </div>
      <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#949a93]">Espacio de trabajo</p>
      <nav className="mt-3 flex flex-col gap-1" aria-label="Principal">
        {navItems.map(({ label, icon: Icon }) => (
          <button key={label} onClick={() => { onSelect(label); onClose() }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${active === label ? 'bg-[#e8ebe3] font-medium text-[#1f2422]' : 'text-[#777e77] hover:bg-[#eef0eb]'}`}>
            <Icon className="size-[17px]" />{label}
          </button>
        ))}
      </nav>
      <div className="my-7 h-px bg-[#e1e2dc]" />
      <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#949a93]">Cuenta</p>
      <nav className="mt-3 flex flex-col gap-1" aria-label="Cuenta">
        {secondaryItems.map(({ label, icon: Icon }) => (
          <button key={label} onClick={() => { onSelect(label); onClose() }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${active === label ? 'bg-[#e8ebe3] font-medium' : 'text-[#777e77] hover:bg-[#eef0eb]'}`}>
            <Icon className="size-[17px]" />{label}
          </button>
        ))}
      </nav>
      <div className="mt-auto rounded-2xl bg-[#e9eee5] p-4">
        <div className="mb-3 flex size-8 items-center justify-center rounded-full bg-[#f5c86a] text-[#67501b]"><CircleHelp className="size-4" /></div>
        <p className="text-sm font-medium">¿Necesitas una mano?</p>
        <p className="mt-1 text-xs leading-5 text-[#747b72]">Aprende a sacar más partido de tu contenido.</p>
        <button className="mt-3 text-xs font-semibold text-[#566451] underline underline-offset-4">Ver guía rápida</button>
      </div>
    </>
  )
}
