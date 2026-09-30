import { NextResponse, type NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return new NextResponse('Forbidden', { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url), 303)

  const form = await request.formData()
  const provider = String(form.get('provider') ?? '')
  if (provider !== 'facebook' && provider !== 'instagram') return new NextResponse('Invalid provider', { status: 400 })
  const { error } = await supabase.rpc('disconnect_my_meta_connection', { p_provider: provider })
  if (error) return NextResponse.redirect(new URL('/?section=Conexiones&meta=failed', request.url), 303)
  revalidatePath('/')
  return NextResponse.redirect(new URL('/?section=Conexiones&meta=disconnected', request.url), 303)
}
