'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Check, Plus, Tag } from 'lucide-react'
import { archiveTaxonomyItem, saveTaxonomyItem, type TaxonomyActionState } from '@/app/actions/taxonomy'

export type CategoryOption = { id: string; name: string; color: string; is_archived: boolean }
export type TagOption = { id: string; name: string; is_archived: boolean }

function TaxonomyForm({ kind, item }: { kind: 'category' | 'tag'; item?: CategoryOption | TagOption }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<TaxonomyActionState, FormData>(saveTaxonomyItem, {})
  useEffect(() => { if (state.success) router.refresh() }, [router, state.success])
  const isCategory = kind === 'category'
  const category = item && 'color' in item ? item : undefined

  return <form action={action} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="id" value={item?.id ?? ''} />
    <label className="sr-only" htmlFor={`${kind}-${item?.id ?? 'new'}-name`}>{isCategory ? 'Nombre de categoría' : 'Nombre de etiqueta'}</label>
    <input id={`${kind}-${item?.id ?? 'new'}-name`} name="name" required maxLength={isCategory ? 80 : 50} defaultValue={item?.name ?? ''} placeholder={isCategory ? 'Ej. Florería' : 'Ej. cumpleaños'} className="h-10 min-w-0 flex-1 rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#71866f]" />
    {isCategory && <label className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d7dad2] bg-[#fbfbf8]" title="Color de categoría"><input type="color" name="color" defaultValue={category?.color ?? '#71866f'} aria-label="Color de categoría" className="size-6 cursor-pointer border-0 bg-transparent p-0" /></label>}
    <button type="submit" disabled={pending} aria-label={item ? 'Guardar cambios' : `Crear ${isCategory ? 'categoría' : 'etiqueta'}`} title={item ? 'Guardar cambios' : `Crear ${isCategory ? 'categoría' : 'etiqueta'}`} className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#222824] text-white hover:bg-[#39413b] disabled:opacity-50">{item ? <Check className="size-4" /> : <Plus className="size-4" />}</button>
    {state.error && <p role="alert" className="w-full text-xs text-[#8c3e2f]">{state.error}</p>}
    {state.success && <p role="status" className="w-full text-xs text-[#45694c]">{state.success}</p>}
  </form>
}

function ArchiveForm({ kind, id }: { kind: 'category' | 'tag'; id: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<TaxonomyActionState, FormData>(archiveTaxonomyItem, {})
  useEffect(() => { if (state.success) router.refresh() }, [router, state.success])
  return <form action={action} className="flex items-center gap-2">
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="id" value={id} />
    <button type="submit" disabled={pending} aria-label="Archivar" title="Archivar" className="rounded p-2 text-[#848b82] hover:bg-[#eef0eb] disabled:opacity-50"><Archive className="size-4" /></button>
    {state.error && <span role="alert" className="text-xs text-[#8c3e2f]">{state.error}</span>}
  </form>
}

export function DashboardTaxonomy({ categories, tags, hasError }: { categories: CategoryOption[]; tags: TagOption[]; hasError: boolean }) {
  const activeCategories = categories.filter((item) => !item.is_archived)
  const activeTags = tags.filter((item) => !item.is_archived)

  return <section className="mx-auto max-w-[1000px] px-5 pb-10 sm:px-8 lg:px-10">
    <div className="mb-5 border-t border-[#dedfd8] pt-6"><p className="text-xs font-semibold uppercase text-[#74816f]">Organización del contenido</p><h2 className="mt-2 font-serif text-2xl">Categorías y etiquetas</h2><p className="mt-1 text-sm text-[#747b72]">Clasifica tus publicaciones y encuentra contenido con facilidad.</p></div>
    {hasError && <p role="alert" className="mb-4 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No se pudo cargar la clasificación. Comprueba que la migración de categorías esté aplicada.</p>}
    <div className="grid gap-8 md:grid-cols-2">
      <section aria-labelledby="categories-heading">
        <div className="mb-3 flex items-center justify-between"><h3 id="categories-heading" className="text-sm font-semibold">Categorías</h3><span className="text-xs text-[#838a81]">{activeCategories.length} activas</span></div>
        <div className="space-y-2">{activeCategories.map((item) => <div key={item.id} className="flex items-center gap-2 border-b border-[#e3e4de] py-2"><span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><TaxonomyForm kind="category" item={item} /><ArchiveForm kind="category" id={item.id} /></div>)}</div>
        <div className="mt-3"><TaxonomyForm kind="category" /></div>
        {!activeCategories.length && <p className="mb-2 text-xs text-[#838a81]">Todavía no tienes categorías.</p>}
      </section>
      <section aria-labelledby="tags-heading">
        <div className="mb-3 flex items-center justify-between"><h3 id="tags-heading" className="text-sm font-semibold">Etiquetas</h3><span className="text-xs text-[#838a81]">{activeTags.length} activas</span></div>
        <div className="space-y-2">{activeTags.map((item) => <div key={item.id} className="flex items-center gap-2 border-b border-[#e3e4de] py-2"><Tag className="size-4 shrink-0 text-[#71816e]" /><TaxonomyForm kind="tag" item={item} /><ArchiveForm kind="tag" id={item.id} /></div>)}</div>
        <div className="mt-3"><TaxonomyForm kind="tag" /></div>
        {!activeTags.length && <p className="mb-2 text-xs text-[#838a81]">Todavía no tienes etiquetas.</p>}
      </section>
    </div>
  </section>
}
