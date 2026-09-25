'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { Archive, ArrowRight, FilePlus2, Lightbulb, Pencil, Search, X } from 'lucide-react'
import { archiveIdea, convertIdeaToDraft, saveIdea, type IdeaActionState, type IdeaStatus } from '@/app/actions/ideas'

export type IdeaRecord = {
  id: string
  title: string
  notes: string
  status: IdeaStatus
  source: string | null
  created_at: string
}

const statusLabels: Record<IdeaStatus, string> = { inbox: 'Bandeja', planned: 'Planeada', used: 'Convertida', archived: 'Archivada' }
const filters: Array<'active' | IdeaStatus> = ['active', 'inbox', 'planned', 'used', 'archived']

function RefreshOnSuccess({ success }: { success?: string }) {
  const router = useRouter()
  useEffect(() => { if (success) router.refresh() }, [router, success])
  return null
}

function IdeaDialog({ idea, onClose }: { idea: IdeaRecord | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [state, formAction, pending] = useActionState<IdeaActionState, FormData>(saveIdea, {})

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  useEffect(() => { if (state.success) onClose() }, [onClose, state.success])

  return <dialog ref={dialogRef} aria-labelledby="idea-dialog-title" className="fixed inset-0 m-auto max-h-[min(90dvh,680px)] w-[min(560px,calc(100vw-2rem))] max-w-none overflow-y-auto border border-[#dedfd8] bg-[#f8f8f4] p-0 text-[#1f2422] shadow-2xl backdrop:bg-[#1f2422]/45" onClose={onClose}>
    <form action={formAction} className="p-5 sm:p-7">
      <div className="mb-6 flex items-start justify-between gap-4"><div><h2 id="idea-dialog-title" className="font-serif text-2xl">{idea ? 'Editar idea' : 'Nueva idea'}</h2><p className="mt-1 text-sm text-[#747b72]">Guarda una idea para convertirla en contenido cuando esté lista.</p></div><button type="button" aria-label="Cerrar" onClick={() => dialogRef.current?.close()} className="rounded-md p-2 text-[#737b72] hover:bg-[#e8ebe3]"><X className="size-4" /></button></div>
      {state.error && <p role="alert" className="mb-4 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{state.error}</p>}
      <input type="hidden" name="id" value={idea?.id ?? ''} />
      <label className="block text-sm font-medium">Idea
        <input name="title" required maxLength={240} defaultValue={idea?.title ?? ''} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
      </label>
      <label className="mt-4 block text-sm font-medium">Notas
        <textarea name="notes" rows={5} defaultValue={idea?.notes ?? ''} className="mt-1.5 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
      </label>
      <label className="mt-4 block text-sm font-medium">Estado
        <select name="status" defaultValue={idea?.status ?? 'inbox'} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f]">{(['inbox', 'planned', 'archived'] as const).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>
      </label>
      <div className="mt-6 flex justify-end gap-3 border-t border-[#e1e2dc] pt-4"><button type="button" onClick={() => dialogRef.current?.close()} className="h-10 rounded-md px-4 text-sm font-medium text-[#60685f] hover:bg-[#e8ebe3]">Cancelar</button><button type="submit" disabled={pending} className="h-10 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-60">{pending ? 'Guardando…' : 'Guardar idea'}</button></div>
    </form>
  </dialog>
}

function IdeaActions({ idea, onEdit }: { idea: IdeaRecord; onEdit: () => void }) {
  const [archiveState, archiveAction, archiving] = useActionState<IdeaActionState, FormData>(archiveIdea, {})
  const [convertState, convertAction, converting] = useActionState<IdeaActionState, FormData>(convertIdeaToDraft, {})
  const active = idea.status === 'inbox' || idea.status === 'planned'
  return <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#e3e4de] pt-3">
    {active && <>
      <form action={convertAction}><input type="hidden" name="id" value={idea.id} /><button type="submit" disabled={converting} className="flex h-9 items-center gap-2 rounded-md bg-[#222824] px-3 text-xs font-medium text-white hover:bg-[#39413b] disabled:opacity-55"><ArrowRight className="size-3.5" />{converting ? 'Creando…' : 'Convertir en borrador'}</button></form>
      <button type="button" onClick={onEdit} title="Editar idea" aria-label="Editar idea" className="rounded-md p-2 text-[#727a70] hover:bg-[#e8ebe3]"><Pencil className="size-4" /></button>
      <form action={archiveAction} className="ml-auto"><input type="hidden" name="id" value={idea.id} /><button type="submit" disabled={archiving} title="Archivar idea" aria-label="Archivar idea" className="rounded-md p-2 text-[#848b82] hover:bg-[#eef0eb]"><Archive className="size-4" /></button></form>
    </>}
    {(archiveState.error || convertState.error) && <p role="alert" className="w-full text-xs text-[#8c3e2f]">{archiveState.error || convertState.error}</p>}
    <RefreshOnSuccess success={archiveState.success || convertState.success} />
  </div>
}

export function DashboardIdeas({ ideas, hasError, initialSearch = '' }: { ideas: IdeaRecord[]; hasError: boolean; initialSearch?: string }) {
  const [filter, setFilter] = useState<'active' | IdeaStatus>('active')
  const [search, setSearch] = useState(initialSearch)
  const [editing, setEditing] = useState<IdeaRecord | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const activeIdeas = ideas.filter((idea) => idea.status === 'inbox' || idea.status === 'planned')
  const counts = useMemo(() => ({ active: activeIdeas.length, inbox: ideas.filter((idea) => idea.status === 'inbox').length, planned: ideas.filter((idea) => idea.status === 'planned').length, used: ideas.filter((idea) => idea.status === 'used').length, archived: ideas.filter((idea) => idea.status === 'archived').length }), [activeIdeas.length, ideas])
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es')
    return ideas.filter((idea) => (filter === 'active' ? idea.status === 'inbox' || idea.status === 'planned' : idea.status === filter) && (!query || `${idea.title} ${idea.notes}`.toLocaleLowerCase('es').includes(query)))
  }, [filter, ideas, search])

  return <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase text-[#74816f]">Espacio de trabajo</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Ideas</h1><p className="mt-2 text-sm text-[#747b72]">Captura inspiración y conviértela en publicaciones.</p></div><button onClick={() => { setEditing(null); setDialogOpen(true) }} className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b]"><FilePlus2 className="size-4" />Nueva idea</button></div>
    {hasError && <p role="status" className="mb-5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No se pudieron cargar todas las ideas.</p>}
    <div className="flex flex-col gap-4 border-b border-[#dedfd8] pb-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar ideas">{filters.map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-md px-3 py-2 text-xs font-medium ${filter === value ? 'bg-[#222824] text-white' : 'text-[#697168] hover:bg-[#e8ebe3]'}`}>{value === 'active' ? 'Activas' : statusLabels[value]} <span className={filter === value ? 'text-white/70' : 'text-[#929990]'}>{counts[value]}</span></button>)}</div><label className="relative block w-full lg:max-w-xs"><span className="sr-only">Buscar ideas</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#90978e]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ideas" className="h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] pl-9 pr-3 text-sm outline-none focus:border-[#71866f]" /></label></div>
    {visible.length ? <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">{visible.map((idea) => <article key={idea.id} className="border-b border-[#e3e4de] py-5"><div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f1e6c9] text-[#87682b]"><Lightbulb className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h2 className="text-sm font-semibold leading-5">{idea.title}</h2><span className="shrink-0 rounded-full bg-[#edf0eb] px-2 py-1 text-[10px] text-[#596258]">{statusLabels[idea.status]}</span></div>{idea.notes && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-5 text-[#747b72]">{idea.notes}</p>}<p className="mt-2 text-[11px] text-[#929990]">{new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(idea.created_at))}{idea.source ? ` · ${idea.source}` : ''}</p><IdeaActions idea={idea} onEdit={() => { setEditing(idea); setDialogOpen(true) }} /></div></div></article>)}</div> : <div className="flex flex-col items-center py-16 text-center"><div className="mb-4 flex size-11 items-center justify-center rounded-full bg-[#e8ebe3] text-[#667361]"><Lightbulb className="size-5" /></div><h2 className="text-sm font-semibold">{ideas.length ? 'No hay resultados' : 'Todavía no hay ideas'}</h2><p className="mt-1 max-w-sm text-sm text-[#838a81]">{ideas.length ? 'Prueba con otra búsqueda o estado.' : 'Guarda una idea para tenerla a mano cuando planifiques contenido.'}</p>{!ideas.length && <button onClick={() => { setEditing(null); setDialogOpen(true) }} className="mt-4 flex items-center gap-2 rounded-md border border-[#cdd1c8] px-3 py-2 text-sm font-medium hover:bg-[#e8ebe3]"><FilePlus2 className="size-4" />Añadir idea</button>}</div>}
    {dialogOpen && <IdeaDialog key={editing?.id ?? 'new'} idea={editing} onClose={() => setDialogOpen(false)} />}
  </section>
}
