'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Lightbulb, Search, X } from 'lucide-react'
import type { MediaAssetRecord } from '@/lib/dashboard/library'
import type { IdeaRecord } from '@/components/dashboard/dashboard-ideas'
import type { PublicationRecord } from '@/lib/dashboard/publications'

type Result = { id: string; title: string; detail: string; section: string; kind: 'publication' | 'idea' | 'media' }
const publicationStatus: Record<PublicationRecord['status'], string> = { draft: 'Borrador', scheduled: 'Programada', published: 'Publicada', archived: 'Archivada' }
const ideaStatus: Record<IdeaRecord['status'], string> = { inbox: 'En bandeja', planned: 'Planeada', used: 'Convertida', archived: 'Archivada' }

export function DashboardSearch({ open, onClose, onNavigate, publications, ideas, assets }: {
  open: boolean
  onClose: () => void
  onNavigate: (section: string, searchQuery: string) => void
  publications: PublicationRecord[]
  ideas: IdeaRecord[]
  assets: MediaAssetRecord[]
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const needle = query.trim().toLocaleLowerCase('es')
  const results: Result[] = needle ? [
    ...publications.filter((item) => `${item.title} ${item.body} ${item.category ?? ''}`.toLocaleLowerCase('es').includes(needle)).slice(0, 4).map((item) => ({ id: item.id, title: item.title, detail: `Publicación · ${publicationStatus[item.status]}`, section: 'Publicaciones', kind: 'publication' as const })),
    ...ideas.filter((item) => `${item.title} ${item.notes}`.toLocaleLowerCase('es').includes(needle)).slice(0, 4).map((item) => ({ id: item.id, title: item.title, detail: `Idea · ${ideaStatus[item.status]}`, section: 'Ideas', kind: 'idea' as const })),
    ...assets.filter((item) => `${item.file_name} ${item.alt_text ?? ''}`.toLocaleLowerCase('es').includes(needle)).slice(0, 4).map((item) => ({ id: item.id, title: item.file_name, detail: `Archivo · ${item.mime_type.split('/')[1]?.toUpperCase() ?? 'Medio'}`, section: 'Biblioteca', kind: 'media' as const })),
  ].slice(0, 10) : []

  const selectResult = (section: string) => {
    const searchQuery = query.trim()
    setQuery('')
    onClose()
    onNavigate(section, searchQuery)
  }

  return <dialog ref={dialogRef} aria-label="Búsqueda global" className="fixed inset-0 m-auto h-fit max-h-[min(80dvh,640px)] w-[min(620px,calc(100vw-2rem))] max-w-none overflow-hidden border border-[#dedfd8] bg-[#f8f8f4] p-0 text-[#1f2422] shadow-2xl backdrop:bg-[#1f2422]/40" onClose={onClose}>
    <div className="flex items-center gap-3 border-b border-[#dedfd8] px-4"><Search className="size-4 shrink-0 text-[#858c84]" /><input ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar publicaciones, ideas y archivos" aria-label="Buscar en el espacio de trabajo" className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#929990]" /><button onClick={() => { setQuery(''); onClose() }} aria-label="Cerrar búsqueda" className="rounded p-1.5 text-[#737b72] hover:bg-[#e8ebe3]"><X className="size-4" /></button></div>
    <div className="max-h-[min(65dvh,520px)] overflow-y-auto p-2">
      {!needle ? <p className="px-3 py-8 text-center text-sm text-[#858c84]">Escribe para buscar en tu contenido.</p> : results.length ? <ul className="flex flex-col gap-1">{results.map((result) => {
        const Icon = result.kind === 'publication' ? FileText : result.kind === 'idea' ? Lightbulb : ImageIcon
        return <li key={`${result.kind}-${result.id}`}><button onClick={() => selectResult(result.section)} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-[#e8ebe3]"><Icon className="size-4 shrink-0 text-[#74816f]" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{result.title}</span><span className="mt-0.5 block text-xs text-[#858c84]">{result.detail}</span></span><span className="text-[11px] text-[#929990]">{result.section}</span></button></li>
      })}</ul> : <p className="px-3 py-8 text-center text-sm text-[#858c84]">No encontramos coincidencias.</p>}
    </div>
  </dialog>
}
