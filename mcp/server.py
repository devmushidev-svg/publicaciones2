"""
MCP de Facebook para Multiplanet.

Servidor MCP remoto (Streamable HTTP) que publica y programa posts en una
página de Facebook usando la Graph API oficial de Meta.

Flujo pensado:
  1. Subís las fotos desde el celular o la compu a la página /subir/<SECRETO>.
  2. Desde Claude: "mirá las imágenes nuevas y programame 5 posts diarios".
  3. Claude ve cada foto (ver_imagen), escribe el texto y llama programar_post.
  4. Meta publica a la hora indicada; el servidor no necesita estar despierto
     en ese momento.
"""

from __future__ import annotations

import asyncio
import html
import io
import json
import logging
import os
import re
import secrets
import shutil
import time
import sys
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

import httpx
from mcp.server.fastmcp import FastMCP, Image
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from pydantic.json_schema import SkipJsonSchema
from typing_extensions import NotRequired, TypedDict
from PIL import Image as PILImage
from PIL import ImageOps
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

logging.getLogger("httpx").setLevel(logging.WARNING)  # no escribir el token en los logs

# ---------------------------------------------------------------------------
# Configuración (todo por variables de entorno)
# ---------------------------------------------------------------------------

PAGE_ID = os.environ.get("FB_PAGE_ID", "")
PAGE_TOKEN = os.environ.get("FB_PAGE_TOKEN", "")
# Páginas disponibles. "tocoa" es la principal; "floristeria" se activa al definir sus variables.
PAGINAS: dict[str, tuple[str, str]] = {"tocoa": (PAGE_ID, PAGE_TOKEN)}
if os.environ.get("FB_PAGE_ID_FLORISTERIA") and os.environ.get("FB_PAGE_TOKEN_FLORISTERIA"):
    PAGINAS["floristeria"] = (os.environ["FB_PAGE_ID_FLORISTERIA"], os.environ["FB_PAGE_TOKEN_FLORISTERIA"])
NOMBRES_PAGINA = {"tocoa": "Multiplanet Tocoa", "floristeria": "Multiplanet Floristería"}
Pagina = Literal["tocoa", "floristeria"]
TOKENS = [t for _, t in PAGINAS.values() if t]
GRAPH_VERSION = os.environ.get("FB_GRAPH_VERSION", "v25.0")
GRAPH_URL = os.environ.get("FB_GRAPH_URL", "https://graph.facebook.com")
TZ = ZoneInfo(os.environ.get("ZONA_HORARIA", "America/Tegucigalpa"))
SECRET = os.environ.get("MCP_SECRET", "")
DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
PUBLIC_HOST = os.environ.get("PUBLIC_HOST", "")  # ej. multiplanet-mcp.eastus.cloudapp.azure.com
DRY_RUN = os.environ.get("FB_DRY_RUN", "0") == "1"  # no llama a Meta, solo simula
PORT = int(os.environ.get("PORT", "8000"))

# Límites de Meta para scheduled_publish_time
MIN_ANTICIPACION = timedelta(minutes=10)
MAX_ANTICIPACION = timedelta(days=int(os.environ.get("MAX_DIAS_PROGRAMAR", "30")))

BANDEJA = DATA_DIR / "bandeja"      # fotos esperando ser usadas
USADAS = DATA_DIR / "usadas"        # fotos ya programadas/publicadas
REGISTRO = DATA_DIR / "registro.jsonl"
EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
MAX_BYTES_META = 4 * 1024 * 1024    # comprimimos por encima de esto

for d in (BANDEJA, USADAS):
    d.mkdir(parents=True, exist_ok=True)

if len(SECRET) < 24:
    raise SystemExit(
        "MCP_SECRET falta o es muy corto (mínimo 24 caracteres). "
        f"Generá uno con: python -c \"import secrets;print(secrets.token_urlsafe(32))\"\n"
        f"Ejemplo: {secrets.token_urlsafe(32)}"
    )
if not DRY_RUN and (not PAGE_ID or not PAGE_TOKEN):
    raise SystemExit("Faltan FB_PAGE_ID y/o FB_PAGE_TOKEN (o activá FB_DRY_RUN=1 para probar).")

if PUBLIC_HOST:
    seguridad = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[PUBLIC_HOST, f"{PUBLIC_HOST}:*", "localhost:*", "127.0.0.1:*"],
        allowed_origins=[f"https://{PUBLIC_HOST}", "https://claude.ai"],
    )
else:
    seguridad = TransportSecuritySettings(enable_dns_rebinding_protection=False)

@asynccontextmanager
async def vida_catalogo(_):
    catalogo.recuperar_interrumpidos()
    tarea = asyncio.create_task(ciclo_catalogo())
    try:
        yield {}
    finally:
        tarea.cancel()
        with suppress(asyncio.CancelledError):
            await tarea


mcp = FastMCP(
    name="facebook-multiplanet",
    instructions=(
        "Publica y programa posts en las páginas de Facebook de Multiplanet: 'tocoa' (Multiplanet "
        "Tocoa, la principal y la que se usa por defecto) y 'floristeria' (Multiplanet Floristería). "
        "Usá pagina='floristeria' cuando el usuario diga floristería, florería, flores o similar, o "
        "cuando el contenido sea claramente floral (ramos, arreglos, flores, insumos de floristería); "
        "si la elegiste por el contenido, decíselo al usuario. En cualquier otro caso usá 'tocoa'. "
        "Publicá, programá o borrá SOLO cuando el usuario lo pida de forma explícita (ej. 'publicalo', "
        "'subilo a Facebook'); generar o mostrar una imagen no es permiso para publicarla. "
        "Las fotos se suben a la bandeja desde la página web del servidor; usá listar_imagenes y "
        "ver_imagen para conocerlas antes de escribir el texto. Para imágenes adjuntas en el chat usá "
        "programar_post_con_imagenes o verificar_imagenes_chat y pasá el archivo adjunto mismo en "
        "'imagenes'; nunca escribas rutas /mnt/data ni sandbox:. Las fechas se interpretan en hora "
        "de Honduras si no traen zona horaria. Meta solo permite programar entre 10 minutos y 30 "
        "días adelante. Antes de programar una tanda, mostrale al usuario los textos y horarios. "
        "Para guardar contenido sin publicar usá guardar_publicacion_catalogo; si las fotos vienen "
        "adjuntas en el chat usá guardar_publicacion_catalogo_con_imagenes. Para lotes por tipo "
        "usá listar_categorias_catalogo y preparar_lote_catalogo; mostrale el plan y solo llamá "
        "confirmar_plan_catalogo después de su aprobación expresa. El catálogo admite fechas "
        "más lejanas mediante una cola local durable que requiere el servidor encendido. "
        "Los diseños de flores se eligen manualmente; los suministros florales sí admiten lotes. "
        "No vuelvas a crear un plan si ya tenés su ID: consultá listar_agenda_catalogo."
    ),
    host=os.environ.get("HOST", "0.0.0.0"),
    port=PORT,
    streamable_http_path=f"/mcp/{SECRET}",
    stateless_http=True,
    json_response=True,
    transport_security=seguridad,
)

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


class ErrorFacebook(Exception):
    pass


def _nombre_seguro(nombre: str) -> str:
    base = Path(nombre).name
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "imagen"
    return base[:120]


def _ruta_bandeja(nombre: str) -> Path:
    ruta = (BANDEJA / _nombre_seguro(nombre)).resolve()
    if ruta.parent != BANDEJA.resolve() or not ruta.is_file():
        raise ValueError(f"No existe '{nombre}' en la bandeja. Usá listar_imagenes para ver los nombres.")
    return ruta


def _parse_fecha(fecha: str) -> datetime:
    """Acepta '2026-11-20 09:00', '2026-11-20T09:00', con o sin zona horaria."""
    try:
        dt = datetime.fromisoformat(fecha.strip().replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError(f"Fecha inválida '{fecha}'. Usá el formato AAAA-MM-DD HH:MM.") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt


def _validar_programacion(dt: datetime) -> int:
    ahora = datetime.now(TZ)
    if dt - ahora < MIN_ANTICIPACION:
        raise ValueError(
            f"{dt:%Y-%m-%d %H:%M} está a menos de 10 minutos (o ya pasó). Meta exige al menos 10 min."
        )
    if dt - ahora > MAX_ANTICIPACION:
        raise ValueError(
            f"{dt:%Y-%m-%d %H:%M} está a más de {MAX_ANTICIPACION.days} días. Meta no deja programar tan lejos."
        )
    return int(dt.timestamp())


def _fmt_ts(ts: int | float | str | None) -> str:
    if ts in (None, ""):
        return "—"
    return datetime.fromtimestamp(int(float(ts)), TZ).strftime("%Y-%m-%d %H:%M")


def _preparar_imagen(ruta: Path) -> tuple[bytes, str]:
    """Devuelve bytes listos para Meta: corrige rotación EXIF y comprime si pesa mucho."""
    if ruta.suffix.lower() in {".jpg", ".jpeg", ".png"} and ruta.stat().st_size <= MAX_BYTES_META:
        mime = "image/png" if ruta.suffix.lower() == ".png" else "image/jpeg"
        return ruta.read_bytes(), mime
    with PILImage.open(ruta) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((2048, 2048))
        calidad = 90
        while True:
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=calidad, optimize=True)
            if buf.tell() <= MAX_BYTES_META or calidad <= 50:
                return buf.getvalue(), "image/jpeg"
            calidad -= 10


def _registrar(evento: dict) -> None:
    evento["cuando"] = datetime.now(TZ).isoformat(timespec="seconds")
    with REGISTRO.open("a", encoding="utf-8") as f:
        f.write(json.dumps(evento, ensure_ascii=False) + "\n")


async def _graph(metodo: str, ruta: str, data: dict | None = None, files: dict | None = None,
                 params: dict | None = None, token: str | None = None) -> dict:
    """Llama a la Graph API y convierte los errores de Meta en mensajes claros."""
    if DRY_RUN:
        falso = f"{ruta.split('/')[0] or '000'}_{secrets.token_hex(8)}"
        return {"id": falso, "dry_run": True, "data": []}
    url = f"{GRAPH_URL}/{GRAPH_VERSION}/{ruta.lstrip('/')}"
    params = {**(params or {}), "access_token": token or PAGE_TOKEN}
    try:
        async with httpx.AsyncClient(timeout=90) as cliente:
            r = await cliente.request(metodo, url, params=params, data=data, files=files)
    except httpx.HTTPError:
        raise ErrorFacebook("No pude completar la solicitud a Meta.") from None
    try:
        cuerpo = r.json()
    except ValueError:
        cuerpo = {"raw": r.text[:500]}
    if r.status_code >= 400 or "error" in cuerpo:
        err = cuerpo.get("error", {})
        msg = err.get("error_user_msg") or err.get("message") or str(cuerpo)[:300]
        msg = str(msg)
        for t in TOKENS:
            msg = msg.replace(t, "[oculto]")
        codigo = err.get("code")
        pista = ""
        if codigo == 190:
            pista = " → El token venció o es inválido: generá uno nuevo con obtener_token.py."
        elif codigo in (10, 200):
            pista = " → Falta el permiso pages_manage_posts o no sos admin de la página."
        elif codigo in (4, 17, 32, 613):
            pista = " → Límite de llamadas de Meta; esperá unos minutos."
        raise ErrorFacebook(f"Meta respondió error {codigo}: {msg}{pista}")
    return cuerpo


def _pagina(pagina: str | None) -> tuple[str, str, str]:
    """Devuelve (id, token, nombre visible) de la página pedida. Por defecto, Tocoa."""
    clave = (pagina or "tocoa").strip().lower()
    if clave not in NOMBRES_PAGINA:
        raise ValueError("Página desconocida: usá 'tocoa' o 'floristeria'.")
    if clave not in PAGINAS:
        if DRY_RUN:
            return ("480683145137621", "", NOMBRES_PAGINA[clave])
        raise ValueError(f"{NOMBRES_PAGINA[clave]} todavía no está conectada en el servidor "
                         "(faltan FB_PAGE_ID_FLORISTERIA y FB_PAGE_TOKEN_FLORISTERIA).")
    pid, token = PAGINAS[clave]
    return pid, token, NOMBRES_PAGINA[clave]


def _pagina_de_post(post_id: str, pagina: str | None) -> tuple[str, str]:
    """Deduce la página por el prefijo del ID del post ('<idpagina>_<idpost>')."""
    prefijo = post_id.split("_", 1)[0]
    for clave, (pid, _) in PAGINAS.items():
        if pid and pid == prefijo:
            _, token, nombre = _pagina(clave)
            return token, nombre
    _, token, nombre = _pagina(pagina)
    return token, nombre


async def _subir_fotos(nombres: list[str], page_id: str, token: str) -> list[str]:
    """Sube fotos como no publicadas/temporales y devuelve sus IDs para adjuntar al post."""
    ids = []
    for nombre in nombres:
        ruta = _ruta_bandeja(nombre)
        datos, mime = _preparar_imagen(ruta)
        res = await _graph(
            "POST", f"{page_id}/photos",
            data={"published": "false", "temporary": "true"},
            files={"source": (ruta.name, datos, mime)},
            token=token,
        )
        ids.append(res["id"])
    return ids


def _mover_a_usadas(nombres: list[str]) -> None:
    destino = USADAS / datetime.now(TZ).strftime("%Y-%m-%d")
    destino.mkdir(parents=True, exist_ok=True)
    for nombre in nombres:
        try:
            ruta = _ruta_bandeja(nombre)
            shutil.move(str(ruta), destino / ruta.name)
        except (ValueError, OSError):
            pass


async def _crear_post(texto: str, imagenes: list[str], link: str | None,
                      programado_ts: int | None, pagina: str | None = None) -> dict:
    page_id, token, nombre = _pagina(pagina)
    if not texto.strip() and not imagenes and not link:
        raise ValueError("El post necesita al menos texto, una imagen o un link.")
    if imagenes and link:
        raise ValueError("Facebook no combina fotos y vista previa de link en el mismo post: elegí uno.")
    if len(imagenes) > 10:
        raise ValueError("Máximo 10 imágenes por post.")
    for n in imagenes:  # validar antes de subir nada
        _ruta_bandeja(n)

    data: dict[str, str] = {}
    if texto.strip():
        data["message"] = texto
    if link:
        data["link"] = link
    if imagenes:
        for i, fbid in enumerate(await _subir_fotos(imagenes, page_id, token)):
            data[f"attached_media[{i}]"] = json.dumps({"media_fbid": fbid})
    if programado_ts is not None:
        data["published"] = "false"
        data["scheduled_publish_time"] = str(programado_ts)

    res = await _graph("POST", f"{page_id}/feed", data=data, token=token)
    res["pagina"] = nombre
    _mover_a_usadas(imagenes)
    _registrar({"accion": "programado" if programado_ts else "publicado", "post_id": res.get("id"),
                "pagina": nombre,
                "hora": _fmt_ts(programado_ts) if programado_ts else "ahora",
                "imagenes": imagenes, "texto": texto[:200]})
    return res


# ---------------------------------------------------------------------------
# Herramientas MCP
# ---------------------------------------------------------------------------



class ArchivoChat(TypedDict):
    download_url: str
    file_id: str
    mime_type: NotRequired[str]
    file_name: NotRequired[str]


ArchivosChat = Annotated[list[ArchivoChat], Field(min_length=1, max_length=10)]
META_ARCHIVOS_CHAT = {"openai/fileParams": ["imagenes"]}
ERROR_ARCHIVO_CHAT = (
    "ChatGPT no entregó un enlace de descarga para la imagen. "
    "Adjuntala de nuevo desde ChatGPT web o usá la página /subir."
)
FORMATOS_CHAT = {
    "JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp",
    "GIF": ".gif", "BMP": ".bmp",
}
MAX_BYTES_CHAT = 25 * 1024 * 1024
MAX_PIXELES_CHAT = 12_000_000


HOSTS_ARCHIVOS_CHAT = ("oaiusercontent.com", "openai.com", "chatgpt.com")


# ChatGPT entrega los adjuntos con un enlace SAS al almacenamiento de OpenAI en Azure,
# por ejemplo https://oaisdmntprcentralus.blob.core.windows.net/files/... (visto en producción).
# Solo se aceptan cuentas de almacenamiento que empiezan con "oai", no cualquier blob de Azure.
_BLOB_OPENAI = re.compile(r"^oai[a-z0-9]{1,21}\.blob\.core\.windows\.net$")


def _host_permitido(host: str) -> bool:
    return (any(host == h or host.endswith("." + h) for h in HOSTS_ARCHIVOS_CHAT)
            or bool(_BLOB_OPENAI.match(host)))


def _url_archivo_chat(archivo: ArchivoChat) -> httpx.URL:
    if not archivo["download_url"].strip() or not archivo["file_id"].strip():
        raise ValueError(ERROR_ARCHIVO_CHAT)
    crudo = archivo["download_url"].strip()
    if crudo.startswith(("/mnt/", "sandbox:", "file:")):
        raise ValueError(
            "ChatGPT mandó la ruta interna del archivo (/mnt/data), no un enlace descargable. "
            "Pasa con imágenes generadas por ChatGPT y en la app del celular: descargá la imagen, "
            "adjuntala en el chat desde ChatGPT web y pedí publicar de nuevo."
        )
    mime = archivo.get("mime_type", "").split(";", 1)[0].strip().lower()
    if mime and not mime.startswith("image/") and mime != "application/octet-stream":
        raise ValueError("Adjuntá un archivo de imagen.")
    try:
        url = httpx.URL(archivo["download_url"])
    except (httpx.InvalidURL, ValueError):
        raise ValueError("El enlace de descarga del archivo es inválido.") from None
    host = url.host.lower()
    if (
        url.scheme != "https" or url.port not in (None, 443) or url.userinfo
        or not _host_permitido(host)
    ):
        raise ValueError(
            "El enlace debe ser HTTPS y del almacenamiento de archivos de OpenAI. "
            "Si ChatGPT no entrega un enlace compatible, usá la página /subir."
        )
    return url


async def _descargar_archivo_chat(cliente: httpx.AsyncClient, url: httpx.URL, ruta: Path) -> int:
    try:
        async with asyncio.timeout(45):
            async with cliente.stream("GET", url, headers={"Accept-Encoding": "identity"}) as r:
                r.raise_for_status()
                if r.headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise ValueError("El servidor envió una codificación de descarga incompatible.")
                longitud = r.headers.get("Content-Length", "")
                if longitud.isascii() and longitud.isdecimal() and int(longitud) > MAX_BYTES_CHAT:
                    raise ValueError("Cada imagen puede pesar hasta 25 MiB.")
                total = 0
                with ruta.open("wb") as salida:
                    async for bloque in r.aiter_raw(64 * 1024):
                        total += len(bloque)
                        if total > MAX_BYTES_CHAT:
                            raise ValueError("Cada imagen puede pesar hasta 25 MiB.")
                        salida.write(bloque)
                return total
    except (httpx.HTTPError, httpx.InvalidURL, TimeoutError):
        raise ValueError(
            "No pude descargar la imagen. Volvé a adjuntarla desde ChatGPT web "
            "para obtener un enlace nuevo o usá la página /subir."
        ) from None


def _inspeccionar_archivo_chat(ruta: Path) -> tuple[str, int, int]:
    try:
        with PILImage.open(ruta, formats=list(FORMATOS_CHAT)) as im:
            ancho, alto = im.size
            if ancho * alto > MAX_PIXELES_CHAT:
                raise ValueError("Cada imagen puede tener hasta 12 megapíxeles.")
            extension = FORMATOS_CHAT[im.format]
            im.load()
    except (OSError, SyntaxError, PILImage.DecompressionBombError):
        raise ValueError("El archivo debe ser una imagen válida JPEG, PNG, WEBP, GIF o BMP.") from None
    return extension, ancho, alto


_log = logging.getLogger("fbmcp")


def _describir_entrada(valor) -> str:
    """Resumen seguro de lo que mandó ChatGPT: sin query string (puede llevar firma)."""
    def url_corta(u) -> str:
        return str(u).split("?", 1)[0][:80]
    if isinstance(valor, str):
        return f"str:{url_corta(valor)!r}"
    if isinstance(valor, dict):
        return "obj{" + ", ".join(
            f"{k}={url_corta(v)!r}" if k == "download_url" else f"{k}={str(v)[:40]!r}"
            for k, v in valor.items()
        ) + "}"
    if isinstance(valor, list):
        return "[" + "; ".join(_describir_entrada(v) for v in valor) + "]"
    return type(valor).__name__


async def _recibir_archivos_chat(
    imagenes: ArchivosChat | str | list[ArchivoChat | str], temporal: Path,
) -> list[tuple[Path, int, int, int]]:
    _log.warning("archivos del chat recibidos: %s", _describir_entrada(imagenes))
    if isinstance(imagenes, str) or any(isinstance(archivo, str) for archivo in imagenes):
        raise ValueError(ERROR_ARCHIVO_CHAT)

    urls = [_url_archivo_chat(archivo) for archivo in imagenes]
    recibidas = []
    async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as cliente:
        for indice, (archivo, url) in enumerate(zip(imagenes, urls), 1):
            parcial = temporal / f"{indice}.descarga"
            total = await _descargar_archivo_chat(cliente, url, parcial)
            extension, ancho, alto = _inspeccionar_archivo_chat(parcial)
            original = _nombre_seguro(archivo.get("file_name") or "imagen")
            base = Path(original).stem[:80]
            ruta = temporal / _nombre_seguro(f"{base}-{secrets.token_hex(12)}{extension}")
            parcial.rename(ruta)
            recibidas.append((ruta, total, ancho, alto))
    return recibidas


# Esta segunda variante acepta los marcadores de clientes antiguos en ejecución.
# El descriptor anuncia el arreglo de objetos exigido por el escáner de ChatGPT.
ArchivosChatConMarcador = Annotated[list[ArchivoChat | str], Field(min_length=1, max_length=10)]
EntradaArchivosChat = ArchivosChat | SkipJsonSchema[str | ArchivosChatConMarcador]
_archivos_chat_en_curso = asyncio.Lock()


def _resultado(res: dict, dt: datetime | None) -> str:
    extra = " (simulado)" if res.get("dry_run") else ""
    donde = f" en {res.get('pagina', NOMBRES_PAGINA['tocoa'])}"
    if dt is None:
        return f"Publicado{extra}{donde}. ID: {res.get('id')}"
    return (f"Programado{extra}{donde} para {dt.astimezone(TZ):%Y-%m-%d %H:%M} (hora Honduras). "
            f"ID: {res.get('id')}")


@mcp.tool(
    meta=META_ARCHIVOS_CHAT,
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=True),
)
async def verificar_imagenes_chat(imagenes: EntradaArchivosChat) -> str:
    """Comprueba que llegaron las imágenes del chat, su formato, tamaño y dimensiones.
    Usa archivos temporales. No sube fotos a Facebook ni guarda imágenes en la bandeja.
    """
    async with _archivos_chat_en_curso:
        with TemporaryDirectory(prefix="fbmcp-chat-") as carpeta:
            recibidas = await _recibir_archivos_chat(imagenes, Path(carpeta))
            filas = [
                f"- Imagen {i}: {ruta.suffix[1:].upper()}, {ancho}×{alto}, {total:,} bytes"
                for i, (ruta, total, ancho, alto) in enumerate(recibidas, 1)
            ]
    return "\n".join([f"Verifiqué {len(filas)} imagen(es). Sin cambios en Facebook.", *filas])


@mcp.tool(
    meta=META_ARCHIVOS_CHAT,
    annotations=ToolAnnotations(
        readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True,
    ),
)
async def programar_post_con_imagenes(
    texto: str, imagenes: EntradaArchivosChat, fecha: str | None = None, pagina: Pagina = "tocoa",
) -> str:
    """Publica o programa un post con entre 1 y 10 imágenes adjuntas del chat.
    Usala SOLO cuando el usuario pida publicar o programar de forma explícita.
    pagina: 'tocoa' (por defecto) o 'floristeria' (si lo pide o el contenido es floral).
    Si omitís fecha, publica de inmediato. Sin zona horaria se usa la de Honduras.
    Para comprobar las imágenes sin publicar, usá verificar_imagenes_chat.
    """
    dt = _parse_fecha(fecha) if fecha is not None else None
    ts = _validar_programacion(dt) if dt is not None else None
    _pagina(pagina)  # falla antes de descargar si la página no está conectada
    async with _archivos_chat_en_curso:
        with TemporaryDirectory(prefix=".chat-", dir=DATA_DIR) as carpeta:
            recibidas = await _recibir_archivos_chat(imagenes, Path(carpeta))
            if dt is not None:
                ts = _validar_programacion(dt)
            nombres = []
            try:
                for ruta, _, _, _ in recibidas:
                    ruta.rename(BANDEJA / ruta.name)
                    nombres.append(ruta.name)
            except OSError:
                for nombre in nombres:
                    (BANDEJA / nombre).unlink(missing_ok=True)
                raise
        res = await _crear_post(texto, nombres, None, ts, pagina)
    return _resultado(res, dt)


EntradaArchivoChat = ArchivoChat | SkipJsonSchema[str]


@mcp.tool(
    meta={"openai/fileParams": ["imagen"]},
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=True),
)
async def verificar_imagen_chat(imagen: EntradaArchivoChat) -> str:
    """Comprueba UNA imagen adjunta en el chat (formato, tamaño, dimensiones). No publica nada.
    Pasá el archivo adjunto mismo en 'imagen'; nunca rutas /mnt/data ni sandbox:.
    """
    return await verificar_imagenes_chat([imagen])


@mcp.tool(
    meta={"openai/fileParams": ["imagen"]},
    annotations=ToolAnnotations(
        readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True,
    ),
)
async def publicar_imagen_chat(texto: str, imagen: EntradaArchivoChat, fecha: str | None = None,
                               pagina: Pagina = "tocoa") -> str:
    """Publica o programa un post con UNA imagen adjunta en el chat. Usala SOLO si el usuario pide
    publicar de forma explícita. Sin fecha publica ya; con fecha ('AAAA-MM-DD HH:MM', hora de
    Honduras) programa. pagina: 'tocoa' (por defecto) o 'floristeria' (si lo pide o es floral).
    Pasá el archivo adjunto mismo en 'imagen'; nunca rutas /mnt/data ni sandbox:.
    """
    return await programar_post_con_imagenes(texto, [imagen], fecha, pagina)


# ChatGPT solo convierte un adjunto en {download_url, file_id} si el esquema anunciado coincide
# EXACTAMENTE con la plantilla del Apps SDK (objeto con additionalProperties: false, sin campos
# extra). El esquema que genera pydantic agrega títulos y no pone additionalProperties, así que
# se reemplaza el esquema anunciado; la validación real sigue usando los tipos de arriba.
_OPENAI_FILE = {
    "type": "object",
    "properties": {
        "download_url": {"type": "string"},
        "file_id": {"type": "string"},
        "mime_type": {"type": "string"},
        "file_name": {"type": "string"},
    },
    "required": ["download_url", "file_id"],
    "additionalProperties": False,
}
_IMAGENES = {
    "type": "array",
    "items": {"$ref": "#/$defs/OpenAIFile"},
    "minItems": 1,
    "maxItems": 10,
    "description": "Las imágenes adjuntas en el chat (el archivo mismo). Nunca escribas rutas /mnt/data ni sandbox:.",
}
_PAGINA = {
    "type": "string",
    "enum": ["tocoa", "floristeria"],
    "description": "Opcional. 'floristeria' si el usuario lo pide (floristería, florería, flores) o el "
                   "contenido es floral (ramos, arreglos, insumos); si se omite, Multiplanet Tocoa.",
}


def _anunciar_esquema(nombre: str, propiedades: dict, requeridos: list[str]) -> None:
    mcp._tool_manager._tools[nombre].parameters = {
        "type": "object",
        "properties": propiedades,
        "required": requeridos,
        "additionalProperties": False,
        "$defs": {"OpenAIFile": _OPENAI_FILE},
    }


_anunciar_esquema("verificar_imagenes_chat", {"imagenes": _IMAGENES}, ["imagenes"])
_anunciar_esquema(
    "programar_post_con_imagenes",
    {
        "texto": {"type": "string", "description": "Texto completo del post."},
        "imagenes": _IMAGENES,
        "fecha": {
            "type": "string",
            "description": "Opcional. 'AAAA-MM-DD HH:MM' en hora de Honduras. Si se omite, publica ya.",
        },
        "pagina": _PAGINA,
    },
    ["texto", "imagenes"],
)
_IMAGEN = {"$ref": "#/$defs/OpenAIFile"}  # idéntico al ejemplo de la documentación del Apps SDK
_anunciar_esquema("verificar_imagen_chat", {"imagen": _IMAGEN}, ["imagen"])
_anunciar_esquema(
    "publicar_imagen_chat",
    {
        "texto": {"type": "string", "description": "Texto completo del post."},
        "imagen": _IMAGEN,
        "fecha": {
            "type": "string",
            "description": "Opcional. 'AAAA-MM-DD HH:MM' en hora de Honduras. Si se omite, publica ya.",
        },
        "pagina": _PAGINA,
    },
    ["texto", "imagen"],
)



@mcp.tool()
async def info_pagina(pagina: Pagina = "tocoa") -> str:
    """Muestra nombre, seguidores y enlace de una página ('tocoa' o 'floristeria'). Útil para verificar el token."""
    page_id, token, _ = _pagina(pagina)
    if DRY_RUN:
        return "Modo prueba (FB_DRY_RUN=1): no hay conexión real con Facebook."
    p = await _graph("GET", page_id, params={"fields": "name,followers_count,fan_count,link,category"},
                     token=token)
    return (f"Página: {p.get('name')} ({p.get('category', '')})\n"
            f"Seguidores: {p.get('followers_count', p.get('fan_count', '?'))}\n"
            f"Enlace: {p.get('link', '')}")


@mcp.tool()
def listar_imagenes() -> str:
    """Lista las fotos en la bandeja (subidas y aún no usadas) con tamaño y dimensiones."""
    filas = []
    for ruta in sorted(BANDEJA.iterdir(), key=lambda p: p.stat().st_mtime):
        if ruta.suffix.lower() not in EXTENSIONES:
            continue
        try:
            with PILImage.open(ruta) as im:
                dims = f"{im.width}x{im.height}"
        except Exception:
            dims = "?"
        subida = datetime.fromtimestamp(ruta.stat().st_mtime, TZ).strftime("%Y-%m-%d %H:%M")
        filas.append(f"- {ruta.name}  ({dims}, {ruta.stat().st_size // 1024} KB, subida {subida})")
    if not filas:
        return "La bandeja está vacía. Subí fotos en la página /subir del servidor."
    return f"{len(filas)} imagen(es) en la bandeja:\n" + "\n".join(filas)


@mcp.tool()
def ver_imagen(nombre: str) -> Image:
    """Devuelve una vista previa de una foto de la bandeja para poder describir el producto y escribir el texto del post."""
    ruta = _ruta_bandeja(nombre)
    with PILImage.open(ruta) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((768, 768))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=80)
    return Image(data=buf.getvalue(), format="jpeg")


@mcp.tool()
async def programar_post(texto: str, fecha: str, imagenes: list[str] | None = None,
                         link: str | None = None, pagina: Pagina = "tocoa") -> str:
    """Programa un post. Usala SOLO si el usuario pide programar de forma explícita.

    Args:
        texto: Texto completo del post (con emojis y hashtags si se quieren).
        fecha: Fecha y hora de publicación, ej. "2026-11-20 09:30". Sin zona = hora de Honduras.
               Debe estar entre 10 minutos y 30 días en el futuro.
        imagenes: Nombres de fotos de la bandeja (ver listar_imagenes). Hasta 10. Opcional.
        link: URL para compartir con vista previa (no se combina con imágenes). Opcional.
        pagina: 'tocoa' (por defecto) o 'floristeria' (si lo pide o el contenido es floral).
    """
    dt = _parse_fecha(fecha)
    ts = _validar_programacion(dt)
    res = await _crear_post(texto, imagenes or [], link, ts, pagina)
    return _resultado(res, dt)


@mcp.tool()
async def publicar_ahora(texto: str, imagenes: list[str] | None = None, link: str | None = None,
                         pagina: Pagina = "tocoa") -> str:
    """Publica un post de inmediato. Usala SOLO si el usuario pide publicar de forma explícita.

    Args:
        texto: Texto del post.
        imagenes: Nombres de fotos de la bandeja. Opcional, hasta 10.
        link: URL para compartir (no se combina con imágenes). Opcional.
        pagina: 'tocoa' (por defecto) o 'floristeria' (si lo pide o el contenido es floral).
    """
    res = await _crear_post(texto, imagenes or [], link, None, pagina)
    return _resultado(res, None)


@mcp.tool()
async def listar_programados(limite: int = 50, pagina: Pagina = "tocoa") -> str:
    """Lista los posts programados (pendientes) de una página ('tocoa' o 'floristeria'), por hora."""
    page_id, token, nombre = _pagina(pagina)
    res = await _graph("GET", f"{page_id}/scheduled_posts", params={
        "fields": "id,message,scheduled_publish_time,full_picture", "limit": str(min(limite, 100)),
    }, token=token)
    posts = sorted(res.get("data", []), key=lambda p: int(p.get("scheduled_publish_time") or 0))
    if not posts:
        return f"No hay posts programados en {nombre}."
    lineas = [f"{len(posts)} post(s) programados en {nombre}:"]
    for p in posts:
        texto = (p.get("message") or "").replace("\n", " ")
        foto = " [foto]" if p.get("full_picture") else ""
        lineas.append(f"- {_fmt_ts(p.get('scheduled_publish_time'))}{foto} · {p['id']} · {texto[:90]}")
    return "\n".join(lineas)


@mcp.tool()
async def reprogramar(post_id: str, fecha: str | None = None, texto: str | None = None,
                      pagina: Pagina | None = None) -> str:
    """Cambia la hora y/o el texto de un post que todavía está programado.

    Args:
        post_id: ID del post (de listar_programados).
        fecha: Nueva fecha y hora, ej. "2026-11-21 18:00". Opcional.
        texto: Nuevo texto. Opcional.
        pagina: Solo si el ID no indica la página. Normalmente se deduce sola.
    """
    if not fecha and texto is None:
        raise ValueError("Indicá una nueva fecha, un nuevo texto o ambos.")
    data: dict[str, str] = {}
    if fecha:
        data["scheduled_publish_time"] = str(_validar_programacion(_parse_fecha(fecha)))
    if texto is not None:
        data["message"] = texto
    token, nombre = _pagina_de_post(post_id, pagina)
    await _graph("POST", post_id, data=data, token=token)
    catalogo.actualizar_desde_meta(post_id, fecha=int(data["scheduled_publish_time"]) if fecha else None,
                                  texto=texto)
    _registrar({"accion": "reprogramado", "post_id": post_id, "pagina": nombre,
                **{k: v[:200] for k, v in data.items()}})
    return f"Post {post_id} de {nombre} actualizado."


@mcp.tool()
async def publicar_programado_ya(post_id: str, pagina: Pagina | None = None) -> str:
    """Publica inmediatamente un post que estaba programado. Solo si el usuario lo pide."""
    token, nombre = _pagina_de_post(post_id, pagina)
    await _graph("POST", post_id, data={"is_published": "true"}, token=token)
    catalogo.actualizar_desde_meta(post_id, estado="publicado", fecha=datetime.now(TZ).timestamp())
    _registrar({"accion": "adelantado", "post_id": post_id, "pagina": nombre})
    return f"Post {post_id} publicado ahora en {nombre}."


@mcp.tool()
async def borrar_post(post_id: str, pagina: Pagina | None = None) -> str:
    """Borra un post (programado o publicado). Es irreversible: confirmá con el usuario antes."""
    token, nombre = _pagina_de_post(post_id, pagina)
    await _graph("DELETE", post_id, token=token)
    catalogo.actualizar_desde_meta(post_id, estado="cancelado")
    _registrar({"accion": "borrado", "post_id": post_id, "pagina": nombre})
    return f"Post {post_id} de {nombre} borrado."


@mcp.tool()
async def posts_recientes(limite: int = 10, pagina: Pagina = "tocoa") -> str:
    """Lista los últimos posts de una página ('tocoa' o 'floristeria') para no repetir contenido."""
    page_id, token, nombre = _pagina(pagina)
    res = await _graph("GET", f"{page_id}/posts", params={
        "fields": "id,message,created_time,permalink_url", "limit": str(min(limite, 50)),
    }, token=token)
    posts = res.get("data", [])
    if not posts:
        return f"No hay posts recientes en {nombre}."
    lineas = []
    for p in posts:
        creado = p.get("created_time", "")[:16].replace("T", " ")
        texto = (p.get("message") or "").replace("\n", " ")
        lineas.append(f"- {creado} UTC · {texto[:90]} · {p.get('permalink_url', p['id'])}")
    return "\n".join(lineas)


# ---------------------------------------------------------------------------
# Página web para subir fotos (protegida con el mismo secreto)
# ---------------------------------------------------------------------------

PAGINA_SUBIR = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bandeja · Multiplanet</title>
<style>
body{{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;background:#0f1115;color:#e8e8e8}}
h1{{font-size:1.3rem}} .caja{{border:2px dashed #3a3f4b;border-radius:12px;padding:1.5rem;text-align:center}}
input[type=file]{{margin:1rem 0}} button{{background:#1877f2;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;font-size:1rem}}
ul{{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:.6rem}}
li{{font-size:.7rem;word-break:break-all}} img{{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px}}
.ok{{background:#14361f;padding:.6rem;border-radius:8px}}
</style></head><body>
<h1>Bandeja de fotos — Facebook Multiplanet</h1>
{mensaje}
<form class="caja" method="post" enctype="multipart/form-data">
<div>Elegí una o varias fotos</div>
<input type="file" name="fotos" accept="image/*" multiple required><br>
<button type="submit">Subir</button></form>
<h2 style="font-size:1rem">En la bandeja ({n})</h2><ul>{items}</ul>
</body></html>"""


@mcp.custom_route(f"/subir/{SECRET}", methods=["GET", "POST"], include_in_schema=False)
async def subir(request: Request):
    mensaje = ""
    if request.method == "POST":
        form = await request.form(max_files=100, max_part_size=25 * 1024 * 1024)
        guardadas = 0
        for archivo in form.getlist("fotos"):
            if not getattr(archivo, "filename", None):
                continue
            nombre = _nombre_seguro(archivo.filename)
            if Path(nombre).suffix.lower() not in EXTENSIONES:
                continue
            destino = BANDEJA / nombre
            i = 1
            while destino.exists():
                destino = BANDEJA / f"{Path(nombre).stem}-{i}{Path(nombre).suffix}"
                i += 1
            destino.write_bytes(await archivo.read())
            guardadas += 1
        return RedirectResponse(f"/subir/{SECRET}?ok={guardadas}", status_code=303)
    if "ok" in request.query_params:
        mensaje = f'<p class="ok">Listo: {html.escape(request.query_params["ok"])} foto(s) subidas.</p>'
    archivos = sorted((p for p in BANDEJA.iterdir() if p.suffix.lower() in EXTENSIONES),
                      key=lambda p: p.stat().st_mtime, reverse=True)
    items = "".join(
        f'<li><img src="/foto/{SECRET}/{html.escape(p.name)}" loading="lazy">{html.escape(p.name)}</li>'
        for p in archivos
    )
    return HTMLResponse(PAGINA_SUBIR.format(mensaje=mensaje, n=len(archivos), items=items))


@mcp.custom_route(f"/foto/{SECRET}/{{nombre}}", methods=["GET"], include_in_schema=False)
async def foto(request: Request):
    from starlette.responses import FileResponse
    try:
        return FileResponse(_ruta_bandeja(request.path_params["nombre"]))
    except ValueError:
        return JSONResponse({"error": "no existe"}, status_code=404)


PRIVACIDAD = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de privacidad</title>
<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.6}</style>
</head><body><h1>Política de privacidad — Publicador de Multiplanet</h1>
<p>Esta aplicación es una herramienta interna de Multiplanet (Barrio El Centro, Tocoa, Colón, Honduras)
que publica y programa contenido únicamente en la página de Facebook propia de la empresa.</p>
<p><b>Datos que usa:</b> el token de acceso de la página de Multiplanet y las imágenes y textos que el equipo
de Multiplanet sube para publicar. No recopila datos de usuarios de Facebook ni de visitantes.</p>
<p><b>Almacenamiento:</b> las imágenes y un registro de publicaciones se guardan en un servidor privado de la
empresa. No se venden ni se comparten con terceros.</p>
<p><b>Eliminación de datos:</b> como la app no guarda datos de otras personas, no hay datos de terceros que
eliminar. Para cualquier consulta, contactá a Multiplanet a través de su página de Facebook.</p>
</body></html>"""


@mcp.custom_route("/privacidad", methods=["GET"], include_in_schema=False)
async def privacidad(_: Request):
    return HTMLResponse(PRIVACIDAD)


@mcp.custom_route("/salud", methods=["GET"], include_in_schema=False)
async def salud(_: Request):
    return JSONResponse({"ok": True, "dry_run": DRY_RUN})


from catalogo_bridge import instalar as instalar_catalogo

catalogo, ciclo_catalogo, enviar_uno_catalogo = instalar_catalogo(mcp, sys.modules[__name__])


def crear_app():
    """La cola vive con la aplicación, independientemente de las sesiones MCP."""
    app = mcp.streamable_http_app()

    @asynccontextmanager
    async def vida_app(_):
        async with mcp.session_manager.run():
            async with vida_catalogo(app):
                yield

    app.router.lifespan_context = vida_app
    return app


if __name__ == "__main__":
    print(f"MCP escuchando en :{PORT}  (ruta /mcp/<secreto>, subida /subir/<secreto>)"
          + ("  [MODO PRUEBA]" if DRY_RUN else ""))
    import uvicorn
    # Un proceso: un único consumidor de la cola persistente.
    uvicorn.run(crear_app(), host=mcp.settings.host, port=PORT)
