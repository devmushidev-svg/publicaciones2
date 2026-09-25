'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function formValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim()
}

export async function signIn(formData: FormData) {
  const email = formValue(formData, 'email')
  const password = String(formData.get('password') ?? '')

  if (!email || !password) redirect('/login?error=credentials')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect('/login?error=credentials')

  redirect('/')
}

export async function signUp(formData: FormData) {
  const fullName = formValue(formData, 'full_name')
  const email = formValue(formData, 'email')
  const password = String(formData.get('password') ?? '')

  if (!fullName || fullName.length > 100 || !email || password.length < 8) {
    redirect('/login?error=signup')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`,
    },
  })

  if (error) redirect('/login?error=signup')
  if (!data.session) redirect('/login?message=check-email')

  redirect('/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
