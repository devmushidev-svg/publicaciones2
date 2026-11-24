export class OwnerSelectionError extends Error {}

export function selectSingleOwner(
  users: Array<{ id: string; email?: string }>,
) {
  if (users.length === 0) {
    throw new OwnerSelectionError(
      'No hay una cuenta propietaria en Supabase. Debe existir la cuenta que posee tus publicaciones.',
    )
  }
  if (users.length !== 1) {
    throw new OwnerSelectionError(
      'Hay varias cuentas en Supabase. Configura CATALOG_OWNER_ID con el UID del dueño de tus publicaciones.',
    )
  }
  if (!users[0].email) {
    throw new OwnerSelectionError(
      'La cuenta propietaria necesita un correo registrado en Supabase.',
    )
  }
  return users[0].id
}

// Con varias cuentas, elige la única que tiene publicaciones guardadas.
export function selectOwnerByContent(
  users: Array<{ id: string; email?: string }>,
  ownersWithContent: string[],
) {
  if (users.length <= 1) return selectSingleOwner(users)
  const withContent = new Set(ownersWithContent)
  const candidates = users.filter((user) => withContent.has(user.id))
  if (candidates.length === 1) return selectSingleOwner(candidates)
  const list = users.map((user) => `${user.email || 'sin correo'} = ${user.id}`).join('; ')
  throw new OwnerSelectionError(
    `Hay varias cuentas en Supabase y no pude elegir la tuya. Configura CATALOG_OWNER_ID con el UID correcto: ${list}`,
  )
}
