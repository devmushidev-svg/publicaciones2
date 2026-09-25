'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CircleUserRound, Globe2, Mail, Save } from 'lucide-react'
import { saveSettings, type SettingsActionState } from '@/app/actions/settings'

const timezones = [
  ['America/Tegucigalpa', 'Honduras (Tegucigalpa)'],
  ['America/Mexico_City', 'México (Ciudad de México)'],
  ['America/Guatemala', 'Guatemala'],
  ['America/El_Salvador', 'El Salvador'],
  ['America/Costa_Rica', 'Costa Rica'],
  ['America/Bogota', 'Colombia (Bogotá)'],
  ['America/Lima', 'Perú (Lima)'],
  ['America/Santiago', 'Chile (Santiago)'],
  ['America/Argentina/Buenos_Aires', 'Argentina (Buenos Aires)'],
  ['America/New_York', 'Estados Unidos (Nueva York)'],
  ['America/Los_Angeles', 'Estados Unidos (Los Ángeles)'],
  ['Europe/Madrid', 'España (Madrid)'],
] as const

type SettingsProps = {
  email: string
  fullName: string
  timezone: string
  weekStartsOn: number
  emailDigest: boolean
  hasError: boolean
}

export function DashboardSettings({ email, fullName, timezone, weekStartsOn, emailDigest, hasError }: SettingsProps) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(saveSettings, {})
  useEffect(() => { if (state.success) router.refresh() }, [router, state.success])
  const timezoneOptions: Array<readonly [string, string]> = [...timezones]
  if (!timezoneOptions.some(([value]) => value === timezone)) timezoneOptions.unshift([timezone, timezone])

  return <section className="mx-auto max-w-[1000px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <div className="mb-7"><p className="text-xs font-semibold uppercase text-[#74816f]">Cuenta</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">Configuración</h1><p className="mt-2 text-sm text-[#747b72]">Perfil, zona horaria y preferencias del espacio.</p></div>
    {(hasError || state.error) && <p role="alert" className="mb-5 rounded-md border border-[#e7bdb0] bg-[#fff5f1] px-4 py-3 text-sm text-[#8c3e2f]">{state.error || 'No se pudieron cargar las preferencias.'}</p>}
    {state.success && <p role="status" className="mb-5 flex items-center gap-2 rounded-md border border-[#c8d8ca] bg-[#f0f6ef] px-4 py-3 text-sm text-[#45694c]"><Check className="size-4" />{state.success}</p>}
    <form action={formAction} className="divide-y divide-[#dedfd8] border-y border-[#dedfd8]">
      <section className="py-6"><div className="mb-5 flex items-center gap-3"><CircleUserRound className="size-5 text-[#71816e]" /><div><h2 className="text-sm font-semibold">Perfil</h2><p className="mt-1 text-xs text-[#858c84]">Información de tu cuenta.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Nombre
        <input name="full_name" required maxLength={100} defaultValue={fullName} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f]" />
      </label><label className="text-sm font-medium">Correo electrónico
        <input value={email} readOnly className="mt-1.5 h-11 w-full cursor-not-allowed rounded-md border border-[#e3e4de] bg-[#f1f2ed] px-3 text-[#858c84] outline-none" />
      </label></div></section>
      <section className="py-6"><div className="mb-5 flex items-center gap-3"><Globe2 className="size-5 text-[#71816e]" /><div><h2 className="text-sm font-semibold">Calendario</h2><p className="mt-1 text-xs text-[#858c84]">Las fechas se muestran según estas preferencias.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Zona horaria
        <select name="timezone" defaultValue={timezone} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f]">{timezoneOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </label><label className="text-sm font-medium">La semana comienza
        <select name="week_starts_on" defaultValue={weekStartsOn} className="mt-1.5 h-11 w-full rounded-md border border-[#d7dad2] bg-[#fbfbf8] px-3 outline-none focus:border-[#71866f]">{['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map((label, value) => <option key={value} value={value}>{label}</option>)}</select>
      </label></div></section>
      <section className="py-6"><div className="flex items-start gap-3"><Mail className="mt-0.5 size-5 text-[#71816e]" /><div className="flex-1"><h2 className="text-sm font-semibold">Resumen por correo</h2><p className="mt-1 text-xs leading-5 text-[#858c84]">Preferencia para recibir un resumen de actividad. El envío requiere configurar el servicio de correo.</p></div><input type="checkbox" name="email_digest" defaultChecked={emailDigest} aria-label="Recibir resumen por correo" className="mt-1 size-4 accent-[#526e58]" /></div></section>
      <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-[#858c84]">La dirección de correo se administra desde tu proveedor de acceso.</p><button type="submit" disabled={pending} className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#222824] px-4 text-sm font-semibold text-white hover:bg-[#39413b] disabled:opacity-55"><Save className="size-4" />{pending ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
  </section>
}
