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

  const [
    { data: profile },
    overview,
    { data: publications, error: publicationsError },
    { data: mediaRows, error: mediaError },
    { data: mediaLinks, error: mediaLinksError },
  ] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    getOverviewData(supabase, userId),
    supabase
      .from('publications')
      .select('id,title,body,category,status,scheduled_for,published_at,platforms,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('media_assets')
      .select('id,storage_path,file_name,mime_type,byte_size,width,height,alt_text,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('publication_media').select('media_asset_id,publication_id').eq('user_id', userId),
  ])

  let storageError = false
  const signedUrls = new Map<string, string>()
  if (mediaRows?.length) {
    const { data, error } = await supabase.storage
      .from('publication-media')
      .createSignedUrls(mediaRows.map((asset) => asset.storage_path), 300)
    storageError = Boolean(error || data?.some((item) => item.error))
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl)
    }
  }

  const publicationsByMedia = new Map<string, string[]>()
  for (const link of mediaLinks ?? []) {
    const ids = publicationsByMedia.get(link.media_asset_id) ?? []
    ids.push(link.publication_id)
    publicationsByMedia.set(link.media_asset_id, ids)
  }
  const assets = (mediaRows ?? []).map((asset) => ({
    ...asset,
    signed_url: signedUrls.get(asset.storage_path) ?? null,
    publicationIds: publicationsByMedia.get(asset.id) ?? [],
  }))

  const metadataName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : ''
  const userName = profile?.full_name || metadataName || user.email?.split('@')[0] || 'Tu cuenta'

  return <DashboardShell
    userName={userName}
    overview={overview}
    publications={publications ?? []}
    publicationsError={Boolean(publicationsError)}
    assets={assets}
    mediaError={Boolean(mediaError || mediaLinksError)}
    storageError={storageError}
  />
}
