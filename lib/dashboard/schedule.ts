export type ScheduledPostStatus = 'planned' | 'cancelled' | 'fulfilled'

export type ScheduledPostRecord = {
  id: string
  publication_id: string
  campaign_id: string | null
  planned_for: string
  platforms: string[]
  notes: string
  status: ScheduledPostStatus
  history_idempotency_key: string | null
  fulfilled_at: string | null
  cancelled_at: string | null
  created_at: string
}

export type CampaignRecord = {
  id: string
  name: string
  goal: string
  color: string
  starts_on: string
  ends_on: string
  target_posts: number | null
  is_archived: boolean
  created_at: string
}

/** One history row per platform; occasions are grouped by idempotency_key. */
export type HistoryLiteRecord = {
  idempotency_key: string
  publication_id: string
  platform: string
  published_at: string
  title_snapshot: string
  category_snapshot: string | null
}

export type ScheduleActionState = { error?: string; success?: string }

/** Minutes after the planned time before an unrecorded slot is shown as pending confirmation. */
export const overdueGraceMinutes = 60

export function isOverdue(slot: Pick<ScheduledPostRecord, 'status' | 'planned_for'>, now = new Date()) {
  return slot.status === 'planned' && new Date(slot.planned_for).getTime() < now.getTime() - overdueGraceMinutes * 60_000
}

export function campaignIsActiveOn(campaign: Pick<CampaignRecord, 'starts_on' | 'ends_on' | 'is_archived'>, dayKey: string) {
  return !campaign.is_archived && campaign.starts_on <= dayKey && dayKey <= campaign.ends_on
}
