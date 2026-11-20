import { NextResponse, type NextRequest } from 'next/server'
import {
  accessCookie,
  accessSeconds,
  privateConfig,
  sameSecret,
  signAccess,
} from '@/lib/private-access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const config = privateConfig()
    const { key } = await params
    if (!sameSecret(key, config.key))
      return new NextResponse('No encontrado.', { status: 404 })
    // Una redirección relativa conserva el dominio del navegador detrás de proxies.
    const response = new NextResponse(null, {
      status: 303,
      headers: { Location: '/' },
    })
    response.cookies.set(accessCookie, signAccess(config.key, config.ownerId), {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: accessSeconds,
    })
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch {
    return new NextResponse('El espacio privado todavía no está configurado.', {
      status: 503,
    })
  }
}
