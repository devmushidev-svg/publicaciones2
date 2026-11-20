import assert from 'node:assert/strict'
import test from 'node:test'
import {
  signAccess,
  validAccess,
  sameSecret,
  validApiKey,
} from '../lib/private-access.ts'

const key = 'a-private-key-with-more-than-32-characters'
const owner = '11111111-1111-4111-8111-111111111111'
test('private link cookie is bound to owner, secret and expiry', () => {
  const now = Date.now()
  const cookie = signAccess(key, owner, now)
  assert.equal(validAccess(cookie, key, owner, now), true)
  assert.equal(validAccess(cookie, key, owner, now + 31 * 86400000), false)
  assert.equal(validAccess(cookie, key, 'other', now), false)
  assert.equal(validAccess(cookie, key + 'changed', owner, now), false)
  assert.equal(validAccess(cookie + '0', key, owner, now), false)
  assert.equal(validAccess(undefined, key, owner, now), false)
})
test('bridge key cannot be replaced with a web cookie or a short secret', () => {
  const before = process.env.CATALOG_API_KEY
  try {
    process.env.CATALOG_API_KEY = key
    assert.equal(validApiKey('Bearer ' + key), true)
    assert.equal(validApiKey(key), false)
    assert.equal(validApiKey('Bearer ' + signAccess(key, owner)), false)
    process.env.CATALOG_API_KEY = 'short'
    assert.equal(validApiKey('Bearer short'), false)
  } finally {
    if (before === undefined) delete process.env.CATALOG_API_KEY
    else process.env.CATALOG_API_KEY = before
  }
  assert.equal(sameSecret('short', 'longer'), false)
})
