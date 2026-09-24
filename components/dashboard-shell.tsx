'use client'

import { useEffect, useRef, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar'

export function DashboardShell() {
  const [active, setActive] = useState('Inicio')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mobileSidebarRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = mobileSidebarRef.current
    if (!dialog) return

    if (sidebarOpen && !dialog.open) dialog.showModal()
    if (!sidebarOpen && dialog.open) dialog.close()
  }, [sidebarOpen])

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="min-h-screen bg-[#f5f5f1] text-[#1f2422]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-[#dedfd8] bg-[#f8f8f4] px-5 py-6 lg:flex">
        <DashboardSidebar active={active} onSelect={setActive} onClose={closeSidebar} />
      </aside>

      <dialog
        ref={mobileSidebarRef}
        id="mobile-workspace-sidebar"
        aria-label="Menú principal"
        className="fixed inset-y-0 left-0 m-0 flex h-full max-h-dvh w-[min(20rem,calc(100vw-2rem))] max-w-none flex-col overflow-y-auto border-0 bg-[#f8f8f4] p-5 text-[#1f2422] backdrop:bg-[#1f2422]/20 lg:hidden"
        onClose={closeSidebar}
      >
        <DashboardSidebar active={active} onSelect={setActive} onClose={closeSidebar} />
      </dialog>

      <main className="lg:ml-[248px]">
        <DashboardHeader onOpenMenu={() => setSidebarOpen(true)} menuOpen={sidebarOpen} />
        <DashboardOverview />
      </main>
    </div>
  )
}
