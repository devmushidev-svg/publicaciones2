export type MediaAssetRecord = {
  id: string
  storage_path: string
  file_name: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
  alt_text: string | null
  content_sha256: string | null
  created_at: string
  signed_url: string | null
  publicationIds: string[]
}
