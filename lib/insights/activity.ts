import { addDaysToKey, dateKeyInTimezone, hourInTimezone, weekdayOfKey } from '../date-time.ts'
import type { HistoryLiteRecord, ScheduledPostRecord } from '../dashboard/schedule.ts'

export type ActivityPublication = { id: string; title: string; category_id: string | null }
export type ActivityCategory = { id: string; name: string; color?: string; targetShare: number | null; enabled: boolean }

export type ActivityInput = {
  history: HistoryLiteRecord[]
  slots: ScheduledPostRecord[]
  publications: ActivityPublication[]
  categories: ActivityCategory[]
  postsPerDay: number
  timezone: string
  periodDays: number
  now?: Date
}

export type Occasion = {
  key: string
  publicationId: string
  publishedAt: string
  dayKey: string
  platforms: string[]
  title: string
  categoryId: string | null
  categoryName: string | null
}

export type ActivitySummary = {
  startKey: string
  endKey: string
  occasions: number
  platformPosts: number
  perDay: Array<{ date: string; occasions: number }>
  daysMeetingTarget: number
  activeDays: number
  averagePerDay: number
  byPlatform: Array<{ platform: string; count: number }>
  byCategory: Array<{ id: string | null; name: string; color?: string; occasions: number; share: number; targetShare: number | null }>
  byWeekday: number[]
  byHour: number[]
  topPublications: Array<{ publicationId: string; title: string; occasions: number; lastUsedAt: string }>
  plan: { due: number; fulfilled: number; fulfilledSameDay: number; cancelled: number; pending: number; upcoming: number }
}

/** Groups per-platform history rows into occasions (one per idempotency key). */
export function groupOccasions(history: HistoryLiteRecord[], publications: ActivityPublication[], categories: Array<{ id: string; name: string }>, timezone: string): Occasion[] {
  const publicationCategory = new Map(publications.map((item) => [item.id, item.category_id]))
  const categoryById = new Map(categories.map((item) => [item.id, item.name]))
  const categoryByName = new Map(categories.map((item) => [item.name.toLocaleLowerCase('es'), item.id]))
  const occasions = new Map<string, Occasion>()
  for (const row of history) {
    const current = occasions.get(row.idempotency_key)
    if (current) {
      if (!current.platforms.includes(row.platform)) current.platforms.push(row.platform)
      continue
    }
    // Prefer the publication's current category so renamed categories still count; fall back to the snapshot.
    const currentCategory = publicationCategory.get(row.publication_id)
    const categoryId = currentCategory && categoryById.has(currentCategory)
      ? currentCategory
      : row.category_snapshot ? categoryByName.get(row.category_snapshot.toLocaleLowerCase('es')) ?? null : null
    occasions.set(row.idempotency_key, {
      key: row.idempotency_key,
      publicationId: row.publication_id,
      publishedAt: row.published_at,
      dayKey: dateKeyInTimezone(new Date(row.published_at), timezone),
      platforms: [row.platform],
      title: row.title_snapshot,
      categoryId,
      categoryName: categoryId ? categoryById.get(categoryId) ?? row.category_snapshot : row.category_snapshot,
    })
  }
  return [...occasions.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export function summarizeActivity({ history, slots, publications, categories, postsPerDay, timezone, periodDays, now = new Date() }: ActivityInput): ActivitySummary {
  const endKey = dateKeyInTimezone(now, timezone)
  const startKey = addDaysToKey(endKey, -(periodDays - 1))
  const inPeriod = (key: string) => key >= startKey && key <= endKey
  const occasions = groupOccasions(history, publications, categories, timezone).filter((item) => inPeriod(item.dayKey))

  const perDayMap = new Map<string, number>()
  const byPlatformMap = new Map<string, number>()
  const byCategoryMap = new Map<string, number>()
  const byWeekday = Array.from({ length: 7 }, () => 0)
  const byHour = Array.from({ length: 24 }, () => 0)
  const byPublication = new Map<string, { title: string; occasions: number; lastUsedAt: string }>()
  let platformPosts = 0

  for (const occasion of occasions) {
    perDayMap.set(occasion.dayKey, (perDayMap.get(occasion.dayKey) ?? 0) + 1)
    for (const platform of occasion.platforms) byPlatformMap.set(platform, (byPlatformMap.get(platform) ?? 0) + 1)
    platformPosts += occasion.platforms.length
    const categoryKey = occasion.categoryId ?? ''
    byCategoryMap.set(categoryKey, (byCategoryMap.get(categoryKey) ?? 0) + 1)
    byWeekday[weekdayOfKey(occasion.dayKey)] += 1
    byHour[hourInTimezone(new Date(occasion.publishedAt), timezone)] += 1
    const publication = byPublication.get(occasion.publicationId)
    if (publication) {
      publication.occasions += 1
      if (occasion.publishedAt > publication.lastUsedAt) publication.lastUsedAt = occasion.publishedAt
    } else {
      byPublication.set(occasion.publicationId, { title: occasion.title, occasions: 1, lastUsedAt: occasion.publishedAt })
    }
  }

  const perDay = Array.from({ length: periodDays }, (_, index) => {
    const date = addDaysToKey(startKey, index)
    return { date, occasions: perDayMap.get(date) ?? 0 }
  })

  const enabledCategories = categories.filter((item) => item.enabled)
  const categoryRows: ActivitySummary['byCategory'] = categories
    .filter((item) => item.enabled || byCategoryMap.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      occasions: byCategoryMap.get(item.id) ?? 0,
      share: occasions.length ? (byCategoryMap.get(item.id) ?? 0) / occasions.length : 0,
      targetShare: item.enabled ? item.targetShare ?? (enabledCategories.length ? 1 / enabledCategories.length : null) : null,
    }))
  if (byCategoryMap.has('')) {
    categoryRows.push({ id: null, name: 'Sin categoría', occasions: byCategoryMap.get('') ?? 0, share: (byCategoryMap.get('') ?? 0) / occasions.length, targetShare: null })
  }
  categoryRows.sort((a, b) => b.occasions - a.occasions || a.name.localeCompare(b.name, 'es'))

  // Plan adherence only looks at intentions that were due inside the period.
  const nowMs = now.getTime()
  const occasionByKey = new Map(occasions.map((item) => [item.key, item]))
  const plan = { due: 0, fulfilled: 0, fulfilledSameDay: 0, cancelled: 0, pending: 0, upcoming: 0 }
  for (const slot of slots) {
    const plannedMs = new Date(slot.planned_for).getTime()
    const plannedKey = dateKeyInTimezone(new Date(slot.planned_for), timezone)
    if (plannedMs > nowMs && slot.status === 'planned') {
      plan.upcoming += 1
      continue
    }
    // A slot resolved before its planned time belongs to the day it was resolved.
    const resolvedAt = plannedMs > nowMs ? slot.fulfilled_at ?? slot.cancelled_at : null
    const effectiveKey = resolvedAt ? dateKeyInTimezone(new Date(resolvedAt), timezone) : plannedKey
    if (!inPeriod(effectiveKey)) continue
    plan.due += 1
    if (slot.status === 'fulfilled') {
      plan.fulfilled += 1
      const occasion = slot.history_idempotency_key ? occasionByKey.get(slot.history_idempotency_key) : undefined
      if (occasion?.dayKey === plannedKey) plan.fulfilledSameDay += 1
    } else if (slot.status === 'cancelled') plan.cancelled += 1
    else plan.pending += 1
  }

  return {
    startKey,
    endKey,
    occasions: occasions.length,
    platformPosts,
    perDay,
    daysMeetingTarget: perDay.filter((item) => item.occasions >= postsPerDay).length,
    activeDays: perDay.filter((item) => item.occasions > 0).length,
    averagePerDay: occasions.length / periodDays,
    byPlatform: [...byPlatformMap.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform)),
    byCategory: categoryRows,
    byWeekday,
    byHour,
    topPublications: [...byPublication.entries()]
      .map(([publicationId, value]) => ({ publicationId, ...value }))
      .sort((a, b) => b.occasions - a.occasions || b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, 5),
    plan,
  }
}
