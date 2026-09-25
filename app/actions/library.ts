'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PublicationActionState } from '@/lib/dashboard/publications'

function formValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim()
}

export async function linkMediaToPublication(
  _previous: PublicationActionState,
  formData: FormData,
): Promise<PublicationActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const mediaAssetId = formValue(formData, 'media_asset_id')
  const publicationId = formValue(formData, 'publication_id')
  if (!mediaAssetId || !publicationId) return { error: 'Selecciona una publicación.' }

  const [asset, publication] = await Promise.all([
    supabase.from('media_assets').select('id').eq('id', mediaAssetId).eq('user_id', user.id).maybeSingle(),
    supabase.from('publications').select('id').eq('id', publicationId).eq('user_id', user.id).maybeSingle(),
  ])
  if (asset.error || !asset.data || publication.error || !publication.data) {
    return { error: 'No se pudo validar el medio o la publicación.' }
  }

  const { data: lastLink, error: orderError } = await supabase
    .from('publication_media')
    .select('sort_order')
    .eq('publication_id', publicationId)
    .eq('user_id', user.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (orderError) return { error: 'No se pudo ordenar el archivo.' }

  const { error } = await supabase.from('publication_media').upsert(
    { publication_id: publicationId, media_asset_id: mediaAssetId, user_id: user.id, sort_order: (lastLink?.sort_order ?? -1) + 1 },
    { onConflict: 'publication_id,media_asset_id', ignoreDuplicates: true },
  )
  if (error) return { error: 'No se pudo vincular el medio.' }

  revalidatePath('/')
  return { success: 'Medio vinculado.' }
}

export async function unlinkMediaFromPublication(
  _previous: PublicationActionState,
  formData: FormData,
): Promise<PublicationActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció. Inicia sesión nuevamente.' }

  const mediaAssetId = formValue(formData, 'media_asset_id')
  const publicationId = formValue(formData, 'publication_id')
  if (!mediaAssetId || !publicationId) return { error: 'No encontramos el vínculo.' }

  const { error } = await supabase
    .from('publication_media')
    .delete()
    .eq('publication_id', publicationId)
    .eq('media_asset_id', mediaAssetId)
    .eq('user_id', user.id)
  if (error) return { error: 'No se pudo desvincular el medio.' }

  revalidatePath('/')
  return { success: 'Medio desvinculado.' }
}
