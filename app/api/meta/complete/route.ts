import { NextResponse, type NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return new NextResponse('Forbidden', { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url), 303)

  const form = await request.formData()
  const attemptId = String(form.get('attempt_id') ?? '')
  const pageId = String(form.get('page_id') ?? '')
  const includeInstagram = form.get('include_instagram') === 'on'
  if (!uuidPattern.test(attemptId) || !pageId || pageId.length > 128) {
    return NextResponse.redirect(new URL('/?section=Conexiones&meta=invalid_selection', request.url), 303)
  }
  const { error } = await supabase.rpc('finish_my_meta_connection', {
    p_attempt_id: attemptId,
    p_page_id: pageId,
    p_include_instagram: includeInstagram,
  })
  if (error) return NextResponse.redirect(new URL('/?section=Conexiones&meta=failed', request.url), 303)
  revalidatePath('/')
  return NextResponse.redirect(new URL('/?section=Conexiones&meta=connected', request.url), 303)
}
