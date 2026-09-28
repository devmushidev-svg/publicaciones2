import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeActivity, groupOccasions } from '../lib/insights/activity.ts'
import { findOpportunities } from '../lib/insights/opportunities.ts'
import type { CampaignRecord, HistoryLiteRecord, ScheduledPostRecord } from '../lib/dashboard/schedule.ts'
import { isOverdue } from '../lib/dashboard/schedule.ts'

const timezone = 'America/Tegucigalpa'
// 2026-09-28 18:00 UTC = 12:00 in Tegucigalpa.
const now = new Date('2026-09-28T18:00:00.000Z')
const categories = [
  { id: 'c1', name: 'Comunidad', targetShare: 0.5, enabled: true },
  { id: 'c2', name: 'Producto', targetShare: 0.5, enabled: true },
]
const publications = [
  { id: 'p1', title: 'Promo', status: 'published', category_id: 'c1', created_at: '2026-06-01T00:00:00.000Z' },
  { id: 'p2', title: 'Catálogo', status: 'draft', category_id: 'c2', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'p3', title: 'Antigua', status: 'published', category_id: 'c2', created_at: '2026-05-01T00:00:00.000Z' },
]
const row = (key: string, publicationId: string, publishedAt: string, platform = 'instagram', category: string | null = 'Comunidad'): HistoryLiteRecord => ({
  idempotency_key: key, publication_id: publicationId, platform, published_at: publishedAt, title_snapshot: publicationId, category_snapshot: category,
})
const slot = (overrides: Partial<ScheduledPostRecord>): ScheduledPostRecord => ({
  id: 's', publication_id: 'p1', campaign_id: null, planned_for: '2026-09-29T15:00:00.000Z', platforms: ['instagram'], notes: '',
  status: 'planned', history_idempotency_key: null, fulfilled_at: null, cancelled_at: null, created_at: '2026-09-01T00:00:00.000Z', ...overrides,
})

test('groups per-platform history rows into one occasion each', () => {
  const occasions = groupOccasions([
    row('k1', 'p1', '2026-09-27T15:00:00.000Z', 'instagram'),
    row('k1', 'p1', '2026-09-27T15:00:00.000Z', 'facebook'),
    row('k2', 'p1', '2026-09-26T15:00:00.000Z'),
  ], publications, categories, timezone)
  assert.equal(occasions.length, 2)
  assert.deepEqual(occasions[0].platforms, ['instagram', 'facebook'])
})

test('activity uses the account timezone to assign days', () => {
  // 03:00 UTC on the 28th is 21:00 on the 27th in Tegucigalpa.
  const summary = summarizeActivity({
    history: [row('k1', 'p1', '2026-09-28T03:00:00.000Z'), row('k1', 'p1', '2026-09-28T03:00:00.000Z', 'facebook'), row('k2', 'p3', '2026-09-28T16:00:00.000Z', 'x', 'Producto')],
    slots: [],
    publications, categories, postsPerDay: 1, timezone, periodDays: 7, now,
  })
  assert.equal(summary.occasions, 2)
  assert.equal(summary.platformPosts, 3)
  assert.deepEqual(summary.perDay.slice(-2), [{ date: '2026-09-27', occasions: 1 }, { date: '2026-09-28', occasions: 1 }])
  assert.equal(summary.byHour[21], 1)
  assert.equal(summary.byHour[10], 1)
  assert.equal(summary.daysMeetingTarget, 2)
  assert.deepEqual(summary.byCategory.map(({ id, occasions }) => [id, occasions]), [['c1', 1], ['c2', 1]])
})

test('plan adherence separates fulfilled, cancelled, pending and upcoming intentions', () => {
  const summary = summarizeActivity({
    history: [row('k1', 'p1', '2026-09-27T16:00:00.000Z')],
    slots: [
      slot({ id: 'a', planned_for: '2026-09-27T15:00:00.000Z', status: 'fulfilled', history_idempotency_key: 'k1', fulfilled_at: '2026-09-27T16:00:00.000Z' }),
      slot({ id: 'b', planned_for: '2026-09-26T15:00:00.000Z', status: 'cancelled', cancelled_at: '2026-09-26T10:00:00.000Z' }),
      slot({ id: 'c', planned_for: '2026-09-25T15:00:00.000Z' }),
      slot({ id: 'd', planned_for: '2026-09-30T15:00:00.000Z' }),
      slot({ id: 'e', planned_for: '2026-10-02T15:00:00.000Z', status: 'fulfilled', history_idempotency_key: 'k9', fulfilled_at: '2026-09-28T16:00:00.000Z' }),
    ],
    publications, categories, postsPerDay: 3, timezone, periodDays: 7, now,
  })
  // 'e' was fulfilled early: it counts as fulfilled in the period, not as upcoming.
  assert.deepEqual(summary.plan, { due: 4, fulfilled: 2, fulfilledSameDay: 1, cancelled: 1, pending: 1, upcoming: 1 })
})

test('a planned slot is overdue only after the grace period', () => {
  assert.equal(isOverdue(slot({ planned_for: '2026-09-28T17:30:00.000Z' }), now), false)
  assert.equal(isOverdue(slot({ planned_for: '2026-09-28T16:30:00.000Z' }), now), true)
  assert.equal(isOverdue(slot({ planned_for: '2026-09-28T16:30:00.000Z', status: 'cancelled' }), now), false)
})

test('opportunities are explained with history data and never invent metrics', () => {
  const history = [
    row('k1', 'p1', '2026-09-27T15:00:00.000Z'),
    row('k2', 'p1', '2026-09-26T15:00:00.000Z'),
    row('k3', 'p1', '2026-09-25T15:00:00.000Z'),
    row('k4', 'p3', '2026-07-01T15:00:00.000Z', 'instagram', 'Producto'),
  ]
  const campaign: CampaignRecord = { id: 'camp', name: 'Temporada', goal: '', color: '#336699', starts_on: '2026-09-27', ends_on: '2026-10-05', target_posts: 6, is_archived: false, created_at: '2026-09-01T00:00:00.000Z' }
  const result = findOpportunities({
    now, timezone,
    settings: { postsPerDay: 3, minimumRepeatDays: 14, balanceWindowDays: 14 },
    categories, publications, history,
    slots: [slot({ id: 'late', planned_for: '2026-09-27T15:00:00.000Z', campaign_id: 'camp' }), slot({ id: 'next', planned_for: '2026-09-29T15:00:00.000Z', campaign_id: 'camp' })],
    campaigns: [campaign],
    media: [{ id: 'm1', file_name: 'foto.jpg', created_at: '2026-09-01T00:00:00.000Z', publicationIds: [] }],
  })
  const kinds = result.map((item) => item.kind)
  assert.equal(kinds[0], 'pending')
  for (const kind of ['coverage', 'cadence', 'category-gap', 'overused', 'rested', 'unused-draft', 'unused-media', 'campaign']) assert.ok(kinds.includes(kind as never), kind)
  const gap = result.find((item) => item.kind === 'category-gap')!
  assert.match(gap.title, /Producto/)
  assert.match(gap.explanation, /0% de tus usos \(0 de 3\).*50%/)
  const overused = result.find((item) => item.kind === 'overused')!
  assert.match(overused.explanation, /3 veces/)
  const rested = result.find((item) => item.kind === 'rested')!
  assert.equal(rested.publicationId, 'p3')
  const campaignItem = result.find((item) => item.kind === 'campaign')!
  assert.match(campaignItem.title, /faltan 5 publicaciones/)
  assert.ok(result.every((item) => item.explanation && !/alcance|impresiones|clics/i.test(item.explanation)))
  assert.ok(new Set(result.map((item) => item.key)).size === result.length)
})

test('no opportunities about cadence or balance without history', () => {
  const result = findOpportunities({
    now, timezone,
    settings: { postsPerDay: 3, minimumRepeatDays: 14, balanceWindowDays: 14 },
    categories, publications: [], history: [], slots: [], campaigns: [], media: [],
  })
  assert.deepEqual(result, [])
})

test('weekly coverage counts uses already recorded today', () => {
  const settings = { postsPerDay: 1, minimumRepeatDays: 14, balanceWindowDays: 14 }
  const base = { now, timezone, settings, categories, publications, campaigns: [], media: [] }
  const tomorrowOnwards = Array.from({ length: 6 }, (_, index) => slot({ id: `s${index}`, publication_id: `p${index}`, planned_for: new Date(Date.parse('2026-09-29T15:00:00.000Z') + index * 86_400_000).toISOString() }))
  const withoutUse = findOpportunities({ ...base, history: [], slots: tomorrowOnwards })
  assert.match(withoutUse.find((item) => item.kind === 'coverage')?.evidence[0] ?? '', /0 de 1/)
  const withUse = findOpportunities({ ...base, history: [row('today', 'p1', '2026-09-28T16:00:00.000Z')], slots: tomorrowOnwards })
  assert.equal(withUse.find((item) => item.kind === 'coverage'), undefined)
})
