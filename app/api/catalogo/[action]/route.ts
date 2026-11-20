import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createOwnerClient } from '@/lib/supabase/owner'
import { validApiKey, privateConfig } from '@/lib/private-access'
import { inspectMediaFile } from '@/lib/media-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
}
const uuid = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error('ID inválido.')
  return value
}
const defaultCategories: Array<[string, string | null, boolean]> = [
  ['Visa americana', null, false],
  ['Reparación de taller', null, false],
  ['Computadoras', 'Reparación de taller', false],
  ['Impresoras', 'Reparación de taller', false],
  ['Útiles de oficina', null, false],
  ['Útiles escolares', null, false],
  ['Suministros de arreglos florales', null, false],
  ['Papelería', null, false],
  ['Servicios secretariales', null, false],
  ['Diseños de flores', null, true],
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  if (!validApiKey(request.headers.get('authorization')))
    return NextResponse.json(
      { error: 'No autorizado.' },
      { status: 401, headers },
    )
  try {
    const { action } = await params
    const supabase = await createOwnerClient()
    const { ownerId } = privateConfig()
    // PostgREST entrega páginas; recorrerlas evita truncar el catálogo cuando crezca.
    async function all(table: string, select = '*') {
      const rows: Record<string, unknown>[] = []
      for (let from = 0; from < 100000; from += 500) {
        let query = supabase.from(table).select(select).eq('user_id', ownerId)
        query =
          table === 'publication_media'
            ? query.order('publication_id').order('media_asset_id')
            : query.order('id')
        const { data, error } = await query.range(from, from + 499)
        if (error)
          throw new Error(
            'No se pudo leer el catálogo. Comprobá sus migraciones.',
          )
        rows.push(...(data as unknown as Record<string, unknown>[]))
        if (!data || data.length < 500) return rows
      }
      throw new Error(
        'El catálogo superó el límite de lectura; usá filtros antes de continuar.',
      )
    }
    if (action === 'subir') {
      const form = await request.formData()
      const file = form.get('foto')
      if (!(file instanceof File)) throw new Error('Adjuntá una imagen.')
      const { mimeType, extension, hash } = await inspectMediaFile(file)
      if (!mimeType.startsWith('image/'))
        throw new Error('El catálogo de Facebook admite imágenes.')
      const existing = await supabase
        .from('media_assets')
        .select('id')
        .eq('user_id', ownerId)
        .eq('content_sha256', hash)
        .maybeSingle()
      if (existing.error) throw new Error('No se pudo revisar el archivo.')
      if (existing.data)
        return NextResponse.json({ id: existing.data.id }, { headers })
      const path = `${ownerId}/${hash}.${extension}`
      const upload = await supabase.storage
        .from('publication-media')
        .upload(path, file, { contentType: mimeType, upsert: false })
      if (upload.error && upload.error.statusCode !== '409')
        throw new Error('No se pudo guardar la foto.')
      const saved = await supabase
        .from('media_assets')
        .insert({
          user_id: ownerId,
          storage_path: path,
          file_name: file.name.slice(0, 255),
          mime_type: mimeType,
          byte_size: file.size,
          content_sha256: hash,
        })
        .select('id')
        .single()
      if (saved.error) {
        const retry = await supabase
          .from('media_assets')
          .select('id')
          .eq('user_id', ownerId)
          .eq('content_sha256', hash)
          .maybeSingle()
        if (retry.data)
          return NextResponse.json({ id: retry.data.id }, { headers })
        throw new Error('No se pudo guardar la ficha de la foto.')
      }
      return NextResponse.json({ id: saved.data.id }, { headers })
    }
    if (!request.headers.get('content-type')?.includes('application/json'))
      throw new Error('Se requiere JSON.')
    const input = await request.json()
    let result: unknown
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(name, args)
      if (error)
        throw new Error(
          `No se pudo completar ${name}. ${['22023', 'P0002', '23505', '55000'].includes(error.code) ? error.message : 'Revisá la migración del catálogo.'}`,
        )
      return data
    }
    if (action === 'listar') {
      const [
        categories,
        publications,
        media,
        links,
        history,
        scheduled,
        settings,
      ] = await Promise.all([
        all('categories'),
        all('publications'),
        all('media_assets'),
        all('publication_media'),
        all('publication_history', 'id,publication_id,published_at'),
        all('scheduled_posts'),
        supabase
          .from('recommendation_settings')
          .select('minimum_repeat_days')
          .eq('user_id', ownerId)
          .maybeSingle(),
      ])
      if (settings.error)
        throw new Error('No se pudieron cargar las reglas de reutilización.')
      const mediaById = new Map(media.map((m) => [m.id, m]))
      const linksByPublication = new Map<unknown, Record<string, unknown>[]>()
      for (const link of links) {
        const group = linksByPublication.get(link.publication_id) || []
        group.push(link)
        linksByPublication.set(link.publication_id, group)
      }
      result = {
        categories,
        publications: publications.map((p) => ({
          ...p,
          media: (linksByPublication.get(p.id) || [])
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
            .map((l) => mediaById.get(l.media_asset_id))
            .filter(Boolean),
        })),
        history,
        scheduled,
        minimum_repeat_days: settings.data?.minimum_repeat_days ?? 30,
      }
    } else if (action === 'media') {
      const row = await supabase
        .from('media_assets')
        .select('storage_path')
        .eq('id', uuid(input.id))
        .eq('user_id', ownerId)
        .single()
      if (row.error) throw new Error('La imagen no existe.')
      const signed = await supabase.storage
        .from('publication-media')
        .createSignedUrl(row.data.storage_path, 120)
      if (signed.error) throw new Error('No se pudo abrir la imagen.')
      result = {
        url: signed.data.signedUrl,
        host: new URL(signed.data.signedUrl).host,
      }
    } else if (action === 'inicializar') {
      const rows = await all('categories')
      for (const [name, parent, manual] of defaultCategories) {
        if (
          rows.some(
            (c) =>
              String(c.name).toLocaleLowerCase('es') ===
              name.toLocaleLowerCase('es'),
          )
        )
          continue
        const data = {
          id: randomUUID(),
          user_id: ownerId,
          name,
          manual_only: manual,
          parent_id: parent ? rows.find((c) => c.name === parent)?.id : null,
        }
        const { error } = await supabase.from('categories').insert(data)
        if (error) throw new Error('No se pudo crear una categoría.')
        rows.push(data)
      }
      result = { categories: rows }
    } else if (action === 'categoria') {
      const name = String(input.nombre || '').trim()
      if (!name || name.length > 80)
        throw new Error('El nombre admite de 1 a 80 caracteres.')
      let manual = input.automatica === false
      if (input.padre) {
        const parent = await supabase
          .from('categories')
          .select('manual_only')
          .eq('id', uuid(input.padre))
          .eq('user_id', ownerId)
          .single()
        if (parent.error) throw new Error('La categoría superior no existe.')
        manual ||= parent.data.manual_only
      }
      const saved = await supabase
        .from('categories')
        .insert({
          user_id: ownerId,
          name,
          parent_id: input.padre || null,
          manual_only: manual,
        })
        .select('id')
        .single()
      if (saved.error)
        throw new Error(
          'No se pudo crear la categoría; revisá si el nombre ya existe.',
        )
      result = saved.data
    } else if (action === 'guardar') {
      result = {
        id: await rpc('save_my_mcp_publication', {
          p_request_id: uuid(input.id),
          p_content: input,
        }),
      }
    } else if (action === 'editar') {
      const current = await supabase
        .from('publications')
        .select('status,published_at,platforms')
        .eq('id', uuid(input.id))
        .eq('user_id', ownerId)
        .single()
      if (current.error) throw new Error('La publicación no existe.')
      const tags = await supabase
        .from('publication_tags')
        .select('tag_id')
        .eq('publication_id', input.id)
        .eq('user_id', ownerId)
      if (tags.error) throw new Error('No se pudieron conservar las etiquetas.')
      result = {
        id: await rpc('save_my_catalogue_publication', {
          p_id: uuid(input.id),
          p_title: input.titulo,
          p_body: input.texto,
          p_category_id: uuid(input.categoria),
          p_status:
            input.activa === false
              ? 'archived'
              : current.data.status === 'archived'
                ? 'draft'
                : current.data.status,
          p_published_at:
            input.activa !== false && current.data.status === 'published'
              ? current.data.published_at
              : null,
          p_platforms: current.data.platforms || ['facebook'],
          p_media_ids: (input.imagenes || []).map(uuid),
          p_tag_ids: (tags.data || []).map((t) => t.tag_id),
          p_approved_for_batch: input.automatica === true,
          p_valid_until: input.vence || null,
          p_facebook_page: input.pagina || 'tocoa',
        }),
      }
    } else if (action === 'confirmar') {
      result = {
        count: await rpc('register_my_mcp_plan', {
          p_plan_id: uuid(input.plan_id),
          p_jobs: input.jobs,
        }),
      }
    } else if (action === 'cancelar') {
      await rpc('cancel_my_mcp_plan', {
        p_plan_id: uuid(input.plan_id),
        p_job_ids: input.ids.map(uuid),
      })
      result = { ok: true }
    } else if (action === 'slot') {
      const slot = await supabase
        .from('scheduled_posts')
        .select('id,status,planned_for,notes')
        .eq('id', uuid(input.id))
        .eq('user_id', ownerId)
        .maybeSingle()
      if (slot.error) throw new Error('No se pudo comprobar el calendario.')
      result = slot.data
    } else if (action === 'entrega') {
      await rpc('update_my_mcp_delivery', {
        p_id: uuid(input.id),
        p_state: input.estado,
        p_post_id: input.post_id || null,
      })
      result = { ok: true }
    } else if (action === 'mover') {
      await rpc('reschedule_my_post', {
        p_id: uuid(input.id),
        p_planned_for: input.fecha,
        p_campaign_id: null,
      })
      result = { ok: true }
    } else if (action === 'publicado') {
      await rpc('record_my_mcp_use', {
        p_id: uuid(input.id),
        p_published_at: input.fecha,
        p_post_id: String(input.post_id).slice(0, 100),
      })
      result = { ok: true }
    } else
      return NextResponse.json(
        { error: 'No existe.' },
        { status: 404, headers },
      )
    return NextResponse.json(result, { headers })
  } catch (error) {
    // Nunca devolver secretos ni respuestas crudas del proveedor.
    let message =
      error instanceof Error
        ? error.message
        : 'No se pudo completar la operación.'
    for (const key of [
      'SUPABASE_SECRET_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'CATALOG_API_KEY',
      'CATALOG_ACCESS_KEY',
    ]) {
      const secret = process.env[key]
      if (secret) message = message.replaceAll(secret, '[oculto]')
    }
    return NextResponse.json({ error: message }, { status: 400, headers })
  }
}
