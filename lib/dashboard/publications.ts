export type PublicationStatus = 'draft' | 'scheduled' | 'published' | 'archived'

export type PublicationRecord = {
  id: string
  title: string
  body: string
  category: string | null
  category_id: string | null
  status: PublicationStatus
  scheduled_for: string | null
  published_at: string | null
  platforms: string[]
  mediaAssetIds: string[]
  tagIds: string[]
  created_at: string
}

export type PublicationHistoryMedia = {
  id: string
  storage_path: string
  file_name: string
  mime_type: string
  alt_text: string | null
  signed_url?: string | null
}

export type PublicationHistoryRecord = {
  id: string
  publication_id: string
  idempotency_key: string
  platform: string
  published_at: string
  title_snapshot: string
  copy_snapshot: string
  category_snapshot: string | null
  tags_snapshot: string[]
  media_snapshot: PublicationHistoryMedia[]
  notes: string
}

export const publicationHistoryPageSize = 50

export type PublicationActionState = {
  error?: string
  success?: string
}

export const publicationPlatforms = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'x', label: 'X' },
] as const
