'use client'

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CalendarPlus, ChevronLeft, ChevronRight, FilePlus2, MoveRight } from 'lucide-react'
import { PublicationDialog } from '@/components/dashboard/dashboard-publications'
import { MarkPublishedButton } from '@/components/dashboard/dashboard-publication-history'
import { ScheduleDialog, defaultPlannedInput } from '@/components/dashboard/dashboard-schedule-dialog'
import { DashboardCampaigns } from '@/components/dashboard/dashboard-campaigns'
import { cancelScheduledPost, moveScheduledPost } from '@/app/actions/schedule'
import type { PublicationRecord } from '@/lib/dashboard/publications'
import { campaignIsActiveOn, isOverdue, type CampaignRecord, type HistoryLiteRecord, type ScheduledPostRecord, type ScheduleActionState } from '@/lib/dashboard/schedule'
import { dateKeyInTimezone, dateTimeInputToIso, dateTimeInputValue, yearMonthInTimezone } from '@/lib/date-time'
import type { CategoryOption, TagOption } from '@/components/dashboard/dashboard-taxonomy'
import type { MediaAssetRecord } from '@/lib/dashboard/library'

const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const monthFormatter = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' })
const platformLabels: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', x: 'X' }

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function keyToDate(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateLabel(key: string) {
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(keyToDate(key))
}

type CalendarEntry =
  | { kind: 'slot'; id: string; at: string; slot: ScheduledPostRecord; title: string }
  | { kind: 'history'; id: string; at: string; platforms: string[]; title: string; publicationId: string; fromSlot: boolean }

type CalendarProps = {
  publications: PublicationRecord[]
  scheduledPosts: ScheduledPostRecord[]
  campaigns: CampaignRecord[]
  history: HistoryLiteRecord[]
  categories: CategoryOption[]
  tags: TagOption[]
  assets: MediaAssetRecord[]
  minimumRepeatDays: number
  hasError: boolean
  weekStartsOn?: number
  timezone?: string
}

function CancelSlotButton({ id }: { id: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<ScheduleActionState, FormData>(cancelScheduledPost, {})
  useEffect(() => { if (state.success) router.refresh() }, [router, state.success])
  return <form action={action} onSubmit={(event) => { if (!window.confirm('¿Cancelar esta programación? No borra la publicación.')) event.preventDefault() }}>
    <input type="hidden" name="id" value={id} />
    <button type="submit" disabled={pending} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#8c3e2f] hover:bg-[#f7e9e4] disabled:opacity-50"><Ban className="size-3.5" />{pending ? 'Cancelando…' : 'Cancelar'}</button>
    {state.error && <p role="alert" className="mt-1 text-xs text-[#8c3e2f]">{state.error}</p>}
  </form>
}

export function DashboardCalendar({ publications, scheduledPosts, campaigns, history, categories, tags, assets, minimumRepeatDays, hasError, weekStartsOn = 1, timezone = 'America/Tegucigalpa' }: CalendarProps) {
  const router = useRouter()
  const [view, setView] = useState<'calendar' | 'campaigns'>('calendar')
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const { year, month } = yearMonthInTimezone(new Date(), timezone)
    return new Date(year, month - 1, 1)
  })
  const [selectedDay, setSelectedDay] = useState(() => dateKeyInTimezone(new Date(), timezone))
  const [showCancelled, setShowCancelled] = useState(false)
  const [scheduling, setScheduling] = useState<{ date?: string; slot?: ScheduledPostRecord; campaignId?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [dragError, setDragError] = useState('')
  const [moving, startMove] = useTransition()
  const closeScheduling = useCallback(() => setScheduling(null), [])
  const closeCreating = useCallback(() => setCreating(false), [])

  const publicationById = useMemo(() => new Map(publications.map((item) => [item.id, item])), [publications])
  const campaignById = useMemo(() => new Map(campaigns.map((item) => [item.id, item])), [campaigns])
  const todayKey = dateKeyInTimezone(new Date(), timezone)

  const days = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
    const offset = (first.getDay() - weekStartsOn + 7) % 7
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  }, [visibleMonth, weekStartsOn])

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    const add = (key: string, entry: CalendarEntry) => map.set(key, [...(map.get(key) ?? []), entry])
    const fulfilledKeys = new Set(scheduledPosts.flatMap((slot) => slot.status === 'fulfilled' && slot.history_idempotency_key ? [slot.history_idempotency_key] : []))
    // Real use comes from the history; a fulfilled slot is represented by its history occasion.
    const occasions = new Map<string, Extract<CalendarEntry, { kind: 'history' }>>()
    for (const row of history) {
      const current = occasions.get(row.idempotency_key)
      if (current) { if (!current.platforms.includes(row.platform)) current.platforms.push(row.platform); continue }
      occasions.set(row.idempotency_key, { kind: 'history', id: row.idempotency_key, at: row.published_at, platforms: [row.platform], title: row.title_snapshot, publicationId: row.publication_id, fromSlot: fulfilledKeys.has(row.idempotency_key) })
    }
    for (const occasion of occasions.values()) add(dateKeyInTimezone(new Date(occasion.at), timezone), occasion)
    for (const slot of scheduledPosts) {
      if (slot.status === 'fulfilled' || (slot.status === 'cancelled' && !showCancelled)) continue
      add(dateKeyInTimezone(new Date(slot.planned_for), timezone), { kind: 'slot', id: slot.id, at: slot.planned_for, slot, title: publicationById.get(slot.publication_id)?.title ?? 'Publicación' })
    }
    for (const entries of map.values()) entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    return map
  }, [history, publicationById, scheduledPosts, showCancelled, timezone])

  const selectedEntries = entriesByDay.get(selectedDay) ?? []
  const selectedCampaigns = campaigns.filter((campaign) => campaignIsActiveOn(campaign, selectedDay))
  const pendingCount = scheduledPosts.filter((slot) => isOverdue(slot)).length

  const selectDate = (date: Date) => {
    setSelectedDay(dayKey(date))
    if (date.getMonth() !== visibleMonth.getMonth()) setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  const dropOnDay = (targetKey: string, slotId: string) => {
    const slot = scheduledPosts.find((item) => item.id === slotId)
    if (!slot || slot.status !== 'planned') return
    const time = dateTimeInputValue(slot.planned_for, timezone).slice(11)
    const iso = dateTimeInputToIso(`${targetKey}T${time}`, timezone)
    if (!iso) { setDragError('Esa hora no existe en tu zona horaria ese día.'); return }
    if (dateKeyInTimezone(new Date(slot.planned_for), timezone) === targetKey) return
    startMove(async () => {
      const result = await moveScheduledPost(slot.id, iso, slot.campaign_id)
      setDragError(result.error ?? '')
      if (!result.error) { setSelectedDay(targetKey); router.refresh() }
    })
  }

  return (
    <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase text-[#74816f]">Espacio de trabajo</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Calendario</h1><p className="mt-2 text-sm text-[#747b72]">Programación interna y usos registrados en el historial.</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCreating(true)} className="flex h-10 w-fit items-center gap-2 rounded-md border border-[#cdd1c8] px-4 text-sm font-medium text-[#465347] hover:bg-[#e8ebe3]"><FilePlus2 className="size-4" />Nueva publicación</button>
          <button onClick={() => setScheduling({ date: defaultPlannedInput(selectedDay < todayKey ? todayKey : selectedDay, timezone) })} className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b]"><CalendarPlus className="size-4" />Programar publicación</button>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-[#dedfd8]" role="tablist" aria-label="Vistas del calendario">
        <button type="button" role="tab" aria-selected={view === 'calendar'} onClick={() => setView('calendar')} className={`border-b-2 px-4 py-3 text-sm font-medium ${view === 'calendar' ? 'border-[#526e58] text-[#1f2422]' : 'border-transparent text-[#7b8279]'}`}>Calendario</button>
        <button type="button" role="tab" aria-selected={view === 'campaigns'} onClick={() => setView('campaigns')} className={`border-b-2 px-4 py-3 text-sm font-medium ${view === 'campaigns' ? 'border-[#526e58] text-[#1f2422]' : 'border-transparent text-[#7b8279]'}`}>Campañas <span className="text-xs text-[#929990]">{campaigns.filter((item) => !item.is_archived).length}</span></button>
      </div>

      {hasError && <p role="status" className="mb-5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No se pudo cargar toda la programación. Comprueba que la migración de calendario esté aplicada.</p>}

      {view === 'campaigns' ? <DashboardCampaigns campaigns={campaigns} scheduledPosts={scheduledPosts} publications={publications} timezone={timezone} onSchedule={(campaign) => setScheduling({ campaignId: campaign.id, date: defaultPlannedInput(campaign.starts_on > todayKey ? campaign.starts_on : todayKey, timezone) })} /> : <>
      {pendingCount > 0 && <p role="status" className="mb-4 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">{pendingCount} {pendingCount === 1 ? 'programación pasó' : 'programaciones pasaron'} sin registro. Ábrelas en el calendario para registrar su uso o cancelarlas.</p>}
      {dragError && <p role="alert" className="mb-4 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{dragError}</p>}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex items-center justify-between border-b border-[#dedfd8] pb-4">
            <h2 className="font-serif text-2xl capitalize">{monthFormatter.format(visibleMonth)}</h2>
            <div className="flex items-center gap-1">
              <label className="mr-3 hidden items-center gap-2 text-xs text-[#687168] sm:flex"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} className="size-4 accent-[#526e58]" />Mostrar canceladas</label>
              <button title="Mes anterior" aria-label="Mes anterior" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="rounded-md p-2 text-[#626b61] hover:bg-[#e8ebe3]"><ChevronLeft className="size-5" /></button>
              <button onClick={() => { const { year, month } = yearMonthInTimezone(new Date(), timezone); setVisibleMonth(new Date(year, month - 1, 1)); setSelectedDay(todayKey) }} className="rounded-md px-2.5 py-2 text-xs font-medium text-[#626b61] hover:bg-[#e8ebe3]">Hoy</button>
              <button title="Mes siguiente" aria-label="Mes siguiente" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="rounded-md p-2 text-[#626b61] hover:bg-[#e8ebe3]"><ChevronRight className="size-5" /></button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-[#dedfd8] py-2 text-center text-xs font-medium text-[#838a81]">
            {Array.from({ length: 7 }, (_, index) => weekdays[(weekStartsOn + index) % 7]).map((day) => <div key={day}>{day}</div>)}
          </div>
          <div className={`grid grid-cols-7 border-l border-[#e3e4de] ${moving ? 'opacity-70' : ''}`}>
            {days.map((day) => {
              const key = dayKey(day)
              const entries = entriesByDay.get(key) ?? []
              const inMonth = day.getMonth() === visibleMonth.getMonth()
              const dayCampaigns = campaigns.filter((campaign) => campaignIsActiveOn(campaign, key))
              return (
                <div
                  key={key}
                  onClick={() => selectDate(day)}
                  onDragOver={(event) => { if (key >= todayKey) event.preventDefault() }}
                  onDrop={(event) => { event.preventDefault(); dropOnDay(key, event.dataTransfer.getData('text/plain')) }}
                  className={`flex min-h-24 min-w-0 cursor-pointer flex-col items-stretch border-b border-r border-[#e3e4de] p-1.5 text-left transition-colors sm:min-h-28 sm:p-2 ${inMonth ? 'bg-[#fbfbf8]' : 'bg-[#f1f2ed]'} ${selectedDay === key ? 'ring-2 ring-inset ring-[#71866f]' : 'hover:bg-[#f0f2ec]'}`}
                >
                  <button type="button" aria-pressed={selectedDay === key} aria-label={dateLabel(key)} onClick={(event) => { event.stopPropagation(); selectDate(day) }} className={`mb-1 self-start text-xs ${key === todayKey ? 'flex size-6 items-center justify-center rounded-full bg-[#222824] font-semibold text-white' : inMonth ? 'text-[#515a51]' : 'text-[#a0a69e]'}`}>{day.getDate()}</button>
                  {!!dayCampaigns.length && <span className="mb-1 flex gap-0.5" aria-hidden="true">{dayCampaigns.slice(0, 3).map((campaign) => <span key={campaign.id} title={campaign.name} className="h-1 flex-1 rounded-full" style={{ backgroundColor: campaign.color }} />)}</span>}
                  <span className="flex min-w-0 flex-col gap-1">
                    {entries.slice(0, 3).map((entry) => {
                      if (entry.kind === 'history') return <span key={entry.id} title={`${entry.title} · publicada`} className="truncate rounded bg-[#e2eee5] px-1 py-0.5 text-[10px] leading-4 text-[#4c7557] sm:text-[11px]">{entry.title}</span>
                      const overdue = isOverdue(entry.slot)
                      const style = entry.slot.status === 'cancelled' ? 'bg-[#f0ece4] text-[#8a7f6a] line-through' : overdue ? 'bg-[#fbeed3] text-[#7c5b1d]' : 'bg-[#e6edf4] text-[#48627b]'
                      const draggable = entry.slot.status === 'planned'
                      return <span key={entry.id} draggable={draggable} onDragStart={(event) => { event.dataTransfer.setData('text/plain', entry.slot.id); event.dataTransfer.effectAllowed = 'move' }} title={`${entry.title}${draggable ? ' · arrastra para mover' : ''}`} className={`truncate rounded px-1 py-0.5 text-[10px] leading-4 sm:text-[11px] ${style} ${draggable ? 'cursor-grab' : ''}`}>{entry.title}</span>
                    })}
                    {entries.length > 3 && <span className="px-1 text-[10px] text-[#747b72]">+{entries.length - 3} más</span>}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#838a81]">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[#e6edf4]" />Programada (intención)</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[#fbeed3]" />Pendiente de confirmar</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[#e2eee5]" />Publicada según el historial</span>
            <span className="hidden sm:inline">Arrastra una programación a otro día para moverla.</span>
          </p>
        </div>

        <aside className="border-t border-[#dedfd8] pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <h2 className="font-serif text-xl capitalize">{dateLabel(selectedDay)}</h2>
          <p className="mt-1 text-xs text-[#838a81]">{selectedEntries.filter((entry) => entry.kind === 'slot' && entry.slot.status === 'planned').length} programadas · {selectedEntries.filter((entry) => entry.kind === 'history').length} publicadas</p>
          {!!selectedCampaigns.length && <div className="mt-3 flex flex-wrap gap-1.5">{selectedCampaigns.map((campaign) => <span key={campaign.id} className="flex items-center gap-1.5 rounded-full border border-[#dedfd8] px-2 py-0.5 text-[11px] text-[#596258]"><span className="size-2 rounded-full" style={{ backgroundColor: campaign.color }} />{campaign.name}</span>)}</div>}
          {selectedEntries.length ? <ul className="mt-4 divide-y divide-[#e3e4de]">
            {selectedEntries.map((entry) => {
              const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(entry.at))
              if (entry.kind === 'history') return <li key={entry.id} className="flex gap-3 py-3">
                <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-[#838a81]">{time}</span>
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{entry.title}</span><span className="mt-1 block text-xs text-[#4c7557]">Publicada{entry.fromSlot ? ' según lo programado' : ''} · {entry.platforms.map((value) => platformLabels[value] ?? value).join(', ')}</span></span>
              </li>
              const slot = entry.slot
              const publication = publicationById.get(slot.publication_id)
              const overdue = isOverdue(slot)
              const campaign = slot.campaign_id ? campaignById.get(slot.campaign_id) : undefined
              return <li key={entry.id} className="py-3">
                <div className="flex gap-3">
                  <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-[#838a81]">{time}</span>
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-medium ${slot.status === 'cancelled' ? 'line-through text-[#8a8f88]' : ''}`}>{entry.title}</span>
                    <span className={`mt-1 block text-xs ${slot.status === 'cancelled' ? 'text-[#8a7f6a]' : overdue ? 'text-[#7c5b1d]' : 'text-[#48627b]'}`}>{slot.status === 'cancelled' ? 'Cancelada' : overdue ? 'Pendiente de confirmar' : 'Programada'}{slot.platforms.length ? ` · ${slot.platforms.map((value) => platformLabels[value] ?? value).join(', ')}` : ''}</span>
                    {campaign && <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[#687168]"><span className="size-2 rounded-full" style={{ backgroundColor: campaign.color }} />{campaign.name}</span>}
                    {slot.notes && <span className="mt-1 block whitespace-pre-wrap text-[11px] text-[#838a81]">{slot.notes}</span>}
                  </span>
                </div>
                {slot.status === 'planned' && <div className="mt-2 flex flex-wrap items-start gap-1 pl-[3.75rem]">
                  {publication && publication.status !== 'archived' && <MarkPublishedButton publication={publication} timezone={timezone} slot={slot} label="Registrar uso" className="flex h-8 items-center gap-1.5 rounded-md border border-[#cdd1c8] px-2 text-xs font-medium text-[#465347] hover:bg-[#e8ebe3]" />}
                  <button type="button" onClick={() => setScheduling({ slot })} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#465347] hover:bg-[#e8ebe3]"><MoveRight className="size-3.5" />Mover</button>
                  <CancelSlotButton id={slot.id} />
                </div>}
              </li>
            })}
          </ul> : <div className="py-10 text-center"><p className="text-sm font-medium">Día sin publicaciones</p><p className="mt-1 text-xs text-[#838a81]">{selectedDay >= todayKey ? 'Puedes programar contenido para esta fecha.' : 'No hay usos registrados este día.'}</p></div>}
          {selectedDay >= todayKey && <button onClick={() => setScheduling({ date: defaultPlannedInput(selectedDay, timezone) })} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-[#cdd1c8] px-3 py-2.5 text-sm font-medium text-[#596258] hover:bg-[#e8ebe3]"><CalendarPlus className="size-4" />Programar para este día</button>}
          <label className="mt-4 flex items-center gap-2 text-xs text-[#687168] sm:hidden"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} className="size-4 accent-[#526e58]" />Mostrar canceladas</label>
        </aside>
      </div>
      </>}

      {scheduling && <ScheduleDialog key={scheduling.slot?.id ?? `${scheduling.date}-${scheduling.campaignId}`} publications={publications} campaigns={campaigns} slots={scheduledPosts} history={history} timezone={timezone} minimumRepeatDays={minimumRepeatDays} onClose={closeScheduling} slot={scheduling.slot ?? null} initialDate={scheduling.date} initialCampaignId={scheduling.campaignId} />}
      {creating && <PublicationDialog publication={null} onClose={closeCreating} timezone={timezone} categories={categories} tags={tags} assets={assets} />}
    </section>
  )
}
