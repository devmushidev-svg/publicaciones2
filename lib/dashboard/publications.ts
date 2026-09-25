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
