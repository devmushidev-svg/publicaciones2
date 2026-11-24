import 'server-only'

import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { createAdminClient } from './admin'
import { getSupabasePublicConfig } from './config'
import { privateConfig } from '../private-access'
import { selectOwnerByContent } from './owner-selection'

let discovered: { url: string; id: string; expires: number } | undefined

export async function resolveOwnerId() {
  const { ownerId } = privateConfig()
  if (ownerId) return ownerId
  const { url } = getSupabasePublicConfig()
  if (discovered?.url === url && discovered.expires > Date.now())
    return discovered.id
  const admin = createAdminClient()
  if (!admin) throw new Error('Falta SUPABASE_SECRET_KEY en el servidor.')
  // Dos resultados bastan para detectar ambigüedad sin descargar todas las cuentas.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 50,
  })
  if (error)
    throw new Error(
      'No se pudo identificar la cuenta propietaria. Revisá la clave de servidor de Supabase.',
    )
  let owners: string[] = []
  if (data.users.length > 1) {
    const rows = await admin.from('publications').select('user_id').limit(5000)
    owners = [...new Set((rows.data || []).map((row) => String(row.user_id)))]
  }
  const id = selectOwnerByContent(data.users, owners)
  discovered = { url, id, expires: Date.now() + 10 * 60 * 1000 }
  return id
}

// Sesión REAL del dueño existente: conserva auth.uid() y todas las políticas RLS.
// generateLink no envía correo ni expone la clave administrativa al navegador.
export async function issueOwnerSession(ownerId?: string): Promise<Session> {
  ownerId = ownerId || (await resolveOwnerId())
  const admin = createAdminClient()
  if (!admin) throw new Error('Falta SUPABASE_SECRET_KEY en el servidor.')
  const owner = await admin.auth.admin.getUserById(ownerId)
  if (owner.error || !owner.data.user?.email)
    throw new Error('No se encontró la cuenta propietaria configurada.')
  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: owner.data.user.email,
  })
  if (link.error || !link.data.properties?.hashed_token)
    throw new Error('No se pudo abrir el espacio privado.')
  const { url, publishableKey } = getSupabasePublicConfig()
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const verified = await client.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: 'email',
  })
  if (
    verified.error ||
    !verified.data.session ||
    verified.data.user?.id !== ownerId
  ) {
    throw new Error('No se pudo verificar la cuenta propietaria.')
  }
  return verified.data.session
}

let cached:
  | { client: SupabaseClient; expires: number; identity: string }
  | undefined
let pending: Promise<SupabaseClient> | undefined

export async function createOwnerClient() {
  const ownerId = await resolveOwnerId()
  const { url, publishableKey } = getSupabasePublicConfig()
  const identity = `${url}:${ownerId}`
  if (cached?.identity === identity && cached.expires > Date.now() + 60_000)
    return cached.client
  if (!pending)
    pending = (async () => {
      const session = await issueOwnerSession(ownerId)
      const client = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error } = await client.auth.setSession(session)
      if (error) throw new Error('No se pudo activar el catálogo.')
      cached = { client, expires: (session.expires_at || 0) * 1000, identity }
      return client
    })()
  try {
    return await pending
  } finally {
    pending = undefined
  }
}
