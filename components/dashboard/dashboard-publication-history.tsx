'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Check, FileImage, History, Search, X } from 'lucide-react'
import { loadMorePublicationHistory, markPublicationUsed } from '@/app/actions/publication-history'
import { dateKeyInTimezone, dateTimeInputValue } from '@/lib/date-time'
import {
  publicationPlatforms,
  type PublicationActionState,
  type PublicationHistoryRecord,
  type PublicationRecord,
  publicationHistoryPageSize,
} from '@/lib/dashboard/publications'

type MarkPublishedDialogProps = {
  publication: PublicationRecord
  timezone: string
  idempotencyKey: string
  onClose: () => void
}

function MarkPublishedDialog({ publication, timezone, idempotencyKey, onClose }: MarkPublishedDialogProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [state, formAction, pending] = useActionState<PublicationActionState, FormData>(markPublicationUsed, {})
  const [publishedAt, setPublishedAt] = useState(() => dateTimeInputValue(new Date().toISOString(), timezone))

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  useEffect(() => {
    if (state.success) {
      onClose()
      router.refresh()
    }
  }, [onClose, router, state.success])

  return <dialog
    ref={dialogRef}
    aria-labelledby={`publication-use-title-${publication.id}`}
    className="fixed inset-0 m-auto max-h-[min(90dvh,760px)] w-[min(600px,calc(100vw-2rem))] max-w-none overflow-y-auto border border-[#dedfd8] bg-[#f8f8f4] p-0 text-[#1f2422] shadow-2xl backdrop:bg-[#1f2422]/45"
    onClose={onClose}
  >
    <form action={formAction} className="p-5 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-[#74816f]">Historial de publicaciones</p>
          <h2 id={`publication-use-title-${publication.id}`} className="mt-1 font-serif text-2xl">Registrar uso</h2>
          <p className="mt-1 text-sm text-[#747b72]">{publication.title}</p>
          <p className="mt-1 text-xs text-[#838a81]">Registra una publicación que ya realizaste; no la envía a ninguna red.</p>
        </div>
        <button type="button" aria-label="Cerrar" onClick={() => dialogRef.current?.close()} className="rounded-md p-2 text-[#737b72] hover:bg-[#e8ebe3]"><X className="size-4" /></button>
      </div>

      {state.error && <p role="alert" className="mb-4 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{state.error}</p>}
      <input type="hidden" name="publication_id" value={publication.id} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="timezone" value={timezone} />

      <label className="block text-sm font-medium">Fecha y hora en {timezone}
        <input name="published_at" type="datetime-local" required value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
      </label>

      <fieldset className="mt-5 border-t border-[#dedfd8] pt-4">
        <legend className="text-sm font-medium">Plataformas donde se publicó</legend>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {publicationPlatforms.map(({ value, label }) => <label key={value} className="flex items-center gap-2 text-sm text-[#555d55]">
            <input type="checkbox" name="platforms" value={value} defaultChecked={publication.platforms.includes(value)} className="size-4 accent-[#526e58]" />{label}
          </label>)}
        </div>
      </fieldset>

      <label className="mt-5 block text-sm font-medium">Texto que se publicó
        <textarea name="copy" rows={5} maxLength={20000} defaultValue={publication.body} className="mt-1.5 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
      </label>
      <label className="mt-4 block text-sm font-medium">Notas <span className="font-normal text-[#838a81]">(opcional)</span>
        <textarea name="notes" rows={2} maxLength={2000} className="mt-1.5 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
      </label>

      <div className="mt-6 flex justify-end gap-3 border-t border-[#e1e2dc] pt-4">
        <button type="button" onClick={() => dialogRef.current?.close()} className="h-10 rounded-md px-4 text-sm font-medium text-[#60685f] hover:bg-[#e8ebe3]">Cancelar</button>
        <button type="submit" disabled={pending || !publishedAt} className="flex h-10 items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-60"><Check className="size-4" />{pending ? 'Guardando…' : 'Guardar en historial'}</button>
      </div>
    </form>
  </dialog>
}

export function MarkPublishedButton({ publication, timezone }: { publication: PublicationRecord; timezone: string }) {
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const close = () => setIdempotencyKey('')
  return <>
    <button type="button" onClick={() => setIdempotencyKey(crypto.randomUUID())} className="flex h-9 items-center gap-2 rounded-md border border-[#cdd1c8] px-3 text-xs font-medium text-[#465347] hover:bg-[#e8ebe3]">
      <Check className="size-3.5" />{publication.status === 'published' ? 'Registrar reutilización' : 'Marcar publicada'}
    </button>
    {idempotencyKey && <MarkPublishedDialog key={idempotencyKey} publication={publication} timezone={timezone} idempotencyKey={idempotencyKey} onClose={close} />}
  </>
}

type HistoryGroup = Omit<PublicationHistoryRecord, 'id' | 'platform'> & { platforms: string[] }

function groupHistory(history: PublicationHistoryRecord[]) {
  const groups = new Map<string, HistoryGroup>()
  for (const row of history) {
    const current = groups.get(row.idempotency_key)
    if (current) {
      if (!current.platforms.some((value) => value === row.platform)) current.platforms.push(row.platform as HistoryGroup['platforms'][number])
      continue
    }
    groups.set(row.idempotency_key, { ...row, platforms: [row.platform] })
  }
  return [...groups.values()]
}

const platformLabels: Map<string, string> = new Map(publicationPlatforms.map(({ value, label }) => [value, label]))

export function DashboardPublicationHistory({ history, hasError, timezone }: { history: PublicationHistoryRecord[]; hasError: boolean; timezone: string }) {
  const [rows, setRows] = useState(history)
  const [hasMore, setHasMore] = useState(history.length === publicationHistoryPageSize)
  const [loadError, setLoadError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('')
  const [fromDate, setFromDate] = useState('')
  const groups = useMemo(() => groupHistory(rows), [rows])
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es')
    return groups.filter((entry) => {
      if (platform && !entry.platforms.some((value) => value === platform)) return false
      if (fromDate && dateKeyInTimezone(new Date(entry.published_at), timezone) < fromDate) return false
      if (!needle) return true
      const fileNames = entry.media_snapshot.map((item) => item.file_name).join(' ')
      const tags = entry.tags_snapshot.join(' ')
      return `${entry.title_snapshot} ${entry.copy_snapshot} ${entry.category_snapshot ?? ''} ${entry.notes} ${fileNames} ${tags}`.toLocaleLowerCase('es').includes(needle)
    })
  }, [fromDate, groups, platform, search, timezone])

  const loadMore = () => startTransition(async () => {
    const result = await loadMorePublicationHistory(rows.length)
    if (result.error) {
      setLoadError(result.error)
      return
    }
    setRows((current) => [...current, ...result.rows])
    setHasMore(result.rows.length === publicationHistoryPageSize)
    setLoadError('')
  })

  return <section aria-labelledby="publication-history-heading">
    <h2 id="publication-history-heading" className="sr-only">Historial</h2>
    <div className="mb-5 flex flex-col gap-3 border-b border-[#dedfd8] pb-4 lg:flex-row lg:items-center">
      <label className="relative min-w-[180px] flex-1"><span className="sr-only">Buscar en el historial</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#90978e]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar texto, categoría o archivo" className="h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] pl-9 pr-3 text-sm outline-none focus:border-[#71866f]" /></label>
      <label className="sr-only" htmlFor="history-platform">Filtrar plataforma</label>
      <select id="history-platform" value={platform} onChange={(event) => setPlatform(event.target.value)} className="h-10 min-w-[145px] rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm"><option value="">Todas las plataformas</option>{publicationPlatforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <label className="text-xs text-[#747b72]">Desde <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="ml-2 h-10 rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-2 text-sm text-[#1f2422]" /></label>
    </div>
    {(hasError || loadError) && <p role="alert" className="mb-4 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">{loadError || 'No se pudo cargar el historial.'}</p>}
    <p className="mb-2 text-xs text-[#838a81]">{visible.length} {visible.length === 1 ? 'ocasión' : 'ocasiones'} cargadas</p>
    {visible.length ? <div>
      {visible.map((entry) => <article key={entry.idempotency_key} className="border-b border-[#e3e4de] py-5">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold">{entry.title_snapshot}</h3>
            <p className="mt-1 text-xs text-[#777f76]">{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(entry.published_at))}{entry.category_snapshot ? ` · ${entry.category_snapshot}` : ''}</p>
          </div>
          <p className="shrink-0 text-xs font-medium text-[#526e58]">{entry.platforms.map((value) => platformLabels.get(value) ?? value).join(' · ')}</p>
        </div>
        <div className="mt-3 flex gap-3">
          {entry.media_snapshot[0]?.signed_url && entry.media_snapshot[0].mime_type.startsWith('image/') && <span className="relative block size-16 shrink-0 overflow-hidden rounded-md bg-[#eceee8]"><Image src={entry.media_snapshot[0].signed_url} alt={entry.media_snapshot[0].alt_text || entry.title_snapshot} fill unoptimized className="object-cover" /></span>}
          <div className="min-w-0 flex-1">
            {entry.copy_snapshot && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#414841]">{entry.copy_snapshot}</p>}
            {!!entry.tags_snapshot.length && <p className="mt-2 text-xs text-[#687267]">{entry.tags_snapshot.join(' · ')}</p>}
            {!!entry.media_snapshot.length && <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#687267]"><FileImage className="size-3.5 shrink-0" />{entry.media_snapshot.map((item) => item.file_name).join(' · ')}</p>}
            {entry.notes && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-[#777f76]">{entry.notes}</p>}
          </div>
        </div>
      </article>)}
    </div> : <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-[#e8ebe3] text-[#667361]"><History className="size-5" /></div>
      <p className="text-sm font-semibold">{rows.length ? 'No hay coincidencias' : 'Todavía no hay publicaciones en el historial'}</p>
      <p className="mt-1 max-w-sm text-xs text-[#838a81]">{rows.length ? 'Prueba otra búsqueda o cambia los filtros.' : 'Marca una publicación como publicada para guardar el texto, la fecha y las plataformas.'}</p>
    </div>}
    {hasMore && <div className="flex justify-center py-5"><button type="button" disabled={isPending} onClick={loadMore} className="h-10 rounded-md border border-[#cdd1c8] px-4 text-sm font-medium text-[#465347] hover:bg-[#e8ebe3] disabled:opacity-60">{isPending ? 'Cargando…' : 'Cargar historial anterior'}</button></div>}
  </section>
}
