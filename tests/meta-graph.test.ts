import assert from 'node:assert/strict'
import test from 'node:test'
import { exchangeMetaCode, getMetaConfig, listMetaPages, metaLoginUrl } from '../lib/meta/graph.ts'

const config = {
  appId: '123',
  appSecret: 'test-secret',
  redirectUri: 'https://example.com/api/meta/callback',
  graphVersion: 'v25.0',
}

test('Meta config requires a version and a callback URL', () => {
  const names = ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI', 'META_GRAPH_VERSION', 'META_CONNECTIONS_ENABLED']
  const previous = names.map((name) => process.env[name])
  try {
    process.env.META_APP_ID = config.appId
    process.env.META_APP_SECRET = config.appSecret
    process.env.META_REDIRECT_URI = 'https://example.com/other'
    process.env.META_GRAPH_VERSION = config.graphVersion
    process.env.META_CONNECTIONS_ENABLED = 'true'
    assert.equal(getMetaConfig(), null)
    process.env.META_REDIRECT_URI = config.redirectUri
    assert.deepEqual(getMetaConfig(), config)
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name]
      else process.env[name] = previous[index]
    })
  }
})

test('Meta login URL has state, exact redirect and expected permissions', () => {
  const url = new URL(metaLoginUrl(config, 'random-state'))
  assert.equal(url.origin, 'https://www.facebook.com')
  assert.equal(url.searchParams.get('state'), 'random-state')
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri)
  assert.equal(url.searchParams.get('scope'), 'pages_show_list,instagram_basic,pages_read_engagement')
  assert.equal(url.searchParams.has('client_secret'), false)
})

test('code exchange uses POST bodies and never puts secrets in URLs', async () => {
  const original = globalThis.fetch
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return Response.json(calls.length === 1 ? { access_token: 'short' } : { access_token: 'long', expires_in: 3600 })
  }) as typeof fetch
  try {
    const token = await exchangeMetaCode(config, 'authorization-code')
    assert.equal(token.accessToken, 'long')
    assert.ok(token.expiresAt)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].url.includes('test-secret'), false)
    assert.equal(calls[0].url.includes('authorization-code'), false)
    assert.equal((calls[0].init.body as URLSearchParams).get('code'), 'authorization-code')
    assert.equal((calls[1].init.body as URLSearchParams).get('fb_exchange_token'), 'short')
  } finally { globalThis.fetch = original }
})

test('page listing follows cursors on the fixed Graph host and keeps linked Instagram', async () => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    if (urls.length === 1) return Response.json({
      data: [{ id: '11', name: 'Page A', access_token: 'page-token', instagram_business_account: { id: '22', username: 'studio' } }],
      paging: { next: 'https://evil.example/steal', cursors: { after: 'cursor' } },
    })
    return Response.json({ data: [{ id: '33', name: 'Page B', access_token: 'other-token' }] })
  }) as typeof fetch
  try {
    const pages = await listMetaPages(config, 'user-token')
    assert.equal(pages.length, 2)
    assert.equal(pages[0].instagram_business_account?.username, 'studio')
    assert.equal(new URL(urls[1]).origin, 'https://graph.facebook.com')
    assert.equal(new URL(urls[1]).searchParams.get('after'), 'cursor')
  } finally { globalThis.fetch = original }
})

test('invalid Meta responses fail closed', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => Response.json({ data: null })) as typeof fetch
  try { await assert.rejects(listMetaPages(config, 'token'), /Invalid Meta pages response/) }
  finally { globalThis.fetch = original }
})
