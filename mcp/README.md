# MCP de Multiplanet conectado al catálogo

El publicador original vive ahora en esta carpeta. Conserva los endpoints
`/mcp/<MCP_SECRET>`, `/subir/<MCP_SECRET>`, `/privacidad` y `/salud`, las dos páginas
de Facebook y las herramientas para fotos adjuntas de ChatGPT.

La biblioteca oficial es Supabase, la misma que muestra la web. `catalogo.sqlite3`
en `DATA_DIR` es una caché y la cola durable del MCP: guarda copias aprobadas de los
textos y fotos para que editar la biblioteca no cambie un envío ya revisado.
No hay que cargar dos catálogos. Guardar desde ChatGPT agrega contenido a la web;
preparar un lote vuelve a consultar la biblioteca para leer sus cambios.

## Configuración

1. Aplicá la migración del catálogo y configurá la web según el README principal.
2. Conservá el `.env` de tu MCP actual y agregá `CATALOGO_URL` (origen HTTPS de esta
   web). Reutiliza su `MCP_SECRET`, cuyo valor también se configura en Vercel. No
   hay que generar claves nuevas. Si preferís una clave separada, podés definir
   `CATALOGO_API_KEY` con el valor de `CATALOG_API_KEY` en la web.
3. Conservá `MCP_SECRET`, los tokens de Facebook, `DATA_DIR` y su volumen. No hay que
   cambiar la conexión de ChatGPT si el dominio y el secreto permanecen iguales.
4. Instalá `pip install -r requirements.txt` y ejecutá `python server.py` desde esta
   carpeta. En Azure, el servicio existente puede seguir usando `/opt/fbmcp`.

El actualizador nuevo está en `mcp/deploy/actualizar.sh`; descarga los tres módulos
de `publicaciones2/main/mcp`, prueba con datos aislados, respalda el código y reinicia
`fbmcp`, conservando `.env` y los datos. No uses el actualizador del repositorio
anterior después de cambiar de origen, porque volvería a instalar el servidor viejo.
`FBMCP_RAW` puede apuntar a la rama de revisión para probar antes de integrar.

Para Docker, el contexto de construcción es esta carpeta. Montá un volumen
persistente en `/data` y pasá el `.env` al contenedor. La web continúa en su hosting.

## Uso desde ChatGPT

- `inicializar_categorias_catalogo`: agrega los tipos de Multiplanet que falten,
  sin borrar categorías existentes. Taller incluye computadoras e impresoras.
- `listar_categorias_catalogo` y `listar_catalogo`: consultan el catálogo real.
- `guardar_publicacion_catalogo` / `guardar_publicacion_catalogo_con_imagenes`:
  guardan fotos y texto en la web sin publicar. Fotos de la bandeja o adjuntas.
- `actualizar_publicacion_catalogo`: editar, aprobar para lotes, cambiar vigencia
  o archivar. Los nombres de fotos se obtienen con `listar_catalogo`.
- `ver_imagen_catalogo`: revisar las imágenes antes de redactar o aprobar.
- `preparar_lote_catalogo`: tipo, cantidad, días, inicio, horas y página. Por ejemplo,
  “preparame 43 de visa americana para los próximos 15 días”. No publica nada.
- `preparar_publicacion_catalogo`: elegir una sola, incluidas flores.
- `confirmar_plan_catalogo`: solo después de aprobar textos, fotos y horarios.
  Aparece en el calendario de la web y activa la cola local.
- `listar_agenda_catalogo` y `cancelar_plan_catalogo`: revisar o cancelar antes del envío.

Solo se eligen publicaciones aprobadas, vigentes y de la página pedida. Se conserva
el descanso mínimo configurado en la web y no se repite una publicación dentro del
mismo lote. Si faltan publicaciones u horarios, el plan completo se rechaza. Taller
incluye sus subcategorías. Diseños de flores y categorías florales manuales se
excluyen; los suministros florales sí admiten lotes. La selección individual permite
elegir un diseño concreto para una temporada.

Los borradores reservan contenido hasta cancelarlos. Las fotos del plan se descargan
al MCP antes de devolver la vista previa, usando URLs firmadas de Storage. Se aceptan
solo fotos; los videos y publicaciones de más de 10 fotos quedan fuera de estos lotes.
Si usás un dominio propio de Storage, definí `CATALOGO_MEDIA_HOST` con su hostname.

## Ejecución y estados

El consumidor revisa la cola cada 30 segundos con un solo proceso. Permite planificar
hasta 365 días y espera para entrar en la ventana configurada de Meta (30 días por
defecto). **La VM debe estar encendida** para entregar los posts; ChatGPT puede estar
cerrado. Una vez que Meta acepta la programación, Facebook controla la publicación.

`meta` significa que Meta devolvió un ID, sin afirmar que ya salió. Al pasar la fecha,
el MCP consulta `is_published` en Facebook antes de registrar el historial y cumplir
la entrada del calendario. Se conservan el texto y las fotos aprobados en el historial.
Las modificaciones de hora hechas mediante `reprogramar`, los adelantos y los borrados
del MCP se sincronizan con la web. La web indica que esos envíos se administran desde
ChatGPT, evitando mover solo una mitad del plan.

Los errores ambiguos y los envíos interrumpidos quedan en `revisar`: nunca se reenvían
automáticamente. Un comprobante local durable permite reintentar la actualización de
la web sin volver a publicar en Meta. Si se pierde una respuesta, consultá la agenda;
no prepares otro lote para reemplazarlo sin revisar el anterior. Si pasó el horario
mientras el servidor estaba apagado, se marca vencido, sin publicar inmediatamente.

`FB_DRY_RUN=1` simula Meta y no crea intenciones reales en el calendario ni historial.
Los planes simulados no se activan al cambiar al modo real. Guardar contenido en la
biblioteca sí escribe en Supabase: para pruebas integrales usá un proyecto de desarrollo.

Respaldá todo `DATA_DIR` con el servicio detenido, junto con Supabase y Storage.
Perder esa carpeta pierde los planes locales; conservarla evita reemplazar un envío
ya aceptado. El sitio no incluye credenciales de Meta: permanecen en la VM del MCP.

Pruebas desde la raíz del repositorio:

```sh
python -m unittest discover -s mcp/tests -v
```
