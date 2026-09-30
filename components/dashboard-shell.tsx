'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar'
import type { OverviewData } from '@/lib/dashboard/overview'
import type { PublicationHistoryRecord, PublicationRecord } from '@/lib/dashboard/publications'
import { DashboardPublications, PublicationDialog } from '@/components/dashboard/dashboard-publications'
import { DashboardLibrary } from '@/components/dashboard/dashboard-library'
import type { MediaAssetRecord } from '@/lib/dashboard/library'
import { DashboardCalendar } from '@/components/dashboard/dashboard-calendar'
import { DashboardIdeas, type IdeaRecord } from '@/components/dashboard/dashboard-ideas'
import { DashboardPerformance, type MetricRecord } from '@/components/dashboard/dashboard-performance'
import { DashboardConnections, type SocialConnectionRecord } from '@/components/dashboard/dashboard-connections'
import { DashboardSettings } from '@/components/dashboard/dashboard-settings'
import { DashboardSearch } from '@/components/dashboard/dashboard-search'
import { DashboardTaxonomy, type CategoryOption, type TagOption } from '@/components/dashboard/dashboard-taxonomy'
import { DashboardRecommendationSettings } from '@/components/dashboard/dashboard-recommendation-settings'
import { DashboardAiCopy } from '@/components/dashboard/dashboard-ai-copy'
import { ScheduleDialog } from '@/components/dashboard/dashboard-schedule-dialog'
import type { CampaignRecord, HistoryLiteRecord, ScheduledPostRecord } from '@/lib/dashboard/schedule'
import type { ActivityCategory } from '@/lib/insights/activity'
import type { Opportunity } from '@/lib/insights/opportunities'

type DashboardShellProps = {
  userName: string
  overview: OverviewData
  publications: PublicationRecord[]
  history: PublicationHistoryRecord[]
  publicationsError: boolean
  historyError: boolean
  categories: CategoryOption[]
  tags: TagOption[]
  taxonomyError: boolean
  recommendationSettings: { postsPerDay: number; minimumRepeatDays: number; balanceWindowDays: number }
  categoryPreferences: Array<{ category_id: string; target_share: number | null; priority: number; is_enabled: boolean }>
  recommendationSettingsError: boolean
  insightCategories: ActivityCategory[]
  scheduledPosts: ScheduledPostRecord[]
  campaigns: CampaignRecord[]
  historyLite: HistoryLiteRecord[]
  opportunities: Opportunity[]
  scheduleError: boolean
  assets: MediaAssetRecord[]
  mediaError: boolean
  storageError: boolean
  ideas: IdeaRecord[]
  ideasError: boolean
  aiMonthlyUsage: number | null
  metrics: MetricRecord[]
  metricsError: boolean
  connections: SocialConnectionRecord[]
  connectionsError: boolean
  initialSection: string
  metaStatus: string | null
  metaConfigured: boolean
  asOf: number
  settings: { email: string; fullName: string; timezone: string; weekStartsOn: number; emailDigest: boolean; hasError: boolean }
}

export function DashboardShell({ userName, overview, publications, history, publicationsError, historyError, categories, tags, taxonomyError, recommendationSettings, categoryPreferences, recommendationSettingsError, insightCategories, scheduledPosts, campaigns, historyLite, opportunities, scheduleError, assets, mediaError, storageError, ideas, ideasError, aiMonthlyUsage, metrics, metricsError, connections, connectionsError, initialSection, metaStatus, metaConfigured, asOf, settings }: DashboardShellProps) {
  const [active, setActive] = useState(initialSection)
  const [searchTarget, setSearchTarget] = useState<{ section: string; query: string } | null>(null)
  const [homePublicationOpen, setHomePublicationOpen] = useState(false)
  const [scheduleRequest, setScheduleRequest] = useState<{ publicationId?: string; campaignId?: string } | null>(null)
  const openSchedule = useCallback((publicationId?: string, campaignId?: string) => setScheduleRequest({ publicationId, campaignId }), [])
  const closeSchedule = useCallback(() => setScheduleRequest(null), [])
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
          ? <DashboardLibrary key={`library-${activeSearch}`} assets={assets} publications={publications} categories={categories} tags={tags} timezone={settings.timezone} publicationsError={publicationsError} mediaError={mediaError} storageError={storageError} initialSearch={activeSearch} />
          : active === 'Calendario'
          ? <DashboardCalendar publications={publications} scheduledPosts={scheduledPosts} campaigns={campaigns} history={historyLite} categories={categories} tags={tags} assets={assets} minimumRepeatDays={recommendationSettings.minimumRepeatDays} hasError={scheduleError} weekStartsOn={settings.weekStartsOn} timezone={settings.timezone} />
            : active === 'Ideas'
              ? <DashboardIdeas key={`ideas-${activeSearch}`} ideas={ideas} hasError={ideasError} initialSearch={activeSearch} opportunities={opportunities} campaigns={campaigns} publications={publications} onSchedule={openSchedule} onNavigate={navigateToSection} />
              : active === 'Crear con IA'
                ? <DashboardAiCopy initialUsed={aiMonthlyUsage} />
              : active === 'Rendimiento'
                ? <DashboardPerformance metrics={metrics} publications={publications} hasError={metricsError} history={historyLite} scheduledPosts={scheduledPosts} categories={insightCategories} postsPerDay={recommendationSettings.postsPerDay} timezone={settings.timezone} activityError={scheduleError} />
                : active === 'Conexiones'
                  ? <DashboardConnections connections={connections} hasError={connectionsError} metaStatus={metaStatus} metaConfigured={metaConfigured} asOf={asOf} />
                  : active === 'Configuración'
                    ? <><DashboardSettings {...settings} /><DashboardRecommendationSettings categories={categories} settings={recommendationSettings} preferences={categoryPreferences} hasError={recommendationSettingsError} /><DashboardTaxonomy categories={categories} tags={tags} hasError={taxonomyError} /></>
                    : active === 'Publicaciones'
                      ? <DashboardPublications key={`publications-${activeSearch}`} publications={publications} history={history} hasError={publicationsError} historyError={historyError} timezone={settings.timezone} categories={categories} tags={tags} assets={assets} initialSearch={activeSearch} scheduledPosts={scheduledPosts} onSchedule={openSchedule} />
                      : <DashboardOverview userName={userName} overview={overview} opportunityCount={opportunities.length} onNavigate={(section) => navigateToSection(section)} onCreatePublication={() => setHomePublicationOpen(true)} onSchedule={openSchedule} />}
      </main>
      {homePublicationOpen && <PublicationDialog publication={null} onClose={() => setHomePublicationOpen(false)} timezone={settings.timezone} categories={categories} tags={tags} assets={assets} />}
      {scheduleRequest && <ScheduleDialog publications={publications} campaigns={campaigns} slots={scheduledPosts} history={historyLite} timezone={settings.timezone} minimumRepeatDays={recommendationSettings.minimumRepeatDays} onClose={closeSchedule} initialPublicationId={scheduleRequest.publicationId} initialCampaignId={scheduleRequest.campaignId} />}
      <DashboardSearch open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={navigateToSection} publications={publications} ideas={ideas} assets={assets} />
    </div>
  )
}
