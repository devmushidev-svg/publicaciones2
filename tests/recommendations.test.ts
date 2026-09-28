import assert from 'node:assert/strict'
import test from 'node:test'
import { recommendDailyContent, type RecommendationCandidate } from '../lib/recommendations/scorer.ts'

const now = new Date('2026-09-25T12:00:00.000Z')
const settings = { postsPerDay: 3, minimumRepeatDays: 14, balanceWindowDays: 14 }
const categories = [
  { id: 'a', name: 'Comunidad', priority: 3, targetShare: 0.5, enabled: true, recentUses: 4 },
  { id: 'b', name: 'Producto', priority: 3, targetShare: 0.5, enabled: true, recentUses: 0 },
]
const candidate = (overrides: Partial<RecommendationCandidate>): RecommendationCandidate => ({
  id: '1', title: 'Post', categoryId: 'a', tagIds: [], createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: null, scheduledToday: false, ...overrides,
})

test('recommends deterministically and favors an underrepresented category', () => {
  const input = [candidate({ id: 'a1' }), candidate({ id: 'b1', categoryId: 'b' }), candidate({ id: 'b2', categoryId: 'b' })]
  const first = recommendDailyContent(input, categories, settings, now)
  const second = recommendDailyContent(input, categories, settings, now)
  assert.deepEqual(first.map(({ id }) => id), second.map(({ id }) => id))
  assert.equal(first[0].categoryId, 'b')
  assert.ok(first.every(({ reason }) => reason.length > 0))
})

test('excludes recent, disabled-category, and already-scheduled candidates', () => {
  const input = [
    candidate({ id: 'recent', lastUsedAt: '2026-09-20T00:00:00.000Z' }),
    candidate({ id: 'scheduled', scheduledToday: true }),
    candidate({ id: 'disabled', categoryId: 'off' }),
    candidate({ id: 'ok', categoryId: 'b' }),
  ]
  assert.deepEqual(recommendDailyContent(input, [...categories, { id: 'off', name: 'Oculta', priority: 5, targetShare: null, enabled: false, recentUses: 0 }], settings, now).map(({ id }) => id), ['ok'])
})

test('favors newer eligible drafts when category signals are otherwise equal', () => {
  const input = [
    candidate({ id: 'old', categoryId: null, createdAt: '2026-01-01T00:00:00.000Z' }),
    candidate({ id: 'new', categoryId: null, createdAt: '2026-09-24T00:00:00.000Z' }),
  ]
  assert.equal(recommendDailyContent(input, [], { ...settings, postsPerDay: 1 }, now)[0].id, 'new')
})
