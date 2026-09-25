# norte.

Espacio de trabajo en español para organizar publicaciones, calendario, biblioteca de medios, ideas y métricas. La aplicación usa Next.js y Supabase Auth, Postgres y Storage.

## Desarrollo local

Requisitos: Node.js 22.18 o posterior, pnpm y Docker Desktop si se ejecutarán las pruebas locales de base de datos.

1. Instala dependencias con `pnpm install --frozen-lockfile`.
2. Copia `.env.example` como `.env.local` y configura la URL y publishable key del proyecto Supabase de desarrollo. Ajusta `NEXT_PUBLIC_SITE_URL` al origen local que usarás.
3. Inicia la aplicación con `pnpm dev` y abre la URL que indique Next.js.

Variables necesarias:

- `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto Supabase.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: clave pública publishable; nunca uses aquí una service-role key.
- `NEXT_PUBLIC_SITE_URL`: origen público de la aplicación, usado por confirmación y recuperación de contraseña.

En Supabase Auth, permite como redirect URL `<NEXT_PUBLIC_SITE_URL>/auth/callback`. La recuperación usa esa ruta y continúa en `/reset-password`.

## Base de datos

Las migraciones versionadas están en `supabase/migrations/`. Incluyen perfiles, publicaciones, ideas, métricas, conexiones, preferencias, medios relacionados, secretos en el esquema privado y el bucket privado `publication-media`.

Para una base local limpia, ejecuta `pnpm db:start` y luego `pnpm db:test`. No conectes una base de producción para pruebas.

Antes de aplicar migraciones a una base remota, inspecciona el esquema y el historial de migraciones. Si V0 u otra herramienta ya creó las tablas, no ejecutes `db push` a ciegas: primero compara el estado remoto con cada migración para evitar duplicar o alterar objetos existentes. No se debe afirmar que el esquema remoto está sincronizado hasta verificarlo en el proyecto correcto.

## Comprobaciones

- `pnpm test:unit`: pruebas de conversiones de fechas y zonas horarias.
- `pnpm typecheck`: comprobación TypeScript.
- `pnpm lint`: ESLint.
- `pnpm build`: compilación de producción.
- `pnpm db:test`: pruebas pgTAP (requiere el Supabase local activo).

## Integraciones pendientes

La pantalla de Conexiones muestra solo cuentas realmente guardadas; OAuth y sincronización por red social requieren registrar aplicaciones y secretos de cada proveedor. La preferencia de resumen por correo se guarda, pero el envío requiere configurar un proveedor de correo.
