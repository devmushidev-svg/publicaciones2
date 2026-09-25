'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { Archive, FilePlus2, Image as ImageIcon, Search, Video } from 'lucide-react'
import { ArchiveButton, PublicationDialog } from '@/components/dashboard/dashboard-publications'
import type { CategoryOption, TagOption } from '@/components/dashboard/dashboard-taxonomy'
import type { MediaAssetRecord } from '@/lib/dashboard/library'
import type { PublicationRecord, PublicationStatus } from '@/lib/dashboard/publications'

type Props = {
  publications: PublicationRecord[]
  assets: MediaAssetRecord[]
  categories: CategoryOption[]
  tags: TagOption[]
  timezone: string
  initialSearch: string
  hasError: boolean
}

export function LibraryPublications({ publications, assets, categories, tags, timezone, initialSearch, hasError }: Props) {
  const [search, setSearch] = useState(initialSearch)
  const [categoryId, setCategoryId] = useState('')
  const [tagId, setTagId] = useState('')
  const [status, setStatus] = useState<'active' | 'all' | PublicationStatus>('active')
  const [editing, setEditing] = useState<PublicationRecord | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es')
    return publications.filter((publication) => {
      if (status === 'active' && publication.status === 'archived') return false
      if (status !== 'active' && status !== 'all' && publication.status !== status) return false
      if (categoryId && publication.category_id !== categoryId) return false
      if (tagId && !publication.tagIds.includes(tagId)) return false
      if (!needle) return true
      const files = publication.mediaAssetIds.map((id) => assetById.get(id)?.file_name ?? '').join(' ')
      const tagNames = publication.tagIds.map((id) => tagById.get(id) ?? '').join(' ')
      return `${publication.title} ${publication.body} ${publication.category ?? ''} ${tagNames} ${files}`.toLocaleLowerCase('es').includes(needle)
    })
  }, [assetById, categoryId, publications, search, status, tagById, tagId])

  const openNew = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (publication: PublicationRecord) => { setEditing(publication); setDialogOpen(true) }

  return <>
    {hasError && <p role="alert" className="mb-4 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No se pudieron cargar todas las publicaciones.</p>}
    <div className="flex flex-wrap items-center gap-3 border-b border-[#dedfd8] pb-4">
      <label className="relative min-w-[180px] flex-1"><span className="sr-only">Buscar publicaciones</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#90978e]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar publicaciones" className="h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] pl-9 pr-3 text-sm outline-none focus:border-[#71866f]" /></label>
      <label className="sr-only" htmlFor="library-category">Categoría</label>
      <select id="library-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-10 min-w-[130px] rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm"><option value="">Categorías</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label className="sr-only" htmlFor="library-tag">Etiqueta</label>
      <select id="library-tag" value={tagId} onChange={(event) => setTagId(event.target.value)} className="h-10 min-w-[120px] rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm"><option value="">Etiquetas</option>{tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label className="sr-only" htmlFor="library-status">Estado</label>
      <select id="library-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 min-w-[130px] rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm"><option value="active">Activas</option><option value="all">Todas</option><option value="draft">Borradores</option><option value="scheduled">Programadas</option><option value="published">Publicadas</option><option value="archived">Archivadas</option></select>
      <button onClick={openNew} className="flex h-10 items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b]"><FilePlus2 className="size-4" />Nueva publicación</button>
    </div>
    <p className="py-3 text-xs text-[#838a81]">{visible.length} {visible.length === 1 ? 'publicación' : 'publicaciones'}</p>
    {visible.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{visible.map((publication) => {
      const cover = assetById.get(publication.mediaAssetIds[0])
      return <article key={publication.id} className="overflow-hidden rounded-md border border-[#dedfd8] bg-[#fbfbf8]">
        <button onClick={() => openEdit(publication)} className="block w-full text-left">
          <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#eceee8] text-[#71816e]">{cover?.signed_url && cover.mime_type.startsWith('image/') ? <Image src={cover.signed_url} alt={cover.alt_text || publication.title} fill unoptimized className="object-contain" /> : cover?.mime_type.startsWith('video/') ? <Video className="size-8" /> : <ImageIcon className="size-8" />}</span>
          <span className="block p-4 pb-2"><span className="flex items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold">{publication.title}</span><span className="shrink-0 text-[11px] text-[#7b8279]">{publication.status === 'draft' ? 'Borrador' : publication.status === 'scheduled' ? 'Programada' : publication.status === 'published' ? 'Publicada' : 'Archivada'}</span></span><span className="mt-1 block truncate text-xs text-[#838a81]">{publication.category || 'Sin categoría'}{publication.mediaAssetIds.length > 1 ? ` · ${publication.mediaAssetIds.length} archivos` : ''}</span></span>
        </button>
        <div className="flex min-h-10 items-center justify-between gap-2 px-4 pb-3"><p className="min-w-0 truncate text-[11px] text-[#7b8279]">{publication.tagIds.map((id) => tagById.get(id)).filter(Boolean).join(' · ') || 'Sin etiquetas'}</p>{publication.status !== 'archived' && <ArchiveButton id={publication.id} />}</div>
      </article>
    })}</div> : <div className="py-16 text-center"><div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-[#e8ebe3] text-[#667361]">{status === 'archived' ? <Archive className="size-5" /> : <ImageIcon className="size-5" />}</div><p className="text-sm font-semibold">{publications.length ? 'No hay resultados' : 'Aún no tienes publicaciones'}</p><p className="mt-1 text-xs text-[#838a81]">{publications.length ? 'Prueba con otros filtros.' : 'Crea una publicación y selecciona imágenes de tus archivos.'}</p>{!publications.length && <button onClick={openNew} className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#cdd1c8] px-3 py-2 text-sm"><FilePlus2 className="size-4" />Crear publicación</button>}</div>}
    {dialogOpen && <PublicationDialog key={editing?.id ?? 'new'} publication={editing} onClose={() => setDialogOpen(false)} timezone={timezone} categories={categories} tags={tags} assets={assets} />}
  </>
}
