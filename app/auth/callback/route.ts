import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/login?error=confirmation', request.url))

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  const next = request.nextUrl.searchParams.get('next')
  const safeNext = next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
  const destination = error ? '/login?error=confirmation' : safeNext
  return NextResponse.redirect(new URL(destination, request.url))
}
