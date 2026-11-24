import { NextResponse, type NextRequest } from 'next/server'
import {
  accessCookie,
  accessSeconds,
  catalogPassword,
  privateConfig,
  sameSecret,
  signAccess,
} from '@/lib/private-access'

function pagina(error = false, status = 200) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f4f5}
form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 1px 4px #0002;display:grid;gap:12px;width:min(320px,85vw)}
input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #ccc}button{background:#111;color:#fff;border:0;cursor:pointer}
p{margin:0;color:#b91c1c;font-size:14px}</style></head><body>
<form method="post" action="/entrar"><strong>Catálogo Multiplanet</strong>
<input type="password" name="clave" placeholder="Contraseña" autofocus required autocomplete="current-password">
${error ? '<p>Contraseña incorrecta.</p>' : ''}<button>Entrar</button></form></body></html>`
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export function GET() {
  if (!catalogPassword()) return new NextResponse('No encontrado.', { status: 404 })
  return pagina()
}

export async function POST(request: NextRequest) {
  const password = catalogPassword()
  if (!password) return new NextResponse('No encontrado.', { status: 404 })
  let config: ReturnType<typeof privateConfig>
  try {
    config = privateConfig()
  } catch {
    return new NextResponse('El espacio privado todavía no está configurado.', { status: 503 })
  }
  const form = await request.formData()
  const clave = String(form.get('clave') ?? '')
  if (!sameSecret(clave, password)) {
    await new Promise((r) => setTimeout(r, 1500)) // frena intentos repetidos
    return pagina(true, 401)
  }
  const response = new NextResponse(null, { status: 303, headers: { Location: '/' } })
  response.cookies.set(accessCookie, signAccess(config.key, config.ownerBinding), {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: accessSeconds,
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
