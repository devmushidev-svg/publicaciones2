import { redirect } from 'next/navigation'
import { LockKeyhole, Sparkles } from 'lucide-react'
import { updatePassword } from '@/app/actions/auth'
import { createClient } from '@/lib/supabase/server'

type ResetPasswordProps = { searchParams: Promise<{ error?: string }> }

export default async function ResetPasswordPage({ searchParams }: ResetPasswordProps) {
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?error=reset-session')

  return <main className="flex min-h-screen items-center justify-center bg-[#f5f5f1] px-5 py-10 text-[#1f2422]">
    <section className="w-full max-w-md">
      <div className="mb-10 flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-[#222824] text-[#f5c86a]"><Sparkles className="size-4" /></span><span className="font-serif text-2xl font-semibold">norte.</span></div>
      <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase text-[#74816f]"><LockKeyhole className="size-3.5" />Seguridad de la cuenta</p>
      <h1 className="font-serif text-3xl">Crea una contraseña nueva</h1>
      <p className="mt-2 text-sm text-[#747b72]">Elige una contraseña de al menos 8 caracteres.</p>
      {error === 'password' && <p role="alert" className="mt-5 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-3 py-2.5 text-sm text-[#8c3e2f]">Las contraseñas deben coincidir y tener entre 8 y 72 caracteres.</p>}
      <form action={updatePassword} className="mt-7 space-y-4">
        <label className="block text-sm font-medium">Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" /></label>
        <label className="block text-sm font-medium">Confirmar contraseña<input name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={72} required className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#71866f] focus:ring-2 focus:ring-[#71866f]/20" /></label>
        <button type="submit" className="flex h-11 w-full items-center justify-center rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b]">Actualizar contraseña</button>
      </form>
    </section>
  </main>
}
