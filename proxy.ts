import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { accessCookie, privateConfig, validAccess } from '@/lib/private-access'

export function proxy(request: NextRequest) {
  // El puente usa su propia clave y valida antes de tocar Supabase.
  if (
    request.nextUrl.pathname.startsWith('/api/catalogo/') ||
    request.nextUrl.pathname.startsWith('/access/')
  ) {
    return NextResponse.next()
  }
  try {
    const { key, ownerBinding } = privateConfig()
    if (
      !validAccess(request.cookies.get(accessCookie)?.value, key, ownerBinding)
    ) {
      return new NextResponse('No encontrado.', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  } catch {
    return new NextResponse('El espacio privado todavía no está configurado.', {
      status: 503,
    })
  }
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
