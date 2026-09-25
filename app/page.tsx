import { DashboardShell } from '@/components/dashboard-shell'
import { redirect } from 'next/navigation'
import { getOverviewData } from '@/lib/dashboard/overview'
import { createClient } from '@/lib/supabase/server'
import type { MetricRecord } from '@/components/dashboard/dashboard-performance'
import type { CategoryOption, TagOption } from '@/components/dashboard/dashboard-taxonomy'
import type { PublicationRecord } from '@/lib/dashboard/publications'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id
  if (!userId) redirect('/login')

  const metricsStartDate = new Date()
  metricsStartDate.setDate(metricsStartDate.getDate() - 89)
  const metricsStart = `${metricsStartDate.getFullYear()}-${String(metricsStartDate.getMonth() + 1).padStart(2, '0')}-${String(metricsStartDate.getDate()).padStart(2, '0')}`

  const [
    { data: profile },
    overview,
    { data: publications, error: publicationsError },
    { data: categoryRows, error: categoriesError },
    { data: tagRows, error: tagsError },
    { data: mediaRows, error: mediaError },
    { data: mediaLinks, error: mediaLinksError },
    { data: tagLinks, error: tagLinksError },
    { data: ideas, error: ideasError },
    { data: metricRows, error: metricsError },
    { data: connectionRows, error: connectionsError },
    { data: preferences, error: preferencesError },
  ] = await Promise.all([
    supabase.from('profiles').select('full_name,timezone').eq('id', userId).maybeSingle(),
    getOverviewData(supabase, userId),
    supabase
      .from('publications')
      .select('id,title,body,category_id,categories(name),status,scheduled_for,published_at,platforms,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('categories').select('id,name,color,is_archived').eq('user_id', userId).order('name'),
    supabase.from('tags').select('id,name,is_archived').eq('user_id', userId).order('name'),
    supabase
      .from('media_assets')
      .select('id,storage_path,file_name,mime_type,byte_size,width,height,alt_text,content_sha256,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('publication_media').select('media_asset_id,publication_id,sort_order').eq('user_id', userId).order('sort_order'),
    supabase.from('publication_tags').select('publication_id,tag_id').eq('user_id', userId),
    supabase
      .from('ideas')
      .select('id,title,notes,status,source,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('performance_metrics')
      .select('id,publication_id,platform,measured_on,reach,impressions,engagements,clicks')
      .eq('user_id', userId)
      .gte('measured_on', metricsStart)
      .order('measured_on', { ascending: true })
      .limit(2000),
    supabase
      .from('social_connections')
      .select('id,provider,account_name,account_external_id,connected_at,last_synced_at,is_active')
      .eq('user_id', userId)
      .order('connected_at', { ascending: false }),
    supabase.from('account_preferences').select('timezone,week_starts_on,email_digest').eq('user_id', userId).maybeSingle(),
  ])

  let storageError = false
  const signedUrls = new Map<string, string>()
  if (mediaRows?.length) {
    const paths = mediaRows.map((asset) => asset.storage_path)
    const batches = Array.from({ length: Math.ceil(paths.length / 100) }, (_, index) => paths.slice(index * 100, (index + 1) * 100))
    const results = await Promise.all(batches.map((batch) => supabase.storage.from('publication-media').createSignedUrls(batch, 3600)))
    for (const { data, error } of results) {
      storageError ||= Boolean(error || data?.some((item) => item.error))
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl)
      }
    }
  }

  const publicationsByMedia = new Map<string, string[]>()
  const mediaByPublication = new Map<string, string[]>()
  for (const link of mediaLinks ?? []) {
    const ids = publicationsByMedia.get(link.media_asset_id) ?? []
    ids.push(link.publication_id)
    publicationsByMedia.set(link.media_asset_id, ids)
    const assetIds = mediaByPublication.get(link.publication_id) ?? []
    assetIds.push(link.media_asset_id)
    mediaByPublication.set(link.publication_id, assetIds)
  }
  const tagsByPublication = new Map<string, string[]>()
  for (const link of tagLinks ?? []) {
    const ids = tagsByPublication.get(link.publication_id) ?? []
    ids.push(link.tag_id)
    tagsByPublication.set(link.publication_id, ids)
  }
  const assets = (mediaRows ?? []).map((asset) => ({
    ...asset,
    signed_url: signedUrls.get(asset.storage_path) ?? null,
    publicationIds: publicationsByMedia.get(asset.id) ?? [],
  }))
  const categoryOptions = (categoryRows ?? []) as CategoryOption[]
  const tagOptions = (tagRows ?? []) as TagOption[]
  const publicationRows = (publications ?? []) as unknown as Array<PublicationRecord & { categories: { name: string } | { name: string }[] | null }>
  const publicationRecords = publicationRows.map((publication) => {
    const joinedCategory = publication.categories
    const categoryName = Array.isArray(joinedCategory) ? joinedCategory[0]?.name : joinedCategory?.name
    return {
      ...publication,
      category: categoryName ?? null,
      mediaAssetIds: mediaByPublication.get(publication.id) ?? [],
      tagIds: tagsByPublication.get(publication.id) ?? [],
    }
  })

  const metadataName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : ''
  const userName = profile?.full_name || metadataName || user.email?.split('@')[0] || 'Tu cuenta'

  return <DashboardShell
    userName={userName}
    overview={overview}
    publications={publicationRecords}
    publicationsError={Boolean(publicationsError || mediaLinksError || tagLinksError)}
    categories={categoryOptions}
    tags={tagOptions}
    taxonomyError={Boolean(categoriesError || tagsError)}
    assets={assets}
    mediaError={Boolean(mediaError || mediaLinksError)}
    storageError={storageError}
    ideas={ideas ?? []}
    ideasError={Boolean(ideasError)}
    metrics={(metricRows ?? []) as MetricRecord[]}
    metricsError={Boolean(metricsError)}
    connections={connectionRows ?? []}
    connectionsError={Boolean(connectionsError)}
    settings={{
      email: user.email ?? '',
      fullName: profile?.full_name || metadataName || user.email?.split('@')[0] || '',
      timezone: profile?.timezone || preferences?.timezone || 'America/Tegucigalpa',
      weekStartsOn: preferences?.week_starts_on ?? 1,
      emailDigest: preferences?.email_digest ?? true,
      hasError: Boolean(preferencesError || !profile),
    }}
  />
}
