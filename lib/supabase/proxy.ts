import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabasePublicConfig } from './config'

export async function updateSession(request: NextRequest) {
  let config: ReturnType<typeof getSupabasePublicConfig>
  try {
    config = getSupabasePublicConfig()
  } catch {
    return NextResponse.next({ request })
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

  await supabase.auth.getClaims()
  return response
}
