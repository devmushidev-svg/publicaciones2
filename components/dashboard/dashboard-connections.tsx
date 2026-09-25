import { Check, Clock3, Link2, Unplug } from 'lucide-react'

export type SocialConnectionRecord = { id: string; provider: string; account_name: string; account_external_id: string | null; connected_at: string; last_synced_at: string | null; is_active: boolean }

const providers = [
  { id: 'instagram', name: 'Instagram', mark: 'IG' },
  { id: 'facebook', name: 'Facebook', mark: 'f' },
  { id: 'linkedin', name: 'LinkedIn', mark: 'in' },
  { id: 'tiktok', name: 'TikTok', mark: '♪' },
  { id: 'x', name: 'X', mark: 'X' },
]

function dateTime(value: string | null) {
  if (!value) return 'Sin sincronizaciones registradas'
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function DashboardConnections({ connections, hasError }: { connections: SocialConnectionRecord[]; hasError: boolean }) {
  const connectionByProvider = new Map(connections.map((connection) => [connection.provider, connection]))
  const activeCount = connections.filter((connection) => connection.is_active).length

  return <section className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <div className="mb-7"><p className="text-xs font-semibold uppercase text-[#74816f]">Cuenta</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Conexiones</h1><p className="mt-2 text-sm text-[#747b72]">Estado de las cuentas sociales vinculadas a tu espacio.</p></div>
    {hasError && <p role="status" className="mb-5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No pudimos consultar todas las conexiones.</p>}
    <div className="mb-5 flex items-center gap-2 border-b border-[#dedfd8] pb-4 text-sm text-[#626b61]"><Link2 className="size-4" />{activeCount} {activeCount === 1 ? 'cuenta activa' : 'cuentas activas'}</div>
    <div className="divide-y divide-[#e3e4de] border-y border-[#e3e4de]">
      {providers.map((provider) => {
        const connection = connectionByProvider.get(provider.id)
        const active = Boolean(connection?.is_active)
        return <article key={provider.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4"><span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-md border border-[#dedfd8] bg-[#fbfbf8] text-sm font-semibold text-[#48534a]">{provider.mark}</span><div className="min-w-0"><h2 className="text-sm font-semibold">{provider.name}</h2>{active ? <><p className="mt-1 truncate text-sm text-[#626b61]">{connection?.account_name}</p><p className="mt-1 text-xs text-[#858c84]">Última sincronización: {dateTime(connection?.last_synced_at ?? null)}</p></> : <p className="mt-1 text-xs text-[#858c84]">No hay una cuenta conectada.</p>}</div></div>
          <div className={`flex shrink-0 items-center gap-2 text-xs font-medium ${active ? 'text-[#4c7557]' : 'text-[#818880]'}`}>{active ? <><Check className="size-4" />Conectada</> : <><Unplug className="size-4" />Desconectada</>}</div>
        </article>
      })}
    </div>
    <div className="mt-6 flex items-start gap-3 border-l-2 border-[#c9d2c5] py-1 pl-4"><Clock3 className="mt-0.5 size-4 shrink-0 text-[#74816f]" /><p className="text-sm leading-6 text-[#747b72]">La autorización OAuth y la sincronización automática aún no están configuradas. Esta vista refleja únicamente conexiones guardadas; no permite conectar cuentas todavía.</p></div>
  </section>
}
