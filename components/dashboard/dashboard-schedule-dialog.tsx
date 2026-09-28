'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarPlus, X } from 'lucide-react'
import { reschedulePost, schedulePublication } from '@/app/actions/schedule'
import { publicationPlatforms, type PublicationRecord } from '@/lib/dashboard/publications'
import { campaignIsActiveOn, type CampaignRecord, type HistoryLiteRecord, type ScheduledPostRecord, type ScheduleActionState } from '@/lib/dashboard/schedule'
import { dateKeyInTimezone, dateTimeInputToIso, dateTimeInputValue, daysBetweenKeys } from '@/lib/date-time'

const fieldClass = 'mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20'

type ScheduleDialogProps = {
  publications: PublicationRecord[]
  campaigns: CampaignRecord[]
  slots: ScheduledPostRecord[]
  history: HistoryLiteRecord[]
  timezone: string
  minimumRepeatDays: number
  onClose: () => void
  /** When present the dialog moves this slot instead of creating one. */
  slot?: ScheduledPostRecord | null
  initialPublicationId?: string
  initialDate?: string
  initialCampaignId?: string
}

export function defaultPlannedInput(dayKey: string, timezone: string) {
  const now = new Date()
  if (dayKey !== dateKeyInTimezone(now, timezone)) return `${dayKey}T09:00`
  // For today, suggest the next full hour so the value is still in the future.
  const next = new Date(now.getTime() + 60 * 60_000)
  const value = dateTimeInputValue(next.toISOString(), timezone)
  return `${value.slice(0, 13)}:00`
}

export function ScheduleDialog({ publications, campaigns, slots, history, timezone, minimumRepeatDays, onClose, slot = null, initialPublicationId = '', initialDate, initialCampaignId = '' }: ScheduleDialogProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [state, formAction, pending] = useActionState<ScheduleActionState, FormData>(slot ? reschedulePost : schedulePublication, {})
  // A stable id per open dialog makes retries after a network error idempotent.
  const [requestId] = useState(() => crypto.randomUUID())
  const [publicationId, setPublicationId] = useState(slot?.publication_id ?? initialPublicationId)
  const [plannedFor, setPlannedFor] = useState(() => slot ? dateTimeInputValue(slot.planned_for, timezone) : initialDate ?? defaultPlannedInput(dateKeyInTimezone(new Date(), timezone), timezone))
  const [campaignId, setCampaignId] = useState(slot?.campaign_id ?? initialCampaignId)
  const selectable = useMemo(() => publications.filter((item) => item.status !== 'archived').sort((a, b) => a.title.localeCompare(b.title, 'es')), [publications])
  const publication = publications.find((item) => item.id === publicationId)

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

  const plannedIso = dateTimeInputToIso(plannedFor, timezone)
  const plannedKey = plannedIso ? dateKeyInTimezone(new Date(plannedIso), timezone) : ''
  const availableCampaigns = campaigns.filter((campaign) => !campaign.is_archived || campaign.id === campaignId)
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId)

  // Warnings are advisory; the database enforces the hard rules (future date, campaign window, one slot per day).
  const warnings: string[] = []
  if (publicationId && plannedKey) {
    const lastUse = history.filter((row) => row.publication_id === publicationId).map((row) => dateKeyInTimezone(new Date(row.published_at), timezone)).sort().at(-1)
    if (lastUse) {
      const gap = daysBetweenKeys(lastUse, plannedKey)
      if (gap >= 0 && gap < minimumRepeatDays) warnings.push(`Se publicó hace ${gap} ${gap === 1 ? 'día' : 'días'} respecto a esta fecha; tu descanso mínimo es de ${minimumRepeatDays}.`)
    }
    const nearby = slots.filter((item) => item.status === 'planned' && item.id !== slot?.id && item.publication_id === publicationId)
      .map((item) => dateKeyInTimezone(new Date(item.planned_for), timezone))
      .filter((key) => Math.abs(daysBetweenKeys(key, plannedKey)) < Math.max(minimumRepeatDays, 1))
    if (nearby.length) warnings.push(`Ya está programada cerca de esta fecha (${nearby.slice(0, 3).join(', ')}).`)
    if (selectedCampaign && !campaignIsActiveOn({ ...selectedCampaign, is_archived: false }, plannedKey)) warnings.push(`La campaña ${selectedCampaign.name} va del ${selectedCampaign.starts_on} al ${selectedCampaign.ends_on}.`)
  }

  return <dialog ref={dialogRef} aria-labelledby="schedule-dialog-title" onClose={onClose} className="fixed inset-0 m-auto max-h-[min(90dvh,720px)] w-[min(560px,calc(100vw-2rem))] max-w-none overflow-y-auto border border-[#dedfd8] bg-[#f8f8f4] p-0 text-[#1f2422] shadow-2xl backdrop:bg-[#1f2422]/45">
    <form action={formAction} className="p-5 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-[#74816f]">Calendario interno</p>
          <h2 id="schedule-dialog-title" className="mt-1 font-serif text-2xl">{slot ? 'Mover programación' : 'Programar publicación'}</h2>
          <p className="mt-1 text-xs text-[#838a81]">Es una intención de publicar; no envía nada a las redes. Cuando salga, registra su uso.</p>
        </div>
        <button type="button" aria-label="Cerrar" onClick={() => dialogRef.current?.close()} className="rounded-md p-2 text-[#737b72] hover:bg-[#e8ebe3]"><X className="size-4" /></button>
      </div>

      {state.error && <p role="alert" className="mb-4 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{state.error}</p>}
      <input type="hidden" name="timezone" value={timezone} />
      {slot ? <input type="hidden" name="id" value={slot.id} /> : <input type="hidden" name="request_id" value={requestId} />}

      {slot ? <p className="text-sm font-medium">{publication?.title ?? 'Publicación'}</p> : <label className="block text-sm font-medium">Publicación
        <select name="publication_id" required value={publicationId} onChange={(event) => setPublicationId(event.target.value)} className={fieldClass}>
          <option value="">Selecciona una publicación</option>
          {selectable.map((item) => <option key={item.id} value={item.id}>{item.title}{item.status === 'published' ? ' · ya usada' : ''}</option>)}
        </select>
      </label>}
      {!slot && !selectable.length && <p className="mt-2 text-xs text-[#838a81]">Primero crea una publicación en Publicaciones.</p>}

      <label className="mt-4 block text-sm font-medium">Fecha y hora en {timezone}
        <input name="planned_for" type="datetime-local" required value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} className={fieldClass} />
      </label>

      <label className="mt-4 block text-sm font-medium">Campaña <span className="font-normal text-[#838a81]">(opcional)</span>
        <select name="campaign_id" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className={fieldClass}>
          <option value="">Sin campaña</option>
          {availableCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.starts_on} – {campaign.ends_on}{campaign.is_archived ? ' (archivada)' : ''}</option>)}
        </select>
      </label>

      {!slot && <>
        <fieldset key={publicationId} className="mt-5 border-t border-[#dedfd8] pt-4">
          <legend className="text-sm font-medium">Plataformas previstas</legend>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {publicationPlatforms.map(({ value, label }) => <label key={value} className="flex items-center gap-2 text-sm text-[#555d55]"><input type="checkbox" name="platforms" value={value} defaultChecked={publication?.platforms.includes(value) ?? false} className="size-4 accent-[#526e58]" />{label}</label>)}
          </div>
        </fieldset>
        <label className="mt-4 block text-sm font-medium">Notas <span className="font-normal text-[#838a81]">(opcional)</span>
          <textarea name="notes" rows={2} maxLength={1000} className="mt-1.5 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm outline-none focus:border-[#71866f]" />
        </label>
      </>}

      {!!warnings.length && <ul className="mt-4 space-y-1.5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-3 py-2.5 text-xs text-[#765c2c]">
        {warnings.map((warning) => <li key={warning} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{warning}</li>)}
      </ul>}

      <div className="mt-6 flex justify-end gap-3 border-t border-[#e1e2dc] pt-4">
        <button type="button" onClick={() => dialogRef.current?.close()} className="h-10 rounded-md px-4 text-sm font-medium text-[#60685f] hover:bg-[#e8ebe3]">Cancelar</button>
        <button type="submit" disabled={pending || !plannedFor || (!slot && !publicationId)} className="flex h-10 items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-60"><CalendarPlus className="size-4" />{pending ? 'Guardando…' : slot ? 'Mover' : 'Programar'}</button>
      </div>
    </form>
  </dialog>
}
