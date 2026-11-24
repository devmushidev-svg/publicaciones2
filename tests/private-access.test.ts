import assert from 'node:assert/strict'
import test from 'node:test'
import {
  signAccess,
  validAccess,
  sameSecret,
  validApiKey,
  privateConfig,
} from '../lib/private-access.ts'
import { selectSingleOwner } from '../lib/supabase/owner-selection.ts'

const key = 'a-private-key-with-more-than-32-characters'
const owner = '11111111-1111-4111-8111-111111111111'
test('private link cookie is bound to owner, secret and expiry', () => {
  const now = Date.now()
  const cookie = signAccess(key, owner, now)
  assert.equal(validAccess(cookie, key, owner, now), true)
  assert.equal(validAccess(cookie, key, owner, now + 366 * 86400000), false)
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

test('existing MCP secret works for both access paths without an owner ID', () => {
  const names = [
    'MCP_SECRET',
    'CATALOG_ACCESS_KEY',
    'CATALOG_API_KEY',
    'CATALOG_OWNER_ID',
  ]
  const old = names.map((name) => process.env[name])
  try {
    names.forEach((name) => delete process.env[name])
    process.env.MCP_SECRET = 'existing-mcp-secret-24-chars'
    const config = privateConfig()
    assert.equal(config.key, process.env.MCP_SECRET)
    assert.equal(config.ownerId, undefined)
    assert.equal(validApiKey('Bearer ' + process.env.MCP_SECRET), true)
    assert.equal(
      validAccess(
        signAccess(config.key, config.ownerBinding),
        config.key,
        config.ownerBinding,
      ),
      true,
    )
    process.env.CATALOG_API_KEY = key
    assert.equal(validApiKey('Bearer ' + process.env.MCP_SECRET), false)
    assert.equal(validApiKey('Bearer ' + key), true)
  } finally {
    names.forEach((name, i) => {
      if (old[i] === undefined) delete process.env[name]
      else process.env[name] = old[i]
    })
  }
})

test('owner discovery accepts exactly one existing email account', () => {
  assert.equal(
    selectSingleOwner([{ id: owner, email: 'owner@example.test' }]),
    owner,
  )
  assert.throws(() => selectSingleOwner([]), /No hay una cuenta/)
  assert.throws(
    () =>
      selectSingleOwner([
        { id: owner, email: 'owner@example.test' },
        { id: 'other', email: 'other@example.test' },
      ]),
    /varias cuentas/,
  )
  assert.throws(() => selectSingleOwner([{ id: owner }]), /correo/)
})
