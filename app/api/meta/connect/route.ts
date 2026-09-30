import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMetaConfig, metaLoginUrl } from '@/lib/meta/graph'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const config = getMetaConfig()
  if (!config || !createAdminClient() || new URL(config.redirectUri).origin !== request.nextUrl.origin) {
    return NextResponse.redirect(new URL('/?section=Conexiones&meta=not_configured', request.url))
  }

  const state = randomBytes(32).toString('base64url')
  const response = NextResponse.redirect(metaLoginUrl(config, state))
  response.cookies.set('meta_oauth_state', `${user.id}.${state}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/meta/callback',
  })
  return response
}
