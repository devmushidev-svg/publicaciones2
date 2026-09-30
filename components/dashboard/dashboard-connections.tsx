import { Check, Link2, Unplug } from 'lucide-react'

export type SocialConnectionRecord = { id: string; provider: string; account_name: string; account_external_id: string | null; connected_at: string; last_synced_at: string | null; is_active: boolean; token_expires_at?: string | null }

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

const metaMessages: Record<string, string> = {
  connected: 'Cuenta de Meta conectada correctamente.',
  disconnected: 'Cuenta desconectada.',
  denied: 'Cancelaste la autorización de Meta.',
  no_pages: 'Meta no devolvió Páginas administrables. Comprueba los permisos de tu cuenta.',
  invalid_state: 'La autorización caducó o no coincide. Inicia la conexión de nuevo.',
  expired: 'La selección de Página caducó. Inicia la conexión de nuevo.',
  invalid_selection: 'No pudimos validar la Página seleccionada.',
  not_configured: 'Meta aún no está configurado para esta dirección. Revisa las variables y la URL de retorno.',
  failed: 'No pudimos completar la conexión con Meta. Vuelve a intentarlo.',
}

export function DashboardConnections({ connections, hasError, metaStatus, metaConfigured, asOf }: { connections: SocialConnectionRecord[]; hasError: boolean; metaStatus: string | null; metaConfigured: boolean; asOf: number }) {
  const connectionByProvider = new Map(connections.map((connection) => [connection.provider, connection]))
  const activeCount = connections.filter((connection) => connection.is_active && (!connection.token_expires_at || new Date(connection.token_expires_at).getTime() > asOf)).length

  return <section className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-[#74816f]">Cuenta</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Conexiones</h1><p className="mt-2 text-sm text-[#747b72]">Estado de las cuentas sociales vinculadas a tu espacio.</p></div>{metaConfigured && <a href="/api/meta/connect" className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1f2722] px-4 text-sm font-medium text-white hover:bg-[#334139]"><Link2 className="size-4" />Conectar Meta</a>}</div>
    {metaStatus && metaMessages[metaStatus] && <p role="status" className="mb-5 border-l-2 border-[#8d9f8b] bg-[#e9eee6] px-4 py-3 text-sm text-[#3f5844]">{metaMessages[metaStatus]}</p>}
    {hasError && <p role="status" className="mb-5 rounded-md border border-[#e7c8a2] bg-[#fff8ea] px-4 py-3 text-sm text-[#765c2c]">No pudimos consultar todas las conexiones.</p>}
    <div className="mb-5 flex items-center gap-2 border-b border-[#dedfd8] pb-4 text-sm text-[#626b61]"><Link2 className="size-4" />{activeCount} {activeCount === 1 ? 'cuenta activa' : 'cuentas activas'}</div>
    <div className="divide-y divide-[#e3e4de] border-y border-[#e3e4de]">
      {providers.map((provider) => {
        const connection = connectionByProvider.get(provider.id)
        const expired = Boolean(connection?.token_expires_at && new Date(connection.token_expires_at).getTime() <= asOf)
        const active = Boolean(connection?.is_active && !expired)
        return <article key={provider.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4"><span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-md border border-[#dedfd8] bg-[#fbfbf8] text-sm font-semibold text-[#48534a]">{provider.mark}</span><div className="min-w-0"><h2 className="text-sm font-semibold">{provider.name}</h2>{connection ? <><p className="mt-1 truncate text-sm text-[#626b61]">{connection.account_name}</p><p className="mt-1 text-xs text-[#858c84]">{expired ? `Autorización vencida: ${dateTime(connection.token_expires_at ?? null)}` : `Última sincronización: ${dateTime(connection.last_synced_at)}`}</p></> : <p className="mt-1 text-xs text-[#858c84]">No hay una cuenta conectada.</p>}</div></div>
          <div className="flex shrink-0 items-center gap-4"><div className={`flex items-center gap-2 text-xs font-medium ${active ? 'text-[#4c7557]' : 'text-[#818880]'}`}>{active ? <><Check className="size-4" />Conectada</> : <><Unplug className="size-4" />{expired ? 'Caducada' : 'Desconectada'}</>}</div>{connection && (provider.id === 'facebook' || provider.id === 'instagram') && <form action="/api/meta/disconnect" method="post"><input type="hidden" name="provider" value={provider.id} /><button type="submit" className="text-xs font-medium text-[#9b5048] hover:underline" title={provider.id === 'facebook' ? 'Desconecta también Instagram' : 'Desconectar Instagram'}>Desconectar</button></form>}</div>
        </article>
      })}
    </div>
    {!metaConfigured && <p className="mt-6 text-sm text-[#747b72]">La conexión con Meta todavía no está configurada en este entorno.</p>}
  </section>
}
