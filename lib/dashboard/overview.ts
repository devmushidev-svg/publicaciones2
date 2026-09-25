import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export type OverviewPublication = {
  id: string
  title: string
  category: string | null
  scheduled_for: string | null
  platforms: string[]
}

export type OverviewIdea = { id: string; title: string }

export type OverviewData = {
  timezone: string
  todayLabel: string
  publications: OverviewPublication[]
  ideas: OverviewIdea[]
  chart: number[]
  reachYesterday: number
  reachChange: number | null
  error: boolean
}

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function addDays(key: string, amount: number) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + amount))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function startOfDayUtc(key: string, timeZone: string) {
  const [year, month, day] = key.split('-').map(Number)
  let guess = Date.UTC(year, month - 1, day)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess))
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0)
    const represented = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
    guess += Date.UTC(year, month - 1, day) - represented
  }

  return new Date(guess).toISOString()
}

function validTimeZone(value: string | undefined) {
  if (!value) return 'America/Tegucigalpa'
  try {
    new Intl.DateTimeFormat('es', { timeZone: value })
    return value
  } catch {
    return 'America/Tegucigalpa'
  }
}

export async function getOverviewData(supabase: SupabaseClient, userId: string): Promise<OverviewData> {
  const { data: preferences, error: preferencesError } = await supabase
    .from('account_preferences')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle()

  const timezone = validTimeZone(preferences?.timezone)
  const today = dateKey(new Date(), timezone)
  const yesterday = addDays(today, -1)
  const dayBefore = addDays(today, -2)
  const chartStart = addDays(today, -11)
  const todayStartUtc = startOfDayUtc(today, timezone)
  const tomorrowStartUtc = startOfDayUtc(addDays(today, 1), timezone)

  const [publicationsResult, ideasResult, metricsResult] = await Promise.all([
    supabase
      .from('publications')
      .select('id,title,category,scheduled_for,platforms')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('scheduled_for', todayStartUtc)
      .lt('scheduled_for', tomorrowStartUtc)
      .order('scheduled_for', { ascending: true }),
    supabase
      .from('ideas')
      .select('id,title')
      .eq('user_id', userId)
      .eq('status', 'inbox')
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('performance_metrics')
      .select('measured_on,reach')
      .eq('user_id', userId)
      .gte('measured_on', chartStart)
      .lte('measured_on', yesterday)
      .order('measured_on', { ascending: true }),
  ])

  const metricRows = metricsResult.data ?? []
  const reachByDay = new Map<string, number>()
  for (const metric of metricRows) {
    reachByDay.set(metric.measured_on, (reachByDay.get(metric.measured_on) ?? 0) + metric.reach)
  }

  const chart = Array.from({ length: 12 }, (_, index) => reachByDay.get(addDays(chartStart, index)) ?? 0)
  const reachYesterday = reachByDay.get(yesterday) ?? 0
  const reachBefore = reachByDay.get(dayBefore) ?? 0

  return {
    timezone,
    todayLabel: new Intl.DateTimeFormat('es', { dateStyle: 'full', timeZone: timezone }).format(new Date()),
    publications: publicationsResult.data ?? [],
    ideas: ideasResult.data ?? [],
    chart,
    reachYesterday,
    reachChange: reachBefore ? ((reachYesterday - reachBefore) / reachBefore) * 100 : null,
    error: Boolean(preferencesError || publicationsResult.error || ideasResult.error || metricsResult.error),
  }
}
