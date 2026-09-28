'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, LoaderCircle, Sparkles } from 'lucide-react'
import { generateAiCopy, saveGeneratedCopyAsDraft, type AiCopyState } from '@/app/actions/ai-copy'

const platforms = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'x', label: 'X' },
  { id: 'whatsapp', label: 'WhatsApp' },
]

const empty: AiCopyState = {}

export function DashboardAiCopy({ initialUsed }: { initialUsed: number | null }) {
  const router = useRouter()
  const [generation, generateAction, generating] = useActionState(generateAiCopy, empty)
  const [saving, saveAction, savingDraft] = useActionState(saveGeneratedCopyAsDraft, empty)
  const [drafts, setDrafts] = useState<{ generationId?: string; variants: NonNullable<AiCopyState['variants']> } | null>(null)
  const [selected, setSelected] = useState(0)
  const variants = drafts && drafts.generationId === generation.generationId ? drafts.variants : generation.variants ?? []
  const selectedIndex = selected < variants.length ? selected : 0

  useEffect(() => { if (saving.success) router.refresh() }, [router, saving.success])

  const active = variants[selectedIndex]

  return (
    <section className="mx-auto max-w-[1100px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase text-[#74816f]">Espacio de trabajo</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Crear con IA</h1><p className="mt-2 text-sm text-[#747b72]">Genera propuestas, edítalas y decide qué guardar.</p></div>
        <p className="shrink-0 text-xs text-[#747b72]">{generation.used ?? initialUsed ?? 0} / {generation.limit ?? 30} este mes</p>
      </header>

      <form action={generateAction} className="border-y border-[#dedfd8] py-6">
        <label className="block text-sm font-medium">¿Qué quieres comunicar?
          <textarea name="brief" required minLength={10} maxLength={3000} rows={5} placeholder="Describe el tema, el público y los datos que sí deben aparecer. Evita incluir información que no quieras enviar a un proveedor de IA." className="mt-2 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" />
        </label>
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Plataformas</legend>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">{platforms.map(({ id, label }) => <label key={id} className="flex items-center gap-2 text-sm text-[#555d55]"><input type="checkbox" name="platforms" value={id} defaultChecked={id === 'instagram' || id === 'facebook'} className="size-4 accent-[#526e58]" />{label}</label>)}</div>
        </fieldset>
        {generation.error && <p role="alert" className="mt-4 border-l-2 border-[#bd6a51] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{generation.error}</p>}
        <button type="submit" disabled={generating} className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-60">{generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{generating ? 'Generando…' : 'Generar 3 propuestas'}</button>
      </form>

      {active && <section className="mt-8" aria-label="Propuestas generadas">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dedfd8] pb-3">
          <h2 className="font-serif text-xl">Revisa y edita</h2>
          <div role="tablist" aria-label="Variantes" className="flex gap-1">{variants.map((variant, index) => <button type="button" role="tab" aria-selected={selectedIndex === index} key={index} onClick={() => setSelected(index)} className={`px-3 py-2 text-xs font-medium ${selectedIndex === index ? 'border-b-2 border-[#526e58] text-[#1f2422]' : 'text-[#747b72]'}`}>{variant.angle || `Opción ${index + 1}`}</button>)}</div>
        </div>
        <form action={saveAction} className="mt-5 max-w-3xl">
          <input type="hidden" name="generation_id" value={generation.generationId ?? ''} />
          <label className="block text-sm font-medium">Título<input name="title" required maxLength={200} value={active.headline} onChange={(event) => setDrafts({ generationId: generation.generationId, variants: variants.map((item, index) => index === selectedIndex ? { ...item, headline: event.target.value } : item) })} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f]" /></label>
          <label className="mt-4 block text-sm font-medium">Texto<textarea name="body" required maxLength={3000} rows={7} value={active.body} onChange={(event) => setDrafts({ generationId: generation.generationId, variants: variants.map((item, index) => index === selectedIndex ? { ...item, body: event.target.value } : item) })} className="mt-1.5 w-full resize-y rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#71866f]" /></label>
          <p className="mt-2 text-xs text-[#747b72]">Llamado a la acción sugerido: {active.callToAction}</p>
          {saving.error && <p role="alert" className="mt-4 text-sm text-[#8c3e2f]">{saving.error}</p>}
          {saving.success && <p role="status" className="mt-4 text-sm text-[#526e58]">{saving.success}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={savingDraft || Boolean(saving.success)} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-60"><Check className="size-4" />{savingDraft ? 'Guardando…' : saving.success ? 'Guardado' : 'Guardar como borrador'}</button>
            <button type="button" onClick={() => navigator.clipboard.writeText(`${active.headline}\n\n${active.body}\n\n${active.callToAction}`)} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#d7dad2] px-3 text-sm hover:bg-[#e8ebe3]"><Copy className="size-4" />Copiar texto</button>
          </div>
        </form>
      </section>}
    </section>
  )
}
