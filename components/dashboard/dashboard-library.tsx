'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef, useState } from 'react'
import { FilePlus2, Image as ImageIcon, Link2, Link2Off, Search, Video } from 'lucide-react'
import { linkMediaToPublication, unlinkMediaFromPublication } from '@/app/actions/library'
import { createClient } from '@/lib/supabase/client'
import type { MediaAssetRecord } from '@/lib/dashboard/library'
import type { PublicationRecord, PublicationActionState } from '@/lib/dashboard/publications'
import type { CategoryOption, TagOption } from '@/components/dashboard/dashboard-taxonomy'
import { LibraryPublications } from '@/components/dashboard/dashboard-library-publications'
import { inspectMediaFile } from '@/lib/media-upload'

const bucket = 'publication-media'

async function recoverOrphanUploads() {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return

  const knownPaths = new Set<string>()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('media_assets').select('storage_path').eq('user_id', user.id).order('created_at').range(offset, offset + 999)
    if (error || !data) return
    for (const item of data) knownPaths.add(item.storage_path)
    if (data.length < 1000) break
  }

  const stalePaths: string[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(bucket).list(user.id, { limit: 100, offset })
    if (error || !data) return
    for (const item of data) {
      if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4)$/i.test(item.name)) continue
      const path = `${user.id}/${item.name}`
      const createdAt = item.created_at ? Date.parse(item.created_at) : NaN
      if (!knownPaths.has(path) && Number.isFinite(createdAt) && Date.now() - createdAt > 60 * 60 * 1000) stalePaths.push(path)
    }
    if (data.length < 100) break
  }

  for (let index = 0; index < stalePaths.length; index += 100) {
    await supabase.storage.from(bucket).remove(stalePaths.slice(index, index + 100))
  }
}

function bytesLabel(bytes: number) {
  return new Intl.NumberFormat('es', { style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))
}

function dimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new window.Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

function UnlinkButton({ assetId, publicationId, title }: { assetId: string; publicationId: string; title: string }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<PublicationActionState, FormData>(unlinkMediaFromPublication, {})

  useEffect(() => {
    if (state.success) router.refresh()
  }, [router, state.success])

  return (
    <form action={formAction} className="inline-flex items-center gap-1">
      <input type="hidden" name="media_asset_id" value={assetId} />
      <input type="hidden" name="publication_id" value={publicationId} />
      <button type="submit" disabled={pending} title={`Desvincular de ${title}`} aria-label={`Desvincular de ${title}`} className="rounded p-1 text-[#727a70] hover:bg-[#e8ebe3] disabled:opacity-50"><Link2Off className="size-3.5" /></button>
      {state.error && <span role="alert" className="text-[11px] text-[#8c3e2f]">{state.error}</span>}
    </form>
  )
}

function PublicationLink({ asset, publications }: { asset: MediaAssetRecord; publications: PublicationRecord[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<PublicationActionState, FormData>(linkMediaToPublication, {})
  const [selected, setSelected] = useState('')
  const linked = new Set(asset.publicationIds)
  const candidates = publications.filter((publication) => publication.status !== 'archived' && !linked.has(publication.id))

  useEffect(() => {
    if (state.success) router.refresh()
  }, [router, state.success])

  return (
    <div className="border-t border-[#e3e4de] pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#626b61]"><Link2 className="size-3.5" />Publicaciones vinculadas</p>
      {asset.publicationIds.length ? (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {asset.publicationIds.map((id) => {
            const publication = publications.find((item) => item.id === id)
            if (!publication) return null
            return <li key={id} className="flex max-w-full items-center gap-0.5 rounded bg-[#eef0eb] py-0.5 pl-2 text-[11px] text-[#586156]"><span className="max-w-40 truncate">{publication.title}</span><UnlinkButton assetId={asset.id} publicationId={id} title={publication.title} /></li>
          })}
        </ul>
      ) : <p className="mb-3 text-xs text-[#929990]">Sin vínculos</p>}

      {candidates.length > 0 && <form action={formAction} onSubmit={() => setSelected('')} className="flex items-center gap-2">
        <input type="hidden" name="media_asset_id" value={asset.id} />
        <select name="publication_id" value={selected} onChange={(event) => setSelected(event.target.value)} required aria-label={`Vincular ${asset.file_name} a una publicación`} className="h-9 min-w-0 flex-1 rounded border border-[#d7dad2] bg-[#fbfbf8] px-2 text-xs outline-none focus:border-[#71866f]">
          <option value="">Seleccionar publicación</option>
          {candidates.map((publication) => <option key={publication.id} value={publication.id}>{publication.title}</option>)}
        </select>
        <button type="submit" disabled={pending || !selected} className="h-9 rounded bg-[#222824] px-3 text-xs font-medium text-white hover:bg-[#39413b] disabled:opacity-50">{pending ? '...' : 'Vincular'}</button>
        {state.error && <span role="alert" className="text-[11px] text-[#8c3e2f]">{state.error}</span>}
      </form>}
    </div>
  )
}

type DashboardLibraryProps = {
  assets: MediaAssetRecord[]
  publications: PublicationRecord[]
  categories: CategoryOption[]
  tags: TagOption[]
  timezone: string
  publicationsError: boolean
  mediaError: boolean
  storageError: boolean
  initialSearch?: string
}

export function DashboardLibrary({ assets: initialAssets, publications, categories, tags, timezone, publicationsError, mediaError, storageError, initialSearch = '' }: DashboardLibraryProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'publications' | 'files'>(() => initialSearch && !publications.some((item) => item.title.toLocaleLowerCase('es').includes(initialSearch.toLocaleLowerCase('es'))) && initialAssets.some((item) => item.file_name.toLocaleLowerCase('es').includes(initialSearch.toLocaleLowerCase('es'))) ? 'files' : 'publications')
  const [query, setQuery] = useState(initialSearch)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { void recoverOrphanUploads().catch(() => undefined) }, [])

  const filteredAssets = initialAssets.filter((asset) => `${asset.file_name} ${asset.alt_text ?? ''}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return
    setError('')
    setNotice('')
    setUploading(true)
    let uploaded = 0
    let duplicates = 0
    const failures: string[] = []

    try {
      const supabase = createClient()
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Inicia sesión nuevamente para subir archivos.')

      for (const file of files) {
        try {
          const { mimeType, extension, hash } = await inspectMediaFile(file)
          const size = await dimensions(file)
          if (mimeType.startsWith('image/') && (!size?.width || !size?.height)) throw new Error(`${file.name}: la imagen está dañada o no se puede abrir.`)

          const { data: existing, error: lookupError } = await supabase.from('media_assets').select('id').eq('user_id', user.id).eq('content_sha256', hash).maybeSingle()
          if (lookupError) throw new Error(`${file.name}: no se pudo comprobar si ya existe.`)
          if (existing) { duplicates += 1; continue }

          const path = `${user.id}/${crypto.randomUUID()}.${extension}`
          const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
            cacheControl: '3600',
            contentType: mimeType,
            upsert: false,
          })
          if (uploadError) throw new Error(`${file.name}: no se pudo subir el archivo.`)

          const cleanName = Array.from(file.name, (character) => {
            const code = character.charCodeAt(0)
            return character === '/' || character === '\\' || code < 32 || code === 127 ? '_' : character
          }).join('').slice(0, 255) || 'Archivo'
          const { error: metadataError } = await supabase.from('media_assets').insert({
            user_id: user.id,
            storage_path: path,
            file_name: cleanName,
            mime_type: mimeType,
            byte_size: file.size,
            width: size?.width ?? null,
            height: size?.height ?? null,
            content_sha256: hash,
          })

          if (metadataError) {
            const { error: cleanupError } = await supabase.storage.from(bucket).remove([path])
            if (metadataError.code === '23505' && !cleanupError) { duplicates += 1; continue }
            throw new Error(cleanupError ? `${file.name}: no se pudo limpiar una subida incompleta.` : `${file.name}: no se pudo guardar la ficha del archivo.`)
          }
          uploaded += 1
        } catch (cause) {
          failures.push(cause instanceof Error ? cause.message : `${file.name}: no se pudo subir.`)
        }
      }

      if (uploaded || duplicates) setNotice(`${uploaded} ${uploaded === 1 ? 'archivo agregado' : 'archivos agregados'}${duplicates ? ` · ${duplicates} ${duplicates === 1 ? 'duplicado omitido' : 'duplicados omitidos'}` : ''}.`)
      if (failures.length) setError(failures.join(' '))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la carga.')
    } finally {
      if (uploaded) router.refresh()
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase text-[#74816f]">Espacio de trabajo</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Biblioteca</h1><p className="mt-2 text-sm text-[#747b72]">Publicaciones y archivos para reutilizar tu contenido.</p></div>
        <div>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4" multiple className="sr-only" onChange={(event) => uploadFiles(Array.from(event.target.files ?? []))} />
          <button type="button" disabled={uploading} onClick={() => { setMode('files'); inputRef.current?.click() }} className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:cursor-not-allowed disabled:opacity-55"><FilePlus2 className="size-4" />{uploading ? 'Subiendo…' : 'Agregar archivos'}</button>
        </div>
      </div>

      {(mediaError || storageError) && <p role="status" className="mb-4 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">{storageError ? 'El almacenamiento privado no está disponible. Verifica que la migración de Storage esté aplicada.' : 'No se pudieron cargar todos los archivos.'}</p>}
      {error && <p role="alert" className="mb-4 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-4 py-3 text-sm text-[#8c3e2f]">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-md border border-[#c8d8ca] bg-[#f0f6ef] px-4 py-3 text-sm text-[#45694c]">{notice}</p>}

      <div className="mb-5 flex gap-1 border-b border-[#dedfd8]" role="group" aria-label="Vista de biblioteca">
        <button type="button" aria-pressed={mode === 'publications'} onClick={() => setMode('publications')} className={`border-b-2 px-4 py-3 text-sm font-medium ${mode === 'publications' ? 'border-[#526e58] text-[#1f2422]' : 'border-transparent text-[#7b8279]'}`}>Publicaciones</button>
        <button type="button" aria-pressed={mode === 'files'} onClick={() => setMode('files')} className={`border-b-2 px-4 py-3 text-sm font-medium ${mode === 'files' ? 'border-[#526e58] text-[#1f2422]' : 'border-transparent text-[#7b8279]'}`}>Archivos</button>
      </div>

      {mode === 'publications' ? <LibraryPublications publications={publications} assets={initialAssets} categories={categories} tags={tags} timezone={timezone} initialSearch={initialSearch} hasError={publicationsError} /> : <>

      <div className="mb-4 flex flex-col gap-3 border-b border-[#dedfd8] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[#737b72]">{initialAssets.length} {initialAssets.length === 1 ? 'archivo' : 'archivos'}</p>
        <label className="relative block w-full sm:max-w-xs"><span className="sr-only">Buscar en la biblioteca</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#90978e]" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar archivos" className="h-10 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] pl-9 pr-3 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" /></label>
      </div>

      {filteredAssets.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {filteredAssets.map((asset) => <article key={asset.id} className="overflow-hidden rounded-md border border-[#dedfd8] bg-[#fbfbf8]">
          <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#eceee8]">
            {asset.signed_url && asset.mime_type.startsWith('image/')
              ? <Image src={asset.signed_url} alt={asset.alt_text || asset.file_name} fill unoptimized className="object-cover" />
              : asset.signed_url && asset.mime_type === 'video/mp4'
                ? <video src={asset.signed_url} controls preload="metadata" className="size-full object-contain" aria-label={asset.file_name} />
                : asset.mime_type.startsWith('video/')
                  ? <Video className="size-8 text-[#727a70]" />
                  : <ImageIcon className="size-8 text-[#727a70]" />}
          </div>
          <div className="p-4">
            <h2 title={asset.file_name} className="truncate text-sm font-semibold">{asset.file_name}</h2>
            <p className="mt-1 text-xs text-[#858c84]">{asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ''}{bytesLabel(asset.byte_size)} · {asset.mime_type.split('/')[1]?.toUpperCase()}</p>
            <div className="mt-4"><PublicationLink asset={asset} publications={publications} /></div>
          </div>
        </article>)}
      </div> : <div className="flex flex-col items-center py-16 text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-[#e8ebe3] text-[#667361]"><ImageIcon className="size-5" /></div>
        <h2 className="text-sm font-semibold">{initialAssets.length ? 'No hay resultados' : 'Tu biblioteca está vacía'}</h2>
        <p className="mt-1 max-w-sm text-sm text-[#838a81]">{initialAssets.length ? 'Prueba con otro nombre de archivo.' : 'Agrega imágenes o videos para usarlos en tus publicaciones.'}</p>
      </div>}
      </>}
    </section>
  )
}
