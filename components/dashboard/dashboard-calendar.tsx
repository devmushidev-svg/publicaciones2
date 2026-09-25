'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FilePlus2 } from 'lucide-react'
import { PublicationDialog } from '@/components/dashboard/dashboard-publications'
import type { PublicationRecord } from '@/lib/dashboard/publications'
import { dateKeyInTimezone, yearMonthInTimezone } from '@/lib/date-time'

const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const monthFormatter = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' })

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDateTime(date: Date) {
  return `${dayKey(date)}T09:00`
}

function publicationDate(publication: PublicationRecord) {
  const value = publication.status === 'published' ? publication.published_at : publication.scheduled_for
  return value ? new Date(value) : null
}

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

export function DashboardCalendar({ publications, weekStartsOn = 1, timezone = 'America/Tegucigalpa' }: { publications: PublicationRecord[]; weekStartsOn?: number; timezone?: string }) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const { year, month } = yearMonthInTimezone(new Date(), timezone)
    return new Date(year, month - 1, 1)
  })
  const [selectedDay, setSelectedDay] = useState(() => dateKeyInTimezone(new Date(), timezone))
  const [newDate, setNewDate] = useState<string | null>(null)
  const [editing, setEditing] = useState<PublicationRecord | null>(null)
  const closeDialog = useCallback(() => {
    setNewDate(null)
    setEditing(null)
  }, [])

  const days = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
    const offset = (first.getDay() - weekStartsOn + 7) % 7
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  }, [visibleMonth, weekStartsOn])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, PublicationRecord[]>()
    for (const publication of publications) {
      if (publication.status === 'archived' || publication.status === 'draft') continue
      const date = publicationDate(publication)
      if (!date || Number.isNaN(date.getTime())) continue
      const key = dateKeyInTimezone(date, timezone)
      map.set(key, [...(map.get(key) ?? []), publication])
    }
    for (const events of map.values()) events.sort((a, b) => (publicationDate(a)?.getTime() ?? 0) - (publicationDate(b)?.getTime() ?? 0))
    return map
  }, [publications, timezone])

  const selectedEvents = eventsByDay.get(selectedDay) ?? []
  const selectedDate = new Date(`${selectedDay}T12:00:00`)
  const todayKey = dateKeyInTimezone(new Date(), timezone)

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1))
  }

  const selectDate = (date: Date) => {
    setSelectedDay(dayKey(date))
    if (date.getMonth() !== visibleMonth.getMonth()) setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  return (
    <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase text-[#74816f]">Espacio de trabajo</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Calendario</h1><p className="mt-2 text-sm text-[#747b72]">Publicaciones programadas y contenido publicado.</p></div>
        <button onClick={() => setNewDate(localDateTime(selectedDate))} className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b]"><FilePlus2 className="size-4" />Programar publicación</button>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="flex items-center justify-between border-b border-[#dedfd8] pb-4">
            <h2 className="font-serif text-2xl capitalize">{monthFormatter.format(visibleMonth)}</h2>
            <div className="flex items-center gap-1">
              <button title="Mes anterior" aria-label="Mes anterior" onClick={() => moveMonth(-1)} className="rounded-md p-2 text-[#626b61] hover:bg-[#e8ebe3]"><ChevronLeft className="size-5" /></button>
              <button onClick={() => { const today = new Date(); setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDay(dayKey(today)) }} className="rounded-md px-2.5 py-2 text-xs font-medium text-[#626b61] hover:bg-[#e8ebe3]">Hoy</button>
              <button title="Mes siguiente" aria-label="Mes siguiente" onClick={() => moveMonth(1)} className="rounded-md p-2 text-[#626b61] hover:bg-[#e8ebe3]"><ChevronRight className="size-5" /></button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-[#dedfd8] py-2 text-center text-xs font-medium text-[#838a81]">
            {Array.from({ length: 7 }, (_, index) => weekdays[(weekStartsOn + index) % 7]).map((day) => <div key={day}>{day}</div>)}
          </div>
          <div className="grid grid-cols-7 border-l border-[#e3e4de]">
            {days.map((day) => {
              const key = dayKey(day)
              const events = eventsByDay.get(key) ?? []
              const inMonth = day.getMonth() === visibleMonth.getMonth()
              return (
                <button key={key} onClick={() => selectDate(day)} aria-pressed={selectedDay === key} className={`flex min-h-24 min-w-0 flex-col items-stretch border-b border-r border-[#e3e4de] p-1.5 text-left transition-colors sm:min-h-28 sm:p-2 ${inMonth ? 'bg-[#fbfbf8]' : 'bg-[#f1f2ed]'} ${selectedDay === key ? 'ring-2 ring-inset ring-[#71866f]' : 'hover:bg-[#f0f2ec]'}`}>
                  <span className={`mb-1 self-start text-xs ${key === todayKey ? 'flex size-6 items-center justify-center rounded-full bg-[#222824] font-semibold text-white' : inMonth ? 'text-[#515a51]' : 'text-[#a0a69e]'}`}>{day.getDate()}</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    {events.slice(0, 2).map((event) => <span key={event.id} title={event.title} className={`truncate rounded px-1 py-0.5 text-[10px] leading-4 sm:text-[11px] ${event.status === 'published' ? 'bg-[#e2eee5] text-[#4c7557]' : 'bg-[#e6edf4] text-[#48627b]'}`}>{event.title}</span>)}
                    {events.length > 2 && <span className="px-1 text-[10px] text-[#747b72]">+{events.length - 2} más</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="border-t border-[#dedfd8] pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <h2 className="font-serif text-xl capitalize">{dateLabel(selectedDate)}</h2>
          <p className="mt-1 text-xs text-[#838a81]">{selectedEvents.length} {selectedEvents.length === 1 ? 'publicación' : 'publicaciones'}</p>
          {selectedEvents.length ? <ul className="mt-4 divide-y divide-[#e3e4de]">
            {selectedEvents.map((publication) => {
              const date = publicationDate(publication)
              return <li key={publication.id}>
                <button onClick={() => setEditing(publication)} className="flex w-full gap-3 py-3 text-left hover:bg-[#eef0eb]">
                  <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-[#838a81]">{date ? new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date) : '--:--'}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{publication.title}</span><span className={`mt-1 block text-xs ${publication.status === 'published' ? 'text-[#4c7557]' : 'text-[#48627b]'}`}>{publication.status === 'published' ? 'Publicada' : 'Programada'}{publication.platforms.length ? ` · ${publication.platforms.join(', ')}` : ''}</span></span>
                </button>
              </li>
            })}
          </ul> : <div className="py-10 text-center"><p className="text-sm font-medium">Día sin publicaciones</p><p className="mt-1 text-xs text-[#838a81]">Puedes programar contenido para esta fecha.</p></div>}
          <button onClick={() => setNewDate(localDateTime(selectedDate))} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-[#cdd1c8] px-3 py-2.5 text-sm font-medium text-[#596258] hover:bg-[#e8ebe3]"><FilePlus2 className="size-4" />Crear para este día</button>
        </aside>
      </div>

      {(newDate !== null || editing) && <PublicationDialog key={editing?.id ?? newDate ?? 'new'} publication={editing} initialDate={newDate ?? ''} onClose={closeDialog} timezone={timezone} />}
    </section>
  )
}
