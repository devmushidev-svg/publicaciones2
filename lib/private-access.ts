import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const accessCookie = 'norte-private-access'
export const accessSeconds = 30 * 24 * 60 * 60

export function privateConfig() {
  const key = process.env.CATALOG_ACCESS_KEY?.trim()
  const ownerId = process.env.CATALOG_OWNER_ID?.trim()
  if (
    !key ||
    key.length < 32 ||
    !ownerId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      ownerId,
    )
  ) {
    throw new Error(
      'Configura CATALOG_ACCESS_KEY (32 caracteres o más) y CATALOG_OWNER_ID.',
    )
  }
  return { key, ownerId }
}

export function sameSecret(actual: string, expected: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(actual), digest(expected))
}

export function signAccess(key: string, ownerId: string, now = Date.now()) {
  const expires = Math.floor(now / 1000) + accessSeconds
  return `${expires}.${createHmac('sha256', key).update(`${ownerId}:${expires}`).digest('hex')}`
}

export function validAccess(
  value: string | undefined,
  key: string,
  ownerId: string,
  now = Date.now(),
) {
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(value || '')
  if (!match) return false
  const expires = Number(match[1])
  if (expires <= now / 1000 || expires > now / 1000 + accessSeconds + 1)
    return false
  const signature = createHmac('sha256', key)
    .update(`${ownerId}:${expires}`)
    .digest('hex')
  return sameSecret(match[2], signature)
}

export function validApiKey(authorization: string | null) {
  const key = process.env.CATALOG_API_KEY?.trim()
  return Boolean(
    key &&
      key.length >= 32 &&
      authorization?.startsWith('Bearer ') &&
      sameSecret(authorization.slice(7), key),
  )
}
