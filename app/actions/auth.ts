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

export async function requestPasswordReset(formData: FormData) {
  const email = formValue(formData, 'email')
  if (!email) redirect('/login?error=reset')

  const supabase = await createClient()
  const redirectTo = new URL('/auth/callback?next=%2Freset-password', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').toString()
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) redirect('/login?error=reset')
  redirect('/login?message=reset-email')
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmation = String(formData.get('confirmation') ?? '')
  if (password.length < 8 || password.length > 72 || password !== confirmation) redirect('/reset-password?error=password')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?error=reset-session')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) redirect('/reset-password?error=password')
  await supabase.auth.signOut()
  redirect('/login?message=password-updated')
}
