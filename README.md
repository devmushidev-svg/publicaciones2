# norte.

Catálogo privado de Multiplanet para organizar publicaciones, fotos y calendario. **ChatGPT es la vía principal para publicar**: el MCP de Facebook vive en `mcp/` y consulta esta misma biblioteca de Supabase. La web queda como panel de apoyo para revisar y editar contenido cuando el catálogo crezca.

## Acceso sin formulario de login

La web es de un solo propietario. Se retiraron los formularios de inicio, registro y
recuperación, y el botón Salir. Entrá por `https://TU_SITIO/access/<CATALOG_ACCESS_KEY>`;
después abre directamente la biblioteca y recuerda el acceso durante 30 días.
El enlace es privado: quien lo tenga accede a tu espacio. Cambiar la clave invalida
el acceso anterior. Sin el enlace o su cookie firmada, la aplicación devuelve 404.

Se conserva la cuenta propietaria y sus reglas RLS en Supabase. El servidor abre una
sesión real de esa cuenta, sin pedir correo, contraseña o códigos y sin enviar correo.
No se crean usuarios anónimos nuevos ni se comparte la clave administrativa con el
navegador. `CATALOG_OWNER_ID` debe ser el ID del usuario **que ya posee tus publicaciones**.

Configuración privada del servidor web, además de la URL y clave pública de Supabase:

- `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`): clave administrativa, solo servidor.
- `CATALOG_OWNER_ID`: UUID de tu usuario existente en Supabase Auth.
- `CATALOG_ACCESS_KEY`: clave del enlace web, de 32 caracteres o más.
- `CATALOG_API_KEY`: otra clave, distinta, de 32 caracteres o más para el puente del MCP.

Generá cada clave con `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
No uses prefijos `NEXT_PUBLIC_` para esas cuatro variables.

## Publicar y programar desde ChatGPT

En la biblioteca guardás fotos y texto, elegís página y categoría, y marcás el contenido
aprobado para lotes. La vigencia es opcional. También podés guardar y editar ese mismo
contenido desde ChatGPT, incluidas imágenes adjuntas al chat.

Por ejemplo: “preparame 43 de visa americana en los próximos 15 días”. El MCP lee la
biblioteca, respeta el descanso configurado, excluye contenido no aprobado o vencido
y muestra los textos, fotos y fechas antes de confirmar. Si falta contenido, no repite
ni crea un lote parcial. Los diseños de flores se eligen manualmente; los suministros
florales sí pueden entrar en lotes. Taller puede incluir computadoras e impresoras.

Confirmar en ChatGPT crea el plan completo en el calendario de esta web y activa la
cola persistente del MCP. La VM debe estar encendida; el chat puede estar cerrado.
Guardar en calendario y entregar a Meta no registran uso real: el historial se escribe
cuando el MCP comprueba que Facebook publicó. Las fotos y el texto revisados quedan
congelados para cada envío. Los planes automáticos se mueven o cancelan desde ChatGPT;
las entradas manuales del calendario mantienen su funcionamiento anterior.

Detalles, herramientas, despliegue de la VM y estados: [mcp/README.md](mcp/README.md).

## Activación de la integración

Inspeccioná primero el esquema y el historial de migraciones del proyecto Supabase
correcto. Aplicá las migraciones previas pendientes y
`supabase/migrations/20261120000100_chatgpt_catalogue.sql`; no reinicies la base ni
ejecutes el archivo de fases anteriores sobre una base que ya las tiene.

Configurá las variables de la web y, en el `.env` **existente** del MCP, agregá:

```dotenv
CATALOGO_URL=https://TU_SITIO
CATALOGO_API_KEY=el_mismo_valor_privado_de_CATALOG_API_KEY
```

Después instalá la versión de `mcp/` conservando tokens de Facebook, `MCP_SECRET` y
`DATA_DIR`. El dominio y la ruta del MCP pueden permanecer iguales. La biblioteca
remota conserva sus registros; el SQLite local solo almacena caché, snapshots y cola.
Esta migración y configuración deben verificarse en el proyecto remoto antes de
afirmar que la integración de producción está activada.

## Desarrollo local

Requisitos: Node.js 22.18 o posterior, pnpm y Docker Desktop si se ejecutarán las pruebas locales de base de datos.

1. Instala dependencias con `pnpm install --frozen-lockfile`.
2. Copia `.env.example` como `.env.local` y configura la URL y publishable key del proyecto Supabase de desarrollo. Ajusta `NEXT_PUBLIC_SITE_URL` al origen local que usarás.
3. Inicia la aplicación con `pnpm dev` y abre la URL que indique Next.js.

Variables necesarias:

- `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto Supabase.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: clave pública publishable; nunca uses aquí una service-role key.
- `NEXT_PUBLIC_SITE_URL`: origen público de la aplicación, usado por confirmación y recuperación de contraseña.

Configurá también las cuatro variables privadas indicadas arriba. La navegación de
la aplicación ya no usa los formularios ni el flujo de recuperación de contraseña.

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
- `pnpm test:catalogue-db`: aplica todas las migraciones a PostgreSQL en memoria
  con PGlite, sin Docker, y comprueba el puente, permisos, snapshots y reintentos.
- `python -m unittest discover -s mcp/tests -v`: pruebas del MCP en modo simulado.
- `python tests/browser_catalogue.py`: prueba de navegador opcional en Windows con
  Edge y `pip install playwright`; usa Supabase simulado, sin credenciales reales.

## Integraciones pendientes

La pantalla de Conexiones muestra solo cuentas realmente guardadas; OAuth y sincronización por red social requieren registrar aplicaciones y secretos de cada proveedor. La preferencia de resumen por correo se guarda, pero el envío requiere configurar un proveedor de correo.
