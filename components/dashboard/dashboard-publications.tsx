'use client'

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CalendarClock, FilePlus2, Search, X } from 'lucide-react'
import { archivePublication, savePublication } from '@/app/actions/publications'
import {
  publicationPlatforms,
  type PublicationActionState,
  type PublicationRecord,
  type PublicationStatus,
} from '@/lib/dashboard/publications'
import { dateTimeInputValue } from '@/lib/date-time'

const statusLabels: Record<PublicationStatus, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  published: 'Publicada',
  archived: 'Archivada',
}

const statusStyles: Record<PublicationStatus, string> = {
  draft: 'bg-[#edf0eb] text-[#596258]',
  scheduled: 'bg-[#e6edf4] text-[#48627b]',
  published: 'bg-[#e2eee5] text-[#4c7557]',
  archived: 'bg-[#f0ece4] text-[#75684f]',
}

const filters: Array<'all' | PublicationStatus> = ['all', 'draft', 'scheduled', 'published', 'archived']

function scheduledLabel(value: string | null, timezone: string) {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value))
}

type DialogProps = {
  publication: PublicationRecord | null
  onClose: () => void
  timezone?: string
}

export function PublicationDialog({ publication, onClose, initialDate = '', timezone = 'America/Tegucigalpa' }: DialogProps & { initialDate?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [state, formAction, pending] = useActionState<PublicationActionState, FormData>(savePublication, {})

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  useEffect(() => {
    if (state.success) onClose()
  }, [state.success, onClose])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="publication-dialog-title"
      className="fixed inset-0 m-auto max-h-[min(90dvh,760px)] w-[min(640px,calc(100vw-2rem))] max-w-none overflow-y-auto border border-[#dedfd8] bg-[#f8f8f4] p-0 text-[#1f2422] shadow-2xl backdrop:bg-[#1f2422]/45"
      onClose={onClose}
    >
      <form action={formAction} className="p-5 sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="publication-dialog-title" className="font-serif text-2xl">{publication ? 'Editar publicación' : 'Nueva publicación'}</h2>
            <p className="mt-1 text-sm text-[#747b72]">Guarda un borrador o programa la fecha de salida.</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={() => dialogRef.current?.close()} className="rounded-md p-2 text-[#737b72] hover:bg-[#e8ebe3]"><X className="size-4" /></button>
        </div>

        {state.error && <p role="alert" className="mb-4 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{state.error}</p>}
        <input type="hidden" name="id" value={publication?.id ?? ''} />
        <input type="hidden" name="published_at" value={publication?.published_at ?? ''} />
        <input type="hidden" name="timezone" value={timezone} />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">Título
            <input name="title" required maxLength={200} defaultValue={publication?.title ?? ''} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
          </label>
          <label className="text-sm font-medium">Estado
            <select name="status" defaultValue={publication?.status ?? 'draft'} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20">
              {(['draft', 'scheduled', 'published', 'archived'] as const).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Categoría
            <input name="category" maxLength={80} defaultValue={publication?.category ?? ''} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
          </label>
          <label className="text-sm font-medium sm:col-span-2">Programar para
            <input name="scheduled_for" type="datetime-local" defaultValue={publication ? dateTimeInputValue(publication.scheduled_for, timezone) : initialDate} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Plataformas</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {publicationPlatforms.map(({ value, label }) => <label key={value} className="flex items-center gap-2 text-sm text-[#555d55]"><input type="checkbox" name="platforms" value={value} defaultChecked={publication?.platforms.includes(value) ?? false} className="size-4 accent-[#526e58]" />{label}</label>)}
            </div>
          </fieldset>
          <label className="text-sm font-medium sm:col-span-2">Texto
            <textarea name="body" rows={5} defaultValue={publication?.body ?? ''} className="mt-1.5 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-[#e1e2dc] pt-4">
          <button type="button" onClick={() => dialogRef.current?.close()} className="h-10 rounded-md px-4 text-sm font-medium text-[#60685f] hover:bg-[#e8ebe3]">Cancelar</button>
          <button type="submit" disabled={pending} className="h-10 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-60">{pending ? 'Guardando…' : 'Guardar publicación'}</button>
        </div>
      </form>
    </dialog>
  )
}

function ArchiveButton({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState<PublicationActionState, FormData>(archivePublication, {})
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} title="Archivar publicación" aria-label="Archivar publicación" className="rounded-md p-2 text-[#848b82] hover:bg-[#eef0eb] disabled:opacity-50"><Archive className="size-4" /></button>
      {state.error && <span role="alert" className="text-xs text-[#8c3e2f]">{state.error}</span>}
    </form>
  )
}

type DashboardPublicationsProps = {
  publications: PublicationRecord[]
  hasError: boolean
  timezone: string
  initialSearch?: string
}

export function DashboardPublications({ publications, hasError, timezone, initialSearch = '' }: DashboardPublicationsProps) {
  const [filter, setFilter] = useState<'all' | PublicationStatus>('all')
  const [search, setSearch] = useState(initialSearch)
  const [editing, setEditing] = useState<PublicationRecord | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const closeDialog = useCallback(() => setDialogOpen(false), [])

  const counts = useMemo(() => ({
    all: publications.length,
    draft: publications.filter(({ status }) => status === 'draft').length,
    scheduled: publications.filter(({ status }) => status === 'scheduled').length,
    published: publications.filter(({ status }) => status === 'published').length,
    archived: publications.filter(({ status }) => status === 'archived').length,
  }), [publications])

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es')
    return publications.filter((publication) => {
      const matchesStatus = filter === 'all' || publication.status === filter
      const matchesSearch = !query || `${publication.title} ${publication.category ?? ''} ${publication.body}`.toLocaleLowerCase('es').includes(query)
      return matchesStatus && matchesSearch
    })
  }, [filter, publications, search])

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (publication: PublicationRecord) => {
    setEditing(publication)
    setDialogOpen(true)
  }

  return (
    <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase text-[#74816f]">Espacio de trabajo</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Publicaciones</h1><p className="mt-2 text-sm text-[#747b72]">Organiza borradores, programación y contenido publicado.</p></div>
        <button onClick={openNew} className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b]"><FilePlus2 className="size-4" />Nueva publicación</button>
      </div>

      {hasError && <p role="status" className="mb-5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No se pudieron cargar todas las publicaciones.</p>}

      <div className="flex flex-col gap-4 border-b border-[#dedfd8] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por estado">
          {filters.map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-md px-3 py-2 text-xs font-medium ${filter === value ? 'bg-[#222824] text-white' : 'text-[#697168] hover:bg-[#e8ebe3]'}`}>{value === 'all' ? 'Todas' : statusLabels[value]} <span className={filter === value ? 'text-white/70' : 'text-[#929990]'}>{counts[value]}</span></button>)}
        </div>
        <label className="relative block w-full lg:max-w-xs"><span className="sr-only">Buscar publicaciones</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#90978e]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar publicaciones" className="h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] pl-9 pr-3 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" /></label>
      </div>

      <div className="mt-2">
        {visible.length ? visible.map((publication) => (
          <article key={publication.id} className="flex flex-col gap-3 border-b border-[#e3e4de] py-4 sm:flex-row sm:items-center">
            <button onClick={() => openEdit(publication)} className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{publication.title}</h2><span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusStyles[publication.status]}`}>{statusLabels[publication.status]}</span></div>
              <p className="mt-1 truncate text-xs text-[#838a81]">{publication.category || 'Sin categoría'}{publication.platforms.length ? ` · ${publication.platforms.join(' · ')}` : ''}</p>
            </button>
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <p className="flex items-center gap-1.5 text-xs text-[#838a81]"><CalendarClock className="size-3.5" />{publication.status === 'published' ? scheduledLabel(publication.published_at, timezone) : scheduledLabel(publication.scheduled_for, timezone)}</p>
              {publication.status !== 'archived' && <ArchiveButton id={publication.id} />}
            </div>
          </article>
        )) : (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-[#e8ebe3] text-[#667361]"><Search className="size-5" /></div>
            <h2 className="text-sm font-semibold">{publications.length ? 'No hay resultados' : 'Aún no tienes publicaciones'}</h2>
            <p className="mt-1 max-w-sm text-sm text-[#838a81]">{publications.length ? 'Prueba con otra búsqueda o estado.' : 'Crea un borrador para empezar a organizar tu contenido.'}</p>
            {!publications.length && <button onClick={openNew} className="mt-4 flex items-center gap-2 rounded-md border border-[#cdd1c8] px-3 py-2 text-sm font-medium hover:bg-[#e8ebe3]"><FilePlus2 className="size-4" />Crear publicación</button>}
          </div>
        )}
      </div>

      {dialogOpen && <PublicationDialog key={editing?.id ?? 'new'} publication={editing} onClose={closeDialog} timezone={timezone} />}
    </section>
  )
}
