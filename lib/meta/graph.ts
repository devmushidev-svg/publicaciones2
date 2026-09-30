type MetaConfig = { appId: string; appSecret: string; redirectUri: string; graphVersion: string }
type TokenResponse = { access_token: string; expires_in?: number }
export type MetaPage = {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id: string; username?: string }
}

export function getMetaConfig(): MetaConfig | null {
  if (process.env.META_CONNECTIONS_ENABLED !== 'true') return null
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.trim()
  const redirectUri = process.env.META_REDIRECT_URI?.trim()
  const graphVersion = process.env.META_GRAPH_VERSION?.trim()
  if (!appId || !appSecret || !redirectUri || !graphVersion || !/^v\d+\.\d+$/.test(graphVersion)) return null
  try {
    const url = new URL(redirectUri)
    if (url.pathname !== '/api/meta/callback' || url.search || url.hash || url.username || url.password) return null
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) return null
  } catch { return null }
  return { appId, appSecret, redirectUri, graphVersion }
}

export function metaLoginUrl(config: MetaConfig, state: string): string {
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'pages_show_list,instagram_basic,pages_read_engagement')
  return url.toString()
}

async function graphJson<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error('Meta rejected the request')
  return response.json() as Promise<T>
}

export async function exchangeMetaCode(config: MetaConfig, code: string): Promise<{ accessToken: string; expiresAt: string | null }> {
  const endpoint = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`)
  const common = { client_id: config.appId, client_secret: config.appSecret }
  const shortToken = await graphJson<TokenResponse>(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...common, code, redirect_uri: config.redirectUri }),
  })
  if (typeof shortToken.access_token !== 'string' || !shortToken.access_token) throw new Error('Invalid Meta token response')

  const longToken = await graphJson<TokenResponse>(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...common, grant_type: 'fb_exchange_token', fb_exchange_token: shortToken.access_token }),
  })
  if (typeof longToken.access_token !== 'string' || !longToken.access_token) throw new Error('Invalid Meta token response')
  const expiresAt = typeof longToken.expires_in === 'number' && longToken.expires_in > 0
    ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
    : null
  return { accessToken: longToken.access_token, expiresAt }
}

export async function listMetaPages(config: MetaConfig, accessToken: string): Promise<MetaPage[]> {
  const pages: MetaPage[] = []
  let after: string | undefined
  for (let index = 0; index < 5; index += 1) {
    const url = new URL(`https://graph.facebook.com/${config.graphVersion}/me/accounts`)
    url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username}')
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)
    const result = await graphJson<{ data?: unknown; paging?: { cursors?: { after?: string }; next?: string } }>(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!Array.isArray(result.data)) throw new Error('Invalid Meta pages response')
    for (const item of result.data) {
      if (!item || typeof item !== 'object') continue
      const page = item as Partial<MetaPage>
      if (typeof page.id !== 'string' || typeof page.name !== 'string' || typeof page.access_token !== 'string') continue
      pages.push({
        id: page.id,
        name: page.name,
        access_token: page.access_token,
        ...(page.instagram_business_account && typeof page.instagram_business_account.id === 'string'
          ? { instagram_business_account: {
            id: page.instagram_business_account.id,
            ...(typeof page.instagram_business_account.username === 'string' ? { username: page.instagram_business_account.username } : {}),
          } }
          : {}),
      })
    }
    after = result.paging?.next ? result.paging.cursors?.after : undefined
    if (!after || pages.length >= 100) break
  }
  return pages.slice(0, 100)
}
