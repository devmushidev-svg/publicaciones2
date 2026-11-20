import 'server-only'

import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { createAdminClient } from './admin'
import { getSupabasePublicConfig } from './config'
import { privateConfig } from '../private-access'

// Sesión REAL del dueño existente: conserva auth.uid() y todas las políticas RLS.
// generateLink no envía correo ni expone la clave administrativa al navegador.
export async function issueOwnerSession(): Promise<Session> {
  const { ownerId } = privateConfig()
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
  const { ownerId } = privateConfig()
  const { url, publishableKey } = getSupabasePublicConfig()
  const identity = `${url}:${ownerId}`
  if (cached?.identity === identity && cached.expires > Date.now() + 60_000)
    return cached.client
  if (!pending)
    pending = (async () => {
      const session = await issueOwnerSession()
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
