import { addDaysToKey, dateKeyInTimezone, daysBetweenKeys } from '../date-time.ts'
import { campaignIsActiveOn, isOverdue, type CampaignRecord, type HistoryLiteRecord, type ScheduledPostRecord } from '../dashboard/schedule.ts'
import { groupOccasions, type ActivityCategory } from './activity.ts'

export type OpportunityKind = 'pending' | 'coverage' | 'cadence' | 'category-gap' | 'overused' | 'rested' | 'unused-draft' | 'unused-media' | 'campaign'

export type Opportunity = {
  key: string
  kind: OpportunityKind
  priority: number
  title: string
  explanation: string
  evidence: string[]
  publicationId?: string
  campaignId?: string
}

export type OpportunityPublication = { id: string; title: string; status: string; category_id: string | null; created_at: string }
export type OpportunityMedia = { id: string; file_name: string; created_at: string; publicationIds: string[] }

export type OpportunityInput = {
  now?: Date
  timezone: string
  settings: { postsPerDay: number; minimumRepeatDays: number; balanceWindowDays: number }
  categories: ActivityCategory[]
  publications: OpportunityPublication[]
  history: HistoryLiteRecord[]
  historyMediaIds?: Set<string>
  slots: ScheduledPostRecord[]
  campaigns: CampaignRecord[]
  media: OpportunityMedia[]
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** Formats a calendar key that is already expressed in the account timezone. */
function dayLabel(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

export function findOpportunities(input: OpportunityInput): Opportunity[] {
  const { timezone, settings, categories, publications, history, slots, campaigns, media } = input
  const now = input.now ?? new Date()
  const todayKey = dateKeyInTimezone(now, timezone)
  const windowDays = Math.max(1, settings.balanceWindowDays)
  const windowStart = addDaysToKey(todayKey, -(windowDays - 1))
  const occasions = groupOccasions(history, publications, categories, timezone)
  const recent = occasions.filter((item) => item.dayKey >= windowStart && item.dayKey <= todayKey)
  const activePublications = publications.filter((item) => item.status !== 'archived')
  const publicationById = new Map(publications.map((item) => [item.id, item]))
  const plannedSlots = slots.filter((slot) => slot.status === 'planned')
  const futurePlanned = plannedSlots.filter((slot) => new Date(slot.planned_for).getTime() >= now.getTime())
  const plannedPublicationIds = new Set(futurePlanned.map((slot) => slot.publication_id))
  const lastUse = new Map<string, string>()
  const useCount = new Map<string, number>()
  for (const occasion of occasions) {
    if (!lastUse.has(occasion.publicationId)) lastUse.set(occasion.publicationId, occasion.dayKey)
    useCount.set(occasion.publicationId, (useCount.get(occasion.publicationId) ?? 0) + 1)
  }
  const result: Opportunity[] = []

  // 1. Intentions whose time passed without a recorded use.
  const overdue = plannedSlots.filter((slot) => isOverdue(slot, now)).sort((a, b) => a.planned_for.localeCompare(b.planned_for))
  if (overdue.length) {
    result.push({
      key: `pending:${todayKey}:${overdue.length}`,
      kind: 'pending',
      priority: 100,
      title: `${plural(overdue.length, 'programación pasó', 'programaciones pasaron')} sin registro`,
      explanation: 'Una programación es solo una intención. Confirma si se publicó registrando su uso, o cancélala para que no cuente como pendiente.',
      evidence: overdue.slice(0, 4).map((slot) => `${publicationById.get(slot.publication_id)?.title ?? 'Publicación'} · ${dayLabel(dateKeyInTimezone(new Date(slot.planned_for), timezone))}`),
    })
  }

  // 2. Upcoming days without enough planned slots for the daily goal.
  // Today also counts what was already recorded in the history.
  const usedToday = occasions.filter((item) => item.dayKey === todayKey).length
  const coverage = Array.from({ length: 7 }, (_, index) => addDaysToKey(todayKey, index)).map((key) => ({
    key,
    planned: futurePlanned.filter((slot) => dateKeyInTimezone(new Date(slot.planned_for), timezone) === key).length + (key === todayKey ? usedToday : 0),
  }))
  const shortDays = coverage.filter((day) => day.planned < settings.postsPerDay)
  if (activePublications.length && shortDays.length) {
    const missing = shortDays.reduce((sum, day) => sum + settings.postsPerDay - day.planned, 0)
    result.push({
      key: `coverage:${todayKey}`,
      kind: 'coverage',
      priority: 80,
      title: `Faltan ${plural(missing, 'espacio', 'espacios')} por programar esta semana`,
      explanation: `Tu objetivo es ${plural(settings.postsPerDay, 'publicación', 'publicaciones')} al día. ${plural(shortDays.length, 'día', 'días')} de los próximos 7 no ${shortDays.length === 1 ? 'lo alcanza' : 'lo alcanzan'} con lo programado.`,
      evidence: shortDays.slice(0, 5).map((day) => `${dayLabel(day.key)}: ${day.planned} de ${settings.postsPerDay}`),
    })
  }

  // 3. Real cadence versus the daily goal, only once there is history to compare.
  if (occasions.length) {
    const firstKey = occasions[occasions.length - 1].dayKey
    const observedDays = Math.min(windowDays, daysBetweenKeys(firstKey, todayKey) + 1)
    const observedStart = addDaysToKey(todayKey, -(observedDays - 1))
    const observed = recent.filter((item) => item.dayKey >= observedStart)
    const average = observed.length / observedDays
    const perDay = new Map<string, number>()
    for (const item of observed) perDay.set(item.dayKey, (perDay.get(item.dayKey) ?? 0) + 1)
    const belowDays = Array.from({ length: observedDays }, (_, index) => addDaysToKey(observedStart, index)).filter((key) => (perDay.get(key) ?? 0) < settings.postsPerDay)
    if (observedDays >= 3 && average < settings.postsPerDay * 0.8) {
      result.push({
        key: `cadence:${todayKey}`,
        kind: 'cadence',
        priority: 70,
        title: `Ritmo real: ${average.toFixed(1)} por día frente a ${settings.postsPerDay}`,
        explanation: `En los últimos ${plural(observedDays, 'día', 'días')} registraste ${plural(observed.length, 'ocasión', 'ocasiones')} en el historial. ${plural(belowDays.length, 'día quedó', 'días quedaron')} por debajo del objetivo.`,
        evidence: belowDays.slice(-5).map((key) => `${dayLabel(key)}: ${perDay.get(key) ?? 0} de ${settings.postsPerDay}`),
      })
    }
  }

  // 4. Enabled categories used less than their target in the balance window.
  const enabled = categories.filter((item) => item.enabled)
  if (recent.length >= 3 && enabled.length > 1) {
    for (const category of enabled) {
      const target = category.targetShare ?? 1 / enabled.length
      const uses = recent.filter((item) => item.categoryId === category.id).length
      const share = uses / recent.length
      const eligible = activePublications.filter((item) => item.category_id === category.id && item.status !== 'archived')
      if (!eligible.length || target - share < 0.1) continue
      const lastKey = occasions.find((item) => item.categoryId === category.id)?.dayKey
      result.push({
        key: `category-gap:${category.id}:${todayKey}`,
        kind: 'category-gap',
        priority: 60 + Math.round((target - share) * 20),
        title: `${category.name} está por debajo de su objetivo`,
        explanation: `En ${plural(windowDays, 'día', 'días')} representa ${percent(share)} de tus usos (${uses} de ${recent.length}); el objetivo es ${percent(target)}.`,
        evidence: [
          lastKey ? `Último uso: ${dayLabel(lastKey)} (hace ${plural(daysBetweenKeys(lastKey, todayKey), 'día', 'días')})` : 'Sin usos registrados en el historial',
          `${plural(eligible.length, 'publicación disponible', 'publicaciones disponibles')} en esta categoría`,
        ],
      })
    }
  }

  // 5. Content repeated more than twice in the balance window.
  const recentByPublication = new Map<string, number>()
  for (const item of recent) recentByPublication.set(item.publicationId, (recentByPublication.get(item.publicationId) ?? 0) + 1)
  for (const [publicationId, count] of [...recentByPublication.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    const title = publicationById.get(publicationId)?.title ?? recent.find((item) => item.publicationId === publicationId)?.title ?? 'Publicación'
    result.push({
      key: `overused:${publicationId}:${todayKey}`,
      kind: 'overused',
      priority: 55,
      title: `“${title}” se repitió ${count} veces`,
      explanation: `Se usó ${count} veces en los últimos ${plural(windowDays, 'día', 'días')}. Alterna con otro contenido para no saturar a tu audiencia.`,
      evidence: recent.filter((item) => item.publicationId === publicationId).slice(0, 4).map((item) => `${dayLabel(item.dayKey)} · ${item.platforms.join(', ')}`),
      publicationId,
    })
  }

  // 6. Proven content that has rested long enough to reuse.
  const restDays = Math.max(settings.minimumRepeatDays * 2, 30)
  const rested = activePublications
    .filter((item) => lastUse.has(item.id) && !plannedPublicationIds.has(item.id) && daysBetweenKeys(lastUse.get(item.id)!, todayKey) >= restDays)
    .sort((a, b) => (useCount.get(b.id) ?? 0) - (useCount.get(a.id) ?? 0) || lastUse.get(a.id)!.localeCompare(lastUse.get(b.id)!))
    .slice(0, 3)
  for (const item of rested) {
    const lastKey = lastUse.get(item.id)!
    result.push({
      key: `rested:${item.id}:${lastKey}`,
      kind: 'rested',
      priority: 40,
      title: `Reutilizar “${item.title}”`,
      explanation: `Se usó ${plural(useCount.get(item.id) ?? 0, 'vez', 'veces')} y lleva ${plural(daysBetweenKeys(lastKey, todayKey), 'día', 'días')} sin publicarse, más que tu descanso de ${settings.minimumRepeatDays}.`,
      evidence: [`Último uso: ${dayLabel(lastKey)}`, 'No tiene programaciones pendientes'],
      publicationId: item.id,
    })
  }

  // 7. Drafts that were never used nor planned.
  const staleDrafts = activePublications
    .filter((item) => item.status === 'draft' && !lastUse.has(item.id) && !plannedPublicationIds.has(item.id)
      && daysBetweenKeys(dateKeyInTimezone(new Date(item.created_at), timezone), todayKey) >= 7)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, 3)
  for (const item of staleDrafts) {
    const age = daysBetweenKeys(dateKeyInTimezone(new Date(item.created_at), timezone), todayKey)
    result.push({
      key: `unused-draft:${item.id}`,
      kind: 'unused-draft',
      priority: 30,
      title: `Borrador sin usar: “${item.title}”`,
      explanation: `Lo creaste hace ${plural(age, 'día', 'días')} y no aparece en el historial ni en el calendario.`,
      evidence: ['Sin usos registrados', 'Sin programaciones'],
      publicationId: item.id,
    })
  }

  // 8. Uploaded media that no publication or history entry references.
  const historyMedia = input.historyMediaIds ?? new Set<string>()
  const unusedMedia = media.filter((item) => !item.publicationIds.length && !historyMedia.has(item.id)).sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (unusedMedia.length) {
    result.push({
      key: `unused-media:${unusedMedia.length}:${unusedMedia[unusedMedia.length - 1].id}`,
      kind: 'unused-media',
      priority: 20,
      title: `${plural(unusedMedia.length, 'archivo sin usar', 'archivos sin usar')} en la biblioteca`,
      explanation: 'No están en ninguna publicación ni en el historial. Úsalos para crear contenido nuevo.',
      evidence: unusedMedia.slice(0, 4).map((item) => item.file_name),
    })
  }

  // 9. Active or upcoming campaigns behind their target.
  for (const campaign of campaigns.filter((item) => !item.is_archived && item.ends_on >= todayKey && item.starts_on <= addDaysToKey(todayKey, 7))) {
    const campaignSlots = slots.filter((slot) => slot.campaign_id === campaign.id)
    const fulfilled = campaignSlots.filter((slot) => slot.status === 'fulfilled').length
    const planned = campaignSlots.filter((slot) => slot.status === 'planned' && new Date(slot.planned_for).getTime() >= now.getTime()).length
    const running = campaignIsActiveOn(campaign, todayKey)
    const evidence = [`${fulfilled} ${fulfilled === 1 ? 'publicada' : 'publicadas'} con registro`, `${planned} ${planned === 1 ? 'programada' : 'programadas'} por delante`, `Vigencia: ${dayLabel(campaign.starts_on)} – ${dayLabel(campaign.ends_on)}`]
    if (campaign.target_posts && fulfilled + planned < campaign.target_posts) {
      const missing = campaign.target_posts - fulfilled - planned
      result.push({
        key: `campaign:${campaign.id}:${todayKey}:${missing}`,
        kind: 'campaign',
        priority: running ? 75 : 50,
        title: `${campaign.name}: faltan ${plural(missing, 'publicación', 'publicaciones')} para la meta`,
        explanation: `La meta es ${campaign.target_posts}. ${running ? `Quedan ${plural(daysBetweenKeys(todayKey, campaign.ends_on) + 1, 'día', 'días')} de campaña.` : `Empieza en ${plural(daysBetweenKeys(todayKey, campaign.starts_on), 'día', 'días')}.`}`,
        evidence,
        campaignId: campaign.id,
      })
    } else if (!campaign.target_posts && !planned && !fulfilled) {
      result.push({
        key: `campaign:${campaign.id}:${todayKey}:empty`,
        kind: 'campaign',
        priority: running ? 65 : 45,
        title: `${campaign.name} no tiene publicaciones programadas`,
        explanation: running ? 'La campaña está vigente y todavía no tiene programaciones ni usos registrados.' : 'La campaña empieza pronto y aún no tiene programaciones.',
        evidence,
        campaignId: campaign.id,
      })
    }
  }

  return result.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))
}
