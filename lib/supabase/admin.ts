import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from './config'

export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secretKey) return null
  const { url } = getSupabasePublicConfig()
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
