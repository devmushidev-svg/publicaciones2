import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabasePublicConfig } from './config'
import { issueOwnerSession } from './owner'
import { privateConfig } from '../private-access'

export async function updateSession(request: NextRequest) {
  let config: ReturnType<typeof getSupabasePublicConfig>
  try {
    config = getSupabasePublicConfig()
  } catch {
    return new NextResponse('Falta configurar Supabase en el servidor.', { status: 503 })
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))

        for (const header of ['cache-control', 'expires', 'pragma']) {
          const value = headers?.[header]
          if (value) response.headers.set(header, value)
        }
      },
    },
  })

  try {
    const { ownerId } = privateConfig()
    const { data } = await supabase.auth.getUser()
    if (data.user?.id !== ownerId) {
      const session = await issueOwnerSession()
      const { error } = await supabase.auth.setSession(session)
      if (error) throw error
    }
  } catch {
    return new NextResponse('No se pudo abrir el catálogo privado. Revisá la configuración del servidor.', { status: 503 })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
