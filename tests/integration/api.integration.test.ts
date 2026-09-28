// End-to-end checks through Supabase Auth + PostgREST with real users, the same path the
// server actions use. Run against a disposable local stack only:
//   pnpm db:start && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=... pnpm test:integration
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_PUBLISHABLE_KEY
const skip = !url || !key ? 'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required' : false
const client = () => createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })

async function signUp(label: string) {
  const supabase = client()
  const email = `${label}-${randomUUID()}@example.test`
  const { data, error } = await supabase.auth.signUp({ email, password: `Pw-${randomUUID()}`, options: { data: { full_name: label } } })
  assert.ifError(error)
  assert.ok(data.session, 'local auth must auto-confirm email signups')
  return { supabase, id: data.user!.id }
}

function localDay(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

async function publication(supabase: SupabaseClient, title: string, categoryId: string | null = null) {
  const { data, error } = await supabase.rpc('save_my_publication', {
    p_id: null, p_title: title, p_body: `${title} body`, p_category_id: categoryId, p_status: 'draft',
    p_scheduled_for: null, p_published_at: null, p_platforms: ['instagram', 'facebook'], p_media_ids: [], p_tag_ids: [],
  })
  assert.ifError(error)
  return data as string
}

test('phases 5-9 work end to end with user isolation', { skip }, async (t) => {
  const a = await signUp('owner-a')
  const b = await signUp('owner-b')
  const anon = client()

  await t.test('profiles and settings: timezone change is honored', async () => {
    const { error } = await a.supabase.rpc('update_my_settings', { p_full_name: 'Owner A', p_timezone: 'America/New_York', p_week_starts_on: 1, p_email_digest: true })
    assert.ifError(error)
    const { data } = await a.supabase.from('account_preferences').select('timezone').single()
    assert.equal(data?.timezone, 'America/New_York')
  })

  const { data: category, error: categoryError } = await a.supabase.from('categories').insert({ user_id: a.id, name: 'Comunidad' }).select('id').single()
  assert.ifError(categoryError)
  const promo = await publication(a.supabase, 'Promo', category!.id)
  const catalog = await publication(a.supabase, 'Catálogo')

  await t.test('phase 5: history write, retry, conflict, isolation', async () => {
    const idempotencyKey = randomUUID()
    const payload = { p_publication_id: promo, p_idempotency_key: idempotencyKey, p_platforms: ['instagram', 'facebook'], p_published_at: new Date(Date.now() - 3_600_000).toISOString(), p_copy: 'Copy real', p_notes: '' }
    const first = await a.supabase.rpc('record_my_publication_use', payload)
    assert.ifError(first.error)
    assert.equal(first.data, 2)
    const retry = await a.supabase.rpc('record_my_publication_use', payload)
    assert.ifError(retry.error)
    assert.equal(retry.data, 0, 'retry inserts nothing')
    const changed = await a.supabase.rpc('record_my_publication_use', { ...payload, p_copy: 'Otro texto' })
    assert.equal(changed.error?.code, '22023')
    const future = await a.supabase.rpc('record_my_publication_use', { ...payload, p_idempotency_key: randomUUID(), p_published_at: new Date(Date.now() + 86_400_000).toISOString() })
    assert.equal(future.error?.code, '22023')

    const own = await a.supabase.from('publication_history').select('platform,category_snapshot').eq('idempotency_key', idempotencyKey)
    assert.equal(own.data?.length, 2)
    assert.equal(own.data?.[0].category_snapshot, 'Comunidad')
    const other = await b.supabase.from('publication_history').select('id')
    assert.deepEqual(other.data, [])
    const foreign = await b.supabase.rpc('record_my_publication_use', { ...payload, p_idempotency_key: randomUUID() })
    assert.equal(foreign.error?.code, 'P0002')
    const anonymous = await anon.rpc('record_my_publication_use', { ...payload, p_idempotency_key: randomUUID() })
    assert.ok(anonymous.error, 'anonymous calls are rejected')
    const direct = await a.supabase.from('publication_history').insert({ user_id: a.id, publication_id: catalog, idempotency_key: randomUUID(), platform: 'x', published_at: new Date().toISOString(), title_snapshot: 'x' })
    assert.ok(direct.error, 'history cannot be written directly')
    const published = await a.supabase.from('publications').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', catalog)
    assert.equal(published.error?.code, '23514', 'cannot mark published without history')
  })

  await t.test('phase 6: preferences through PostgREST with JSON numbers', async () => {
    const saved = await a.supabase.rpc('save_my_recommendation_settings', {
      p_posts_per_day: 3, p_minimum_repeat_days: 14, p_balance_window_days: 21,
      p_categories: [{ category_id: category!.id, target_share: 0.4, priority: 4, is_enabled: true }],
    })
    assert.ifError(saved.error)
    const settings = await a.supabase.from('recommendation_settings').select('balance_window_days').single()
    assert.equal(settings.data?.balance_window_days, 21)
    const leak = await b.supabase.from('category_preferences').select('category_id')
    assert.deepEqual(leak.data, [])
    const crossOwner = await b.supabase.rpc('save_my_recommendation_settings', {
      p_posts_per_day: 3, p_minimum_repeat_days: 14, p_balance_window_days: 14,
      p_categories: [{ category_id: category!.id, target_share: 0.5, priority: 2, is_enabled: true }],
    })
    assert.ok(crossOwner.error, 'another account cannot attach preferences to A category')
  })

  await t.test('phase 7: generation quota, draft idempotency and isolation', async () => {
    const start = await a.supabase.rpc('start_my_ai_copy_generation', { p_brief: 'Promoción de temporada con envío gratis', p_platforms: ['instagram', 'whatsapp'], p_model: 'test' })
    assert.ifError(start.error)
    const generationId = start.data[0].generation_id as string
    const variants = ['A', 'B', 'C'].map((angle) => ({ angle, headline: `Título ${angle}`, body: 'Texto', callToAction: 'Escríbenos' }))
    const finish = await a.supabase.rpc('finish_my_ai_copy_generation', { p_generation_id: generationId, p_status: 'succeeded', p_variants: variants, p_failure_code: null, p_input_tokens: 10, p_output_tokens: 20 })
    assert.ifError(finish.error)
    const first = await a.supabase.rpc('save_my_ai_copy_draft', { p_generation_id: generationId, p_title: 'Título A', p_body: 'Texto editado' })
    const second = await a.supabase.rpc('save_my_ai_copy_draft', { p_generation_id: generationId, p_title: 'Título A', p_body: 'Texto editado' })
    assert.ifError(first.error)
    assert.equal(first.data, second.data, 'double submit returns the same draft')
    const stolen = await b.supabase.rpc('save_my_ai_copy_draft', { p_generation_id: generationId, p_title: 'x', p_body: 'y' })
    assert.equal(stolen.error?.code, 'P0002')

    for (let index = 1; index < 30; index += 1) {
      const next = await a.supabase.rpc('start_my_ai_copy_generation', { p_brief: `Brief número ${index} con detalle`, p_platforms: ['facebook'], p_model: 'test' })
      assert.ifError(next.error)
    }
    const overLimit = await a.supabase.rpc('start_my_ai_copy_generation', { p_brief: 'Uno más de la cuenta', p_platforms: ['facebook'], p_model: 'test' })
    assert.equal(overLimit.error?.code, '54000')
    const otherQuota = await b.supabase.rpc('start_my_ai_copy_generation', { p_brief: 'La cuota de B es independiente', p_platforms: ['facebook'], p_model: 'test' })
    assert.ifError(otherQuota.error)
    assert.equal(otherQuota.data[0].used, 1)
    const anonymous = await anon.rpc('start_my_ai_copy_generation', { p_brief: 'Sin sesión no se genera', p_platforms: ['facebook'], p_model: 'test' })
    assert.ok(anonymous.error)
  })

  await t.test('phase 8: campaigns and schedule create, retry, move, cancel, fulfil', async () => {
    const zone = 'America/New_York'
    const today = localDay(new Date(), zone)
    const addDays = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
    const campaign = await a.supabase.rpc('save_my_campaign', { p_id: null, p_name: 'Temporada', p_goal: 'Vender', p_color: '#336699', p_starts_on: addDays(today, 1), p_ends_on: addDays(today, 3), p_target_posts: 4 })
    assert.ifError(campaign.error)

    // 03:30 UTC on day+2 is still day+1 in New York (UTC-4/-5): inside the campaign.
    const lateDay1 = new Date(`${addDays(today, 2)}T03:30:00Z`).toISOString()
    const slotId = randomUUID()
    const request = { p_id: slotId, p_publication_id: catalog, p_planned_for: lateDay1, p_platforms: ['instagram'], p_campaign_id: campaign.data, p_notes: '' }
    assert.ifError((await a.supabase.rpc('schedule_my_publication', request)).error)
    assert.ifError((await a.supabase.rpc('schedule_my_publication', request)).error)
    const count = await a.supabase.from('scheduled_posts').select('id', { count: 'exact', head: true })
    assert.equal(count.count, 1)
    const sameDay = await a.supabase.rpc('schedule_my_publication', { ...request, p_id: randomUUID(), p_planned_for: new Date(`${addDays(today, 1)}T20:00:00Z`).toISOString() })
    assert.equal(sameDay.error?.code, '23505')
    const outside = await a.supabase.rpc('reschedule_my_post', { p_id: slotId, p_planned_for: new Date(`${addDays(today, 9)}T15:00:00Z`).toISOString(), p_campaign_id: campaign.data })
    assert.equal(outside.error?.code, '22023')
    assert.ifError((await a.supabase.rpc('reschedule_my_post', { p_id: slotId, p_planned_for: new Date(`${addDays(today, 2)}T15:00:00Z`).toISOString(), p_campaign_id: campaign.data })).error)

    const embed = await a.supabase.from('scheduled_posts').select('id,publications(title,categories(name))').eq('id', slotId).single()
    assert.ifError(embed.error)
    assert.equal((embed.data.publications as unknown as { title: string }).title, 'Catálogo')

    assert.deepEqual((await b.supabase.from('scheduled_posts').select('id')).data, [])
    assert.deepEqual((await b.supabase.from('campaigns').select('id')).data, [])
    assert.equal((await b.supabase.rpc('cancel_my_scheduled_post', { p_id: slotId })).error?.code, 'P0002')
    assert.ok((await anon.rpc('schedule_my_publication', { ...request, p_id: randomUUID() })).error)
    assert.ok((await a.supabase.from('scheduled_posts').insert({ id: randomUUID(), user_id: a.id, publication_id: catalog, planned_for: lateDay1 })).error, 'slots cannot be inserted directly')

    const historyBefore = await a.supabase.from('publication_history').select('id', { count: 'exact', head: true })
    const cancelId = randomUUID()
    assert.ifError((await a.supabase.rpc('schedule_my_publication', { ...request, p_id: cancelId, p_planned_for: new Date(`${addDays(today, 3)}T15:00:00Z`).toISOString() })).error)
    assert.ifError((await a.supabase.rpc('cancel_my_scheduled_post', { p_id: cancelId })).error)
    assert.ifError((await a.supabase.rpc('cancel_my_scheduled_post', { p_id: cancelId })).error)
    const historyAfter = await a.supabase.from('publication_history').select('id', { count: 'exact', head: true })
    assert.equal(historyAfter.count, historyBefore.count, 'scheduling and cancelling never write history')

    const useKey = randomUUID()
    const use = { p_id: slotId, p_idempotency_key: useKey, p_platforms: ['instagram'], p_published_at: new Date(Date.now() - 60_000).toISOString(), p_copy: 'Real', p_notes: '' }
    assert.ifError((await a.supabase.rpc('record_my_scheduled_post_use', use)).error)
    assert.ifError((await a.supabase.rpc('record_my_scheduled_post_use', use)).error)
    const slot = await a.supabase.from('scheduled_posts').select('status,history_idempotency_key').eq('id', slotId).single()
    assert.deepEqual(slot.data, { status: 'fulfilled', history_idempotency_key: useKey })
    assert.equal((await a.supabase.rpc('record_my_scheduled_post_use', { ...use, p_idempotency_key: randomUUID() })).error?.code, '55000')
  })

  await t.test('phase 9: idea conversion and opportunity ideas are idempotent and isolated', async () => {
    const { data: idea, error } = await a.supabase.from('ideas').insert({ user_id: a.id, title: 'Video de temporada', notes: 'Guion corto' }).select('id').single()
    assert.ifError(error)
    const first = await a.supabase.rpc('convert_my_idea_to_draft', { p_idea_id: idea!.id })
    const second = await a.supabase.rpc('convert_my_idea_to_draft', { p_idea_id: idea!.id })
    assert.ifError(first.error)
    assert.equal(first.data, second.data)
    assert.equal((await b.supabase.rpc('convert_my_idea_to_draft', { p_idea_id: idea!.id })).error?.code, 'P0002')
    const opportunity = { p_source_key: 'category-gap:test', p_title: 'Retomar Comunidad', p_notes: 'Sin usos', p_campaign_id: null }
    const o1 = await a.supabase.rpc('save_my_opportunity_idea', opportunity)
    const o2 = await a.supabase.rpc('save_my_opportunity_idea', opportunity)
    assert.ifError(o1.error)
    assert.equal(o1.data, o2.data)
    const bIdea = await b.supabase.rpc('save_my_opportunity_idea', opportunity)
    assert.ifError(bIdea.error)
    assert.notEqual(bIdea.data, o1.data, 'source keys are scoped per account')
    const spoof = await a.supabase.from('ideas').update({ publication_id: null }).eq('id', idea!.id)
    assert.ok(spoof.error, 'link columns are not directly writable')
  })
})
