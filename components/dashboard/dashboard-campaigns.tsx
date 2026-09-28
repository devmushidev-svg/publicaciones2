'use client'

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, CalendarPlus, Flag, Pencil, Plus, X } from 'lucide-react'
import { saveCampaign, setCampaignArchived } from '@/app/actions/schedule'
import type { PublicationRecord } from '@/lib/dashboard/publications'
import { type CampaignRecord, type ScheduledPostRecord, type ScheduleActionState } from '@/lib/dashboard/schedule'
import { addDaysToKey, dateKeyInTimezone, daysBetweenKeys } from '@/lib/date-time'

const fieldClass = 'mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20'
const palette = ['#526e58', '#48627b', '#a15d48', '#87682b', '#6d5a8a', '#2f7d7a']

function formatDay(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

function CampaignDialog({ campaign, timezone, onClose }: { campaign: CampaignRecord | null; timezone: string; onClose: () => void }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [state, action, pending] = useActionState<ScheduleActionState, FormData>(saveCampaign, {})
  const today = dateKeyInTimezone(new Date(), timezone)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  useEffect(() => { if (state.success) { onClose(); router.refresh() } }, [onClose, router, state.success])

  return <dialog ref={dialogRef} aria-labelledby="campaign-dialog-title" onClose={onClose} className="fixed inset-0 m-auto max-h-[min(90dvh,720px)] w-[min(560px,calc(100vw-2rem))] max-w-none overflow-y-auto border border-[#dedfd8] bg-[#f8f8f4] p-0 text-[#1f2422] shadow-2xl backdrop:bg-[#1f2422]/45">
    <form action={action} className="p-5 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><h2 id="campaign-dialog-title" className="font-serif text-2xl">{campaign ? 'Editar campaña' : 'Nueva campaña'}</h2><p className="mt-1 text-sm text-[#747b72]">Agrupa programaciones con una vigencia y una meta.</p></div>
        <button type="button" aria-label="Cerrar" onClick={() => dialogRef.current?.close()} className="rounded-md p-2 text-[#737b72] hover:bg-[#e8ebe3]"><X className="size-4" /></button>
      </div>
      {state.error && <p role="alert" className="mb-4 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{state.error}</p>}
      <input type="hidden" name="id" value={campaign?.id ?? ''} />
      <label className="block text-sm font-medium">Nombre<input name="name" required maxLength={120} defaultValue={campaign?.name ?? ''} className={fieldClass} /></label>
      <label className="mt-4 block text-sm font-medium">Objetivo <span className="font-normal text-[#838a81]">(opcional)</span><textarea name="goal" rows={3} maxLength={1000} defaultValue={campaign?.goal ?? ''} className="mt-1.5 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm outline-none focus:border-[#71866f]" /></label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Inicio<input name="starts_on" type="date" required defaultValue={campaign?.starts_on ?? today} className={fieldClass} /></label>
        <label className="text-sm font-medium">Fin<input name="ends_on" type="date" required defaultValue={campaign?.ends_on ?? addDaysToKey(today, 13)} className={fieldClass} /></label>
        <label className="text-sm font-medium">Meta de publicaciones <span className="font-normal text-[#838a81]">(opcional)</span><input name="target_posts" type="number" min={1} max={1000} defaultValue={campaign?.target_posts ?? ''} className={fieldClass} /></label>
        <fieldset className="text-sm font-medium"><legend>Color</legend><div className="mt-3 flex gap-2">{palette.map((color) => <label key={color} className="cursor-pointer"><input type="radio" name="color" value={color} defaultChecked={(campaign?.color ?? palette[0]) === color} className="peer sr-only" /><span className="block size-7 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-[#222824] peer-focus-visible:ring-2 peer-focus-visible:ring-[#71866f]" style={{ backgroundColor: color }} aria-label={color} /></label>)}</div></fieldset>
      </div>
      <p className="mt-3 text-xs text-[#838a81]">Las fechas se interpretan en {timezone}. Si acortas la vigencia, primero mueve o cancela lo programado fuera del nuevo rango.</p>
      <div className="mt-6 flex justify-end gap-3 border-t border-[#e1e2dc] pt-4">
        <button type="button" onClick={() => dialogRef.current?.close()} className="h-10 rounded-md px-4 text-sm font-medium text-[#60685f] hover:bg-[#e8ebe3]">Cancelar</button>
        <button type="submit" disabled={pending} className="h-10 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-60">{pending ? 'Guardando…' : 'Guardar campaña'}</button>
      </div>
    </form>
  </dialog>
}

function ArchiveCampaignButton({ campaign }: { campaign: CampaignRecord }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<ScheduleActionState, FormData>(setCampaignArchived, {})
  useEffect(() => { if (state.success) router.refresh() }, [router, state.success])
  return <form action={action}>
    <input type="hidden" name="id" value={campaign.id} />
    <input type="hidden" name="archived" value={String(!campaign.is_archived)} />
    <button type="submit" disabled={pending} title={campaign.is_archived ? 'Restaurar campaña' : 'Archivar campaña'} aria-label={campaign.is_archived ? 'Restaurar campaña' : 'Archivar campaña'} className="rounded-md p-2 text-[#848b82] hover:bg-[#eef0eb] disabled:opacity-50">{campaign.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}</button>
    {state.error && <span role="alert" className="text-xs text-[#8c3e2f]">{state.error}</span>}
  </form>
}

export function DashboardCampaigns({ campaigns, scheduledPosts, publications, timezone, onSchedule }: { campaigns: CampaignRecord[]; scheduledPosts: ScheduledPostRecord[]; publications: PublicationRecord[]; timezone: string; onSchedule: (campaign: CampaignRecord) => void }) {
  const [editing, setEditing] = useState<CampaignRecord | null>(null)
  const [open, setOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const today = dateKeyInTimezone(new Date(), timezone)
  const publicationTitle = useMemo(() => new Map(publications.map((item) => [item.id, item.title])), [publications])
  const visible = campaigns.filter((campaign) => showArchived || !campaign.is_archived)
    .sort((a, b) => Number(a.ends_on < today) - Number(b.ends_on < today) || a.starts_on.localeCompare(b.starts_on))

  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-xs text-[#687168]"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="size-4 accent-[#526e58]" />Mostrar archivadas</label>
      <button onClick={() => { setEditing(null); setOpen(true) }} className="flex h-10 items-center gap-2 rounded-md border border-[#cdd1c8] px-4 text-sm font-medium text-[#465347] hover:bg-[#e8ebe3]"><Plus className="size-4" />Nueva campaña</button>
    </div>
    {visible.length ? <div className="divide-y divide-[#e3e4de] border-y border-[#e3e4de]">
      {visible.map((campaign) => {
        const slots = scheduledPosts.filter((slot) => slot.campaign_id === campaign.id)
        const fulfilled = slots.filter((slot) => slot.status === 'fulfilled').length
        const planned = slots.filter((slot) => slot.status === 'planned').length
        const cancelled = slots.filter((slot) => slot.status === 'cancelled').length
        const state = campaign.is_archived ? 'Archivada' : today < campaign.starts_on ? `Empieza en ${daysBetweenKeys(today, campaign.starts_on)} días` : today > campaign.ends_on ? 'Finalizada' : `Vigente · quedan ${daysBetweenKeys(today, campaign.ends_on) + 1} días`
        const progress = campaign.target_posts ? Math.min(1, fulfilled / campaign.target_posts) : null
        const upcoming = slots.filter((slot) => slot.status === 'planned').sort((a, b) => a.planned_for.localeCompare(b.planned_for)).slice(0, 3)
        return <article key={campaign.id} className="py-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="flex min-w-0 gap-3">
              <span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: campaign.color }} />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{campaign.name}</h3>
                <p className="mt-1 text-xs text-[#777f76]">{formatDay(campaign.starts_on)} – {formatDay(campaign.ends_on)} · {state}</p>
                {campaign.goal && <p className="mt-2 whitespace-pre-wrap text-sm text-[#596258]">{campaign.goal}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!campaign.is_archived && campaign.ends_on >= today && <button type="button" onClick={() => onSchedule(campaign)} className="flex h-9 items-center gap-2 rounded-md border border-[#cdd1c8] px-3 text-xs font-medium text-[#465347] hover:bg-[#e8ebe3]"><CalendarPlus className="size-3.5" />Programar</button>}
              <button type="button" onClick={() => { setEditing(campaign); setOpen(true) }} title="Editar campaña" aria-label="Editar campaña" className="rounded-md p-2 text-[#727a70] hover:bg-[#e8ebe3]"><Pencil className="size-4" /></button>
              <ArchiveCampaignButton campaign={campaign} />
            </div>
          </div>
          <div className="mt-3 pl-6">
            <p className="text-xs text-[#687168]">{fulfilled} publicadas con registro · {planned} programadas · {cancelled} canceladas{campaign.target_posts ? ` · meta ${campaign.target_posts}` : ''}</p>
            {progress !== null && <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-[#e5e9e2]" role="progressbar" aria-valuemin={0} aria-valuemax={campaign.target_posts ?? 0} aria-valuenow={fulfilled} aria-label={`Progreso de ${campaign.name}`}><div className="h-full rounded-full" style={{ width: `${progress * 100}%`, backgroundColor: campaign.color }} /></div>}
            {!!upcoming.length && <ul className="mt-2 space-y-1 text-xs text-[#747b72]">{upcoming.map((slot) => <li key={slot.id}>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(slot.planned_for))} · {publicationTitle.get(slot.publication_id) ?? 'Publicación'}</li>)}</ul>}
          </div>
        </article>
      })}
    </div> : <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-[#e8ebe3] text-[#667361]"><Flag className="size-5" /></div>
      <h2 className="text-sm font-semibold">Todavía no hay campañas</h2>
      <p className="mt-1 max-w-sm text-sm text-[#838a81]">Crea una campaña con fechas de inicio y fin para agrupar lo que programes.</p>
    </div>}
    {open && <CampaignDialog key={editing?.id ?? 'new'} campaign={editing} timezone={timezone} onClose={close} />}
  </div>
}
