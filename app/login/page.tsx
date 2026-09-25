import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react'
import { requestPasswordReset, signIn, signUp } from '@/app/actions/auth'

type LoginPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>
}

const errors: Record<string, string> = {
  credentials: 'No pudimos iniciar sesión. Revisa tu correo y contraseña.',
  signup: 'Completa tu nombre y correo; la contraseña debe tener al menos 8 caracteres.',
  confirmation: 'El enlace de confirmación no es válido o ya venció. Intenta registrarte de nuevo.',
  reset: 'No pudimos enviar el enlace. Revisa el correo e inténtalo de nuevo.',
  'reset-session': 'El enlace venció. Solicita uno nuevo para cambiar tu contraseña.',
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message } = await searchParams

  return (
    <main className="grid min-h-screen bg-[#f5f5f1] text-[#1f2422] lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.82fr)]">
      <section className="flex flex-col justify-between border-b border-[#dedfd8] px-6 py-7 sm:px-10 lg:border-b-0 lg:border-r lg:px-16 lg:py-10">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#222824] text-[#f5c86a]"><Sparkles className="size-4" /></span>
          <span className="font-serif text-2xl font-semibold">norte.</span>
        </div>
        <div className="max-w-xl py-12 lg:py-0">
          <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase text-[#74816f]"><LockKeyhole className="size-3.5" />Tu espacio de trabajo</p>
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Dale dirección a tus ideas.</h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-[#747b72]">Organiza publicaciones, calendario y resultados desde un solo lugar.</p>
        </div>
        <p className="text-xs text-[#929990]">norte. · Gestión de contenido</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <h2 className="font-serif text-3xl">Entra a tu cuenta</h2>
          <p className="mt-2 text-sm text-[#747b72]">Inicia sesión o crea tu espacio de trabajo.</p>

          {error && <p role="alert" className="mt-5 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">{errors[error] ?? errors.credentials}</p>}
          {message === 'check-email' && <p role="status" className="mt-5 rounded-md border border-[#c8d8ca] bg-[#f0f6ef] px-3 py-2.5 text-sm text-[#45694c]">Te enviamos un enlace para confirmar tu correo.</p>}
          {message === 'reset-email' && <p role="status" className="mt-5 rounded-md border border-[#c8d8ca] bg-[#f0f6ef] px-3 py-2.5 text-sm text-[#45694c]">Si el correo corresponde a una cuenta, recibirás un enlace para restablecer la contraseña.</p>}
          {message === 'password-updated' && <p role="status" className="mt-5 rounded-md border border-[#c8d8ca] bg-[#f0f6ef] px-3 py-2.5 text-sm text-[#45694c]">La contraseña se actualizó. Ya puedes iniciar sesión.</p>}

          <form className="mt-7 space-y-4">
            <label className="block text-sm font-medium">Nombre
              <input name="full_name" autoComplete="name" maxLength={100} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" placeholder="Tu nombre" />
            </label>
            <label className="block text-sm font-medium">Correo electrónico
              <input name="email" type="email" autoComplete="email" required className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" placeholder="nombre@correo.com" />
            </label>
            <label className="block text-sm font-medium">Contraseña
              <input name="password" type="password" autoComplete="current-password" required className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" placeholder="Tu contraseña" />
            </label>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <button formAction={signIn} className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b]">Iniciar sesión <ArrowRight className="size-4" /></button>
              <button formAction={signUp} className="h-11 rounded-md border border-[#cdd1c8] bg-transparent px-4 text-sm font-semibold hover:bg-[#eceee8]">Crear cuenta</button>
            </div>
            <button formAction={requestPasswordReset} formNoValidate className="pt-1 text-sm font-medium text-[#65705f] underline underline-offset-4 hover:text-[#39413b]">Olvidé mi contraseña</button>
          </form>
        </div>
      </section>
    </main>
  )
}
