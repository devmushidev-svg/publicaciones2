'use client'

import { useEffect, useRef, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar'
import type { OverviewData } from '@/lib/dashboard/overview'
import type { PublicationRecord } from '@/lib/dashboard/publications'
import { DashboardPublications, PublicationDialog } from '@/components/dashboard/dashboard-publications'
import { DashboardLibrary } from '@/components/dashboard/dashboard-library'
import type { MediaAssetRecord } from '@/lib/dashboard/library'
import { DashboardCalendar } from '@/components/dashboard/dashboard-calendar'
import { DashboardIdeas, type IdeaRecord } from '@/components/dashboard/dashboard-ideas'
import { DashboardPerformance, type MetricRecord } from '@/components/dashboard/dashboard-performance'
import { DashboardConnections, type SocialConnectionRecord } from '@/components/dashboard/dashboard-connections'
import { DashboardSettings } from '@/components/dashboard/dashboard-settings'
import { DashboardSearch } from '@/components/dashboard/dashboard-search'

type DashboardShellProps = {
  userName: string
  overview: OverviewData
  publications: PublicationRecord[]
  publicationsError: boolean
  assets: MediaAssetRecord[]
  mediaError: boolean
  storageError: boolean
  ideas: IdeaRecord[]
  ideasError: boolean
  metrics: MetricRecord[]
  metricsError: boolean
  connections: SocialConnectionRecord[]
  connectionsError: boolean
  settings: { email: string; fullName: string; timezone: string; weekStartsOn: number; emailDigest: boolean; hasError: boolean }
}

export function DashboardShell({ userName, overview, publications, publicationsError, assets, mediaError, storageError, ideas, ideasError, metrics, metricsError, connections, connectionsError, settings }: DashboardShellProps) {
  const [active, setActive] = useState('Inicio')
  const [searchTarget, setSearchTarget] = useState<{ section: string; query: string } | null>(null)
  const [homePublicationOpen, setHomePublicationOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mobileSidebarRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = mobileSidebarRef.current
    if (!dialog) return

    if (sidebarOpen && !dialog.open) dialog.showModal()
    if (!sidebarOpen && dialog.open) dialog.close()
  }, [sidebarOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const closeSidebar = () => setSidebarOpen(false)
  const navigateToSection = (section: string, query = '') => {
    setActive(section)
    setSearchTarget(query ? { section, query } : null)
  }
  const activeSearch = searchTarget?.section === active ? searchTarget.query : ''

  return (
    <div className="min-h-screen bg-[#f5f5f1] text-[#1f2422]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-[#dedfd8] bg-[#f8f8f4] px-5 py-6 lg:flex">
        <DashboardSidebar active={active} onSelect={navigateToSection} onClose={closeSidebar} />
      </aside>

      <dialog
        ref={mobileSidebarRef}
        id="mobile-workspace-sidebar"
        aria-label="Menú principal"
        className="fixed inset-y-0 left-0 m-0 flex h-full max-h-dvh w-[min(20rem,calc(100vw-2rem))] max-w-none flex-col overflow-y-auto border-0 bg-[#f8f8f4] p-5 text-[#1f2422] backdrop:bg-[#1f2422]/20 lg:hidden"
        onClose={closeSidebar}
      >
        <DashboardSidebar active={active} onSelect={navigateToSection} onClose={closeSidebar} />
      </dialog>

      <main className="lg:ml-[248px]">
        <DashboardHeader onOpenMenu={() => setSidebarOpen(true)} onSearch={() => setSearchOpen(true)} menuOpen={sidebarOpen} userName={userName} />
        {active === 'Biblioteca'
          ? <DashboardLibrary key={`library-${activeSearch}`} assets={assets} publications={publications} mediaError={mediaError} storageError={storageError} initialSearch={activeSearch} />
          : active === 'Calendario'
            ? <DashboardCalendar publications={publications} weekStartsOn={settings.weekStartsOn} timezone={settings.timezone} />
            : active === 'Ideas'
              ? <DashboardIdeas key={`ideas-${activeSearch}`} ideas={ideas} hasError={ideasError} initialSearch={activeSearch} />
              : active === 'Rendimiento'
                ? <DashboardPerformance metrics={metrics} publications={publications} hasError={metricsError} />
                : active === 'Conexiones'
                  ? <DashboardConnections connections={connections} hasError={connectionsError} />
                  : active === 'Configuración'
                    ? <DashboardSettings {...settings} />
                    : active === 'Publicaciones'
                      ? <DashboardPublications key={`publications-${activeSearch}`} publications={publications} hasError={publicationsError} timezone={settings.timezone} initialSearch={activeSearch} />
                      : <DashboardOverview userName={userName} overview={overview} onNavigate={(section) => navigateToSection(section)} onCreatePublication={() => setHomePublicationOpen(true)} />}
      </main>
      {homePublicationOpen && <PublicationDialog publication={null} onClose={() => setHomePublicationOpen(false)} timezone={settings.timezone} />}
      <DashboardSearch open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={navigateToSection} publications={publications} ideas={ideas} assets={assets} />
    </div>
  )
}
