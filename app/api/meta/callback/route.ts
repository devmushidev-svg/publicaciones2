import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeMetaCode, getMetaConfig, listMetaPages } from '@/lib/meta/graph'
import { createAdminClient } from '@/lib/supabase/admin'

function sameState(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function GET(request: NextRequest) {
  const destination = (status: string) => new URL(`/?section=Conexiones&meta=${status}`, request.url)
  const response = (url: URL) => {
    const redirect = NextResponse.redirect(url)
    redirect.cookies.set('meta_oauth_state', '', { maxAge: 0, path: '/api/meta/callback' })
    return redirect
  }

  const config = getMetaConfig()
  const admin = createAdminClient()
  if (!config || !admin || new URL(config.redirectUri).origin !== request.nextUrl.origin) return response(destination('not_configured'))
  const [stateUserId, state] = (request.cookies.get('meta_oauth_state')?.value ?? '').split('.', 2)
  if (!sameState(state, request.nextUrl.searchParams.get('state'))) return response(destination('invalid_state'))
  if (request.nextUrl.searchParams.has('error')) return response(destination('denied'))
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return response(destination('failed'))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return response(new URL('/login', request.url))
  if (stateUserId !== user.id) return response(destination('invalid_state'))

  try {
    const token = await exchangeMetaCode(config, code)
    const pages = await listMetaPages(config, token.accessToken)
    if (pages.length === 0) return response(destination('no_pages'))
    const { data: attemptId, error } = await admin.rpc('begin_my_meta_connection', {
      p_user_id: user.id,
      p_pages: pages,
      p_token_expires_at: token.expiresAt,
    })
    if (error || typeof attemptId !== 'string') throw new Error('Could not save Meta connection attempt')
    return response(new URL(`/meta/select?attempt=${encodeURIComponent(attemptId)}`, request.url))
  } catch {
    return response(destination('failed'))
  }
}
