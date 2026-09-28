export type RecommendationCandidate = {
  id: string
  title: string
  categoryId: string | null
  tagIds: string[]
  createdAt: string
  lastUsedAt: string | null
  scheduledToday: boolean
  /** Next planned slot, if any. Planned content inside the rest period is not suggested again. */
  nextPlannedAt?: string | null
}

export type RecommendationCategory = {
  id: string
  name: string
  priority: number
  targetShare: number | null
  enabled: boolean
  recentUses: number
}

export type RecommendationSettings = {
  postsPerDay: number
  minimumRepeatDays: number
  balanceWindowDays: number
}

export type DailyRecommendation = RecommendationCandidate & { reason: string }

const dayMs = 86_400_000

export function recommendDailyContent(
  candidates: RecommendationCandidate[],
  categories: RecommendationCategory[],
  settings: RecommendationSettings,
  now = new Date(),
): DailyRecommendation[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const activeCategories = categories.filter((category) => category.enabled)
  const eligible = candidates.filter((candidate) => {
    if (candidate.scheduledToday) return false
    if (candidate.nextPlannedAt) {
      const daysUntilPlan = (new Date(candidate.nextPlannedAt).getTime() - now.getTime()) / dayMs
      if (daysUntilPlan < Math.max(settings.minimumRepeatDays, 1)) return false
    }
    if (candidate.lastUsedAt) {
      const daysSinceUse = Math.floor((now.getTime() - new Date(candidate.lastUsedAt).getTime()) / dayMs)
      if (daysSinceUse < settings.minimumRepeatDays) return false
    }
    const category = candidate.categoryId ? categoryById.get(candidate.categoryId) : undefined
    return !category || category.enabled
  })
  const selected: DailyRecommendation[] = []
  const categoryPicks = new Map<string, number>()

  while (selected.length < settings.postsPerDay && eligible.length) {
    let bestIndex = -1
    let bestScore = Number.NEGATIVE_INFINITY
    let bestReason = ''

    eligible.forEach((candidate, index) => {
      const category = candidate.categoryId ? categoryById.get(candidate.categoryId) : undefined
      const ageDays = Math.max(0, (now.getTime() - new Date(candidate.createdAt).getTime()) / dayMs)
      const recency = Math.max(0, 1 - ageDays / Math.max(settings.balanceWindowDays, 1))
      const priority = (category?.priority ?? 2) / 5
      const desiredShare = category?.targetShare ?? (activeCategories.length ? 1 / activeCategories.length : 1)
      const totalRecentUses = activeCategories.reduce((sum, item) => sum + item.recentUses, 0)
      const observedShare = totalRecentUses ? (category?.recentUses ?? 0) / totalRecentUses : 0
      const deficit = Math.max(0, desiredShare - observedShare)
      const novelty = candidate.tagIds.length
        ? candidate.tagIds.filter((tagId) => selected.every((item) => !item.tagIds.includes(tagId))).length / candidate.tagIds.length
        : 0.5
      const overlap = selected.reduce((max, item) => {
        const shared = candidate.tagIds.filter((tagId) => item.tagIds.includes(tagId)).length
        const union = new Set([...candidate.tagIds, ...item.tagIds]).size
        return Math.max(max, union ? shared / union : 0)
      }, 0)
      const score = recency * 0.25 + priority * 0.2 + Math.min(deficit, 1) * 0.4 + novelty * 0.15 - overlap * 0.2
        - (category ? (categoryPicks.get(category.id) ?? 0) * 0.35 : 0)

      if (score > bestScore || (score === bestScore && candidate.id < eligible[bestIndex]?.id)) {
        bestScore = score
        bestIndex = index
        bestReason = category && deficit > 0.05
          ? `Ayuda a equilibrar ${category.name}.`
          : candidate.lastUsedAt
            ? `Ya cumplió ${settings.minimumRepeatDays} días de descanso.`
            : candidate.tagIds.length
              ? 'Aporta variedad frente a las otras sugerencias.'
              : 'Está disponible y aporta variedad a tu calendario.'
      }
    })

    const [candidate] = eligible.splice(bestIndex, 1)
    selected.push({ ...candidate, reason: bestReason })
    if (candidate.categoryId) categoryPicks.set(candidate.categoryId, (categoryPicks.get(candidate.categoryId) ?? 0) + 1)
  }

  return selected
}
