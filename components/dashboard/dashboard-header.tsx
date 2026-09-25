import { Bell, ChevronDown, Menu, Search } from 'lucide-react'
import { signOut } from '@/app/actions/auth'

type DashboardHeaderProps = {
  menuOpen: boolean
  onOpenMenu: () => void
  userName: string
  onSearch: () => void
}

export function DashboardHeader({ menuOpen, onOpenMenu, userName, onSearch }: DashboardHeaderProps) {
  const initials = userName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')

  return (
    <header className="flex h-[76px] items-center justify-between border-b border-[#dedfd8] bg-[#f8f8f4]/80 px-5 backdrop-blur-md sm:px-8">
      <button aria-label="Abrir menú" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="mobile-workspace-sidebar" className="lg:hidden" onClick={onOpenMenu}><Menu className="size-5" /></button>
      <div className="hidden items-center gap-2 text-sm text-[#7a8179] sm:flex"><span>Espacio de trabajo</span><ChevronDown className="size-4" /></div>
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <button aria-label="Buscar" title="Buscar (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K" onClick={onSearch} className="rounded-full p-2 text-[#7d847c] hover:bg-[#e8ebe3]"><Search className="size-[18px]" /></button>
        <button aria-label="Notificaciones" className="relative rounded-full p-2 text-[#7d847c] hover:bg-[#e8ebe3]"><Bell className="size-[18px]" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#d87655]" /></button>
        <form action={signOut} className="ml-1 flex items-center gap-2 border-l border-[#dedfd8] pl-3">
          <div aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-[#d5ddd2] text-xs font-semibold">{initials || 'U'}</div>
          <span className="hidden max-w-40 truncate text-sm font-medium sm:block">{userName}</span>
          <button className="ml-1 rounded-md px-2 py-1.5 text-xs text-[#777e77] hover:bg-[#e8ebe3]" type="submit">Salir</button>
        </form>
      </div>
    </header>
  )
}
