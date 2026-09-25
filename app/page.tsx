import { DashboardShell } from '@/components/dashboard-shell'
import { redirect } from 'next/navigation'
import { getOverviewData } from '@/lib/dashboard/overview'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id
  if (!userId) redirect('/login')

  const [{ data: profile }, overview, { data: publications, error: publicationsError }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    getOverviewData(supabase, userId),
    supabase
      .from('publications')
      .select('id,title,body,category,status,scheduled_for,published_at,platforms,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const metadataName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : ''
  const userName = profile?.full_name || metadataName || user.email?.split('@')[0] || 'Tu cuenta'

  return <DashboardShell userName={userName} overview={overview} publications={publications ?? []} publicationsError={Boolean(publicationsError)} />
}
