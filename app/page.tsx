import { DashboardShell } from '@/components/dashboard-shell'
import { redirect } from 'next/navigation'
import { getOverviewData } from '@/lib/dashboard/overview'
import { createClient } from '@/lib/supabase/server'
import type { MetricRecord } from '@/components/dashboard/dashboard-performance'
import type { CategoryOption, TagOption } from '@/components/dashboard/dashboard-taxonomy'
import { publicationHistoryPageSize, type PublicationHistoryRecord, type PublicationRecord } from '@/lib/dashboard/publications'
import type { CampaignRecord, HistoryLiteRecord, ScheduledPostRecord } from '@/lib/dashboard/schedule'
import { findOpportunities } from '@/lib/insights/opportunities'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id
  if (!userId) redirect('/login')

  const metricsStartDate = new Date()
  metricsStartDate.setDate(metricsStartDate.getDate() - 89)
  const metricsStart = `${metricsStartDate.getFullYear()}-${String(metricsStartDate.getMonth() + 1).padStart(2, '0')}-${String(metricsStartDate.getDate()).padStart(2, '0')}`

  // Calendar, activity analytics and opportunities look at roughly the last 13 months.
  const historySince = new Date()
  historySince.setDate(historySince.getDate() - 400)

  const [
    { data: profile },
    overview,
    { data: publications, error: publicationsError },
    { data: historyRows, error: historyError },
    { data: categoryRows, error: categoriesError },
    { data: tagRows, error: tagsError },
    { data: mediaRows, error: mediaError },
    { data: mediaLinks, error: mediaLinksError },
    { data: tagLinks, error: tagLinksError },
    { data: ideas, error: ideasError },
    { data: metricRows, error: metricsError },
    { data: connectionRows, error: connectionsError },
    { data: preferences, error: preferencesError },
    { data: recommendationSettings, error: recommendationSettingsError },
    { data: categoryPreferences, error: categoryPreferencesError },
    { count: aiMonthlyUsage },
    { data: slotRows, error: slotsError },
    { data: campaignRows, error: campaignsError },
    { data: historyLiteRows, error: historyLiteError },
  ] = await Promise.all([
    supabase.from('profiles').select('full_name,timezone').eq('id', userId).maybeSingle(),
    getOverviewData(supabase, userId),
    supabase
      .from('publications')
      .select('id,title,body,category_id,categories(name),status,scheduled_for,published_at,platforms,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('publication_history')
      .select('id,publication_id,idempotency_key,platform,published_at,title_snapshot,copy_snapshot,category_snapshot,tags_snapshot,media_snapshot,notes')
      .eq('user_id', userId)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, publicationHistoryPageSize - 1),
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
      .select('id,title,notes,status,source,campaign_id,publication_id,source_key,created_at')
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
    supabase.from('recommendation_settings').select('posts_per_day,minimum_repeat_days,balance_window_days').eq('user_id', userId).maybeSingle(),
    supabase.from('category_preferences').select('category_id,target_share,priority,is_enabled').eq('user_id', userId),
    supabase.from('ai_copy_generations').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()),
    supabase
      .from('scheduled_posts')
      .select('id,publication_id,campaign_id,planned_for,platforms,notes,status,history_idempotency_key,fulfilled_at,cancelled_at,created_at')
      .eq('user_id', userId)
      .gte('planned_for', historySince.toISOString())
      .order('planned_for', { ascending: true })
      .limit(5000),
    supabase
      .from('campaigns')
      .select('id,name,goal,color,starts_on,ends_on,target_posts,is_archived,created_at')
      .eq('user_id', userId)
      .order('starts_on', { ascending: false })
      .limit(500),
    supabase
      .from('publication_history')
      .select('idempotency_key,publication_id,platform,published_at,title_snapshot,category_snapshot,media_snapshot')
      .eq('user_id', userId)
      .gte('published_at', historySince.toISOString())
      .order('published_at', { ascending: false })
      .limit(5000),
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
  const historyBase = (historyRows ?? []) as unknown as PublicationHistoryRecord[]
  const historyPaths = [...new Set(historyBase.flatMap((entry) => entry.media_snapshot[0]?.storage_path ?? []))]
    .filter((path) => !signedUrls.has(path))
  const historyBatches = Array.from({ length: Math.ceil(historyPaths.length / 100) }, (_, index) => historyPaths.slice(index * 100, (index + 1) * 100))
  const historyUrlResults = await Promise.all(historyBatches.map((batch) => supabase.storage.from('publication-media').createSignedUrls(batch, 3600)))
  for (const { data } of historyUrlResults) {
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl)
    }
  }
  const historyRecords = historyBase.map((entry) => ({
    ...entry,
    media_snapshot: entry.media_snapshot.map((media) => ({ ...media, signed_url: signedUrls.get(media.storage_path) ?? null })),
  }))

  const historyLite = ((historyLiteRows ?? []) as unknown as Array<HistoryLiteRecord & { media_snapshot: Array<{ id?: string }> }>)
  const historyMediaIds = new Set(historyLite.flatMap((entry) => entry.media_snapshot.flatMap((item) => item.id ?? [])))
  const historyForClient: HistoryLiteRecord[] = historyLite.map((entry) => ({
    idempotency_key: entry.idempotency_key,
    publication_id: entry.publication_id,
    platform: entry.platform,
    published_at: entry.published_at,
    title_snapshot: entry.title_snapshot,
    category_snapshot: entry.category_snapshot,
  }))
  const scheduledPosts = (slotRows ?? []) as ScheduledPostRecord[]
  const campaigns = (campaignRows ?? []) as CampaignRecord[]
  const timezone = profile?.timezone || preferences?.timezone || 'America/Tegucigalpa'
  const categoryPreferenceById = new Map((categoryPreferences ?? []).map((item) => [item.category_id, item]))
  const insightCategories = categoryOptions.filter((category) => !category.is_archived).map((category) => {
    const preference = categoryPreferenceById.get(category.id)
    return { id: category.id, name: category.name, color: category.color, targetShare: preference?.target_share == null ? null : Number(preference.target_share), enabled: preference?.is_enabled ?? true }
  })
  const recommendationValues = {
    postsPerDay: recommendationSettings?.posts_per_day ?? 3,
    minimumRepeatDays: recommendationSettings?.minimum_repeat_days ?? 14,
    balanceWindowDays: recommendationSettings?.balance_window_days ?? 14,
  }
  const opportunities = findOpportunities({
    timezone,
    settings: recommendationValues,
    categories: insightCategories,
    publications: publicationRecords,
    history: historyForClient,
    historyMediaIds,
    slots: scheduledPosts,
    campaigns,
    media: assets,
  })

  const metadataName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : ''
  const userName = profile?.full_name || metadataName || user.email?.split('@')[0] || 'Tu cuenta'

  return <DashboardShell
    userName={userName}
    overview={overview}
    publications={publicationRecords}
    history={historyRecords}
    publicationsError={Boolean(publicationsError || mediaLinksError || tagLinksError)}
    historyError={Boolean(historyError)}
    categories={categoryOptions}
    tags={tagOptions}
    taxonomyError={Boolean(categoriesError || tagsError)}
    recommendationSettings={recommendationValues}
    insightCategories={insightCategories}
    scheduledPosts={scheduledPosts}
    campaigns={campaigns}
    historyLite={historyForClient}
    opportunities={opportunities}
    scheduleError={Boolean(slotsError || campaignsError || historyLiteError)}
    categoryPreferences={categoryPreferences ?? []}
    recommendationSettingsError={Boolean(recommendationSettingsError || categoryPreferencesError)}
    assets={assets}
    mediaError={Boolean(mediaError || mediaLinksError)}
    storageError={storageError}
    ideas={ideas ?? []}
    ideasError={Boolean(ideasError)}
    aiMonthlyUsage={aiMonthlyUsage}
    metrics={(metricRows ?? []) as MetricRecord[]}
    metricsError={Boolean(metricsError)}
    connections={connectionRows ?? []}
    connectionsError={Boolean(connectionsError)}
    settings={{
      email: user.email ?? '',
      fullName: profile?.full_name || metadataName || user.email?.split('@')[0] || '',
      timezone,
      weekStartsOn: preferences?.week_starts_on ?? 1,
      emailDigest: preferences?.email_digest ?? true,
      hasError: Boolean(preferencesError || !profile),
    }}
  />
}
