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
