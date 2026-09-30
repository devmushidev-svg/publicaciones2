import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

type PageChoice = { id: string; name: string; instagram_id: string | null; instagram_username: string | null }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function SelectMetaPage({ searchParams }: { searchParams: Promise<{ attempt?: string }> }) {
  const { attempt } = await searchParams
  if (!attempt || !uuidPattern.test(attempt)) redirect('/?section=Conexiones&meta=invalid_selection')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data, error } = await supabase.rpc('list_my_meta_connection_pages', { p_attempt_id: attempt })
  const pages = Array.isArray(data) ? data as PageChoice[] : []
  if (error || pages.length === 0) redirect('/?section=Conexiones&meta=expired')

  return <main className="min-h-screen bg-[#f5f5f1] px-5 py-10 text-[#1f2422]">
    <div className="mx-auto max-w-[620px]">
      <Link href="/?section=Conexiones" className="text-sm text-[#58745f] hover:underline">Volver a Conexiones</Link>
      <h1 className="mt-8 font-serif text-3xl">Selecciona una Página</h1>
      <p className="mt-2 text-sm text-[#687168]">La cuenta de Instagram profesional debe estar vinculada a esa Página de Facebook.</p>
      <div className="mt-8 divide-y divide-[#dedfd8] border-y border-[#dedfd8]">
        {pages.map((page) => <form key={page.id} action="/api/meta/complete" method="post" className="flex flex-wrap items-center justify-between gap-4 py-5">
          <input type="hidden" name="attempt_id" value={attempt} />
          <input type="hidden" name="page_id" value={page.id} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{page.name}</h2>
            <p className="mt-1 text-xs text-[#687168]">{page.instagram_id ? `Instagram: ${page.instagram_username ? `@${page.instagram_username}` : 'cuenta profesional vinculada'}` : 'Sin Instagram profesional vinculado'}</p>
            {page.instagram_id && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="include_instagram" defaultChecked className="accent-[#416950]" />Vincular también Instagram</label>}
          </div>
          <button type="submit" className="h-9 rounded-md bg-[#1f2722] px-4 text-sm font-medium text-white hover:bg-[#334139]">Conectar</button>
        </form>)}
      </div>
    </div>
  </main>
}
