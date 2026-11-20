"""Supabase es la biblioteca; SQLite conserva solo caché, snapshots y la cola del MCP."""
from __future__ import annotations

import asyncio
import io
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from mcp.server.fastmcp import Image
from mcp.types import ToolAnnotations
from PIL import Image as PILImage, ImageOps

from catalogo import Catalogo

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True)


class Bridge:
    def __init__(self, s):
        self.s = s
        self.store = Catalogo(s.DATA_DIR, s.TZ, s.DRY_RUN)
        self.url = os.environ.get('CATALOGO_URL', '').rstrip('/')
        self.key = os.environ.get('CATALOGO_API_KEY', '')
        with self.store.conexion() as db:
            if 'not_before' not in {r[1] for r in db.execute('PRAGMA table_info(publicaciones)')}:
                db.execute('ALTER TABLE publicaciones ADD COLUMN not_before REAL NOT NULL DEFAULT 0')
            db.execute('CREATE TABLE IF NOT EXISTS bridge_outbox (id TEXT PRIMARY KEY, action TEXT, body TEXT)')
        self.lock = asyncio.Lock()

    async def api(self, action, data=None, files=None):
        parsed = httpx.URL(self.url)
        if (not self.key or len(self.key)<32 or not parsed.host or
            (parsed.scheme != 'https' and not (self.s.DRY_RUN and parsed.host in ('localhost','127.0.0.1')))):
            raise ValueError('Configurá CATALOGO_URL (HTTPS) y CATALOGO_API_KEY en el MCP.')
        try:
            async with httpx.AsyncClient(timeout=90, follow_redirects=False) as client:
                response = await client.post(self.url+'/api/catalogo/'+action,
                    headers={'Authorization':'Bearer '+self.key}, json=data if files is None else None, files=files)
            body = response.json()
        except (httpx.HTTPError, ValueError):
            raise ValueError('No se pudo contactar el catálogo. No vuelvas a enviar a Meta; revisá la agenda.') from None
        if response.status_code >= 400:
            raise ValueError(str(body.get('error','El catálogo rechazó la solicitud.')).replace(self.key,'[oculto]'))
        return body

    async def sync(self):
        data = await self.api('listar', {})
        categories = {c['id']:c for c in data['categories']}
        def manual(c, visited=None):
            if not c:
                return False
            visited = set() if visited is None else visited
            if c['id'] in visited:
                raise ValueError('Hay una categoría con un ciclo de subcategorías. Corregila en el catálogo.')
            visited.add(c['id'])
            name = c['name'].lower()
            floral = bool(re.search(r'flores|florer|florister|ramos|arreglos florales',name)) and not re.search(r'suministros|insumos|materiales',name)
            return bool(c.get('manual_only') or floral or manual(categories.get(c.get('parent_id')),visited))
        last = {}
        for h in data['history']:
            last[h['publication_id']] = max(last.get(h['publication_id'],0),datetime.fromisoformat(h['published_at'].replace('Z','+00:00')).timestamp())
        rest = timedelta(days=max(0,int(data.get('minimum_repeat_days',30)))).total_seconds()
        for slot in data['scheduled']:
            if slot['status']=='planned':
                last[slot['publication_id']] = max(last.get(slot['publication_id'],0),datetime.fromisoformat(slot['planned_for'].replace('Z','+00:00')).timestamp())
        with self.store.conexion(True) as db:
            db.execute('UPDATE publicaciones SET activa=0')
            db.execute("INSERT OR IGNORE INTO categorias VALUES ('sin-categoria','Sin categoría',NULL,0)")
            # Insertar primero sin padre permite cualquier orden del catálogo remoto.
            for c in categories.values():
                db.execute('INSERT INTO categorias(id,nombre,padre,automatica) VALUES (?,?,NULL,?) '
                           'ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre,automatica=excluded.automatica',
                           (c['id'],c['name'],int(not manual(c) and not c['is_archived'])))
            for c in categories.values():
                db.execute('UPDATE categorias SET padre=? WHERE id=?',(c.get('parent_id'),c['id']))
            for p in data['publications']:
                category = categories.get(p.get('category_id'))
                media = p.get('media',[])
                eligible = len(media)<=10 and all(m['mime_type'].startswith('image/') for m in media)
                values = (p['id'],p['title'],p['body'],p['category_id'] or 'sin-categoria',p.get('facebook_page','tocoa'),
                    json.dumps([m['id']+'.jpg' for m in media]),
                    int(category is not None and p.get('approved_for_batch',False) and not manual(category) and eligible),
                    int(p['status']!='archived' and (not category or not category['is_archived']) and eligible),p.get('valid_until'),p['created_at'],
                    last.get(p['id'],0)+rest if p['id'] in last else 0)
                db.execute('''INSERT INTO publicaciones
                    (id,titulo,texto,categoria,pagina,imagenes,automatica,activa,vence,creada,not_before)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                    titulo=excluded.titulo,texto=excluded.texto,categoria=excluded.categoria,pagina=excluded.pagina,
                    imagenes=excluded.imagenes,automatica=excluded.automatica,activa=excluded.activa,
                    vence=excluded.vence,not_before=excluded.not_before''',values)
        return data

    async def cache_image(self, name):
        path = self.store.media/name
        if path.is_file():
            return path
        asset = str(uuid.UUID(Path(name).stem))
        signed = await self.api('media',{'id':asset})
        url = httpx.URL(signed['url'])
        custom = os.environ.get('CATALOGO_MEDIA_HOST','')
        allowed = url.host.endswith('.supabase.co') or (custom and url.host==custom)
        if not allowed or url.scheme!='https' or url.userinfo or url.port not in (None,443):
            raise ValueError('La imagen debe venir del Storage de Supabase configurado.')
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            async with client.stream('GET',url) as response:
                response.raise_for_status()
                chunks=[]
                total=0
                async for chunk in response.aiter_bytes():
                    total+=len(chunk)
                    if total>self.s.MAX_BYTES_CHAT:
                        raise ValueError('La foto supera 25 MiB.')
                    chunks.append(chunk)
        with PILImage.open(io.BytesIO(b''.join(chunks))) as im:
            if im.width*im.height>self.s.MAX_PIXELES_CHAT:
                raise ValueError('La foto supera 12 millones de píxeles.')
            im=ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((2048,2048))
            temporary=self.store.media/(secrets.token_hex(16)+'.tmp')
            try:
                im.save(temporary,'JPEG',quality=93,optimize=True)
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
        return path

    async def cache_plan(self, plan):
        try:
            for row in self.store.agenda(plan):
                for name in row['contenido']['imagenes']:
                    await self.cache_image(name)
        except BaseException:
            self.store.cancelar(plan)
            raise
        return {'plan_id':plan,'estado':'borrador','publicaciones':self.store.agenda(plan)}

    async def save(self,titulo,texto,categoria,pagina,files,automatica,vence):
        ids=[]
        for path in files:
            datos,mime=self.s._preparar_imagen(path)
            asset=await self.api('subir',files={'foto':(path.name,datos,mime)})
            ids.append(asset['id'])
        content={'titulo':titulo,'texto':texto,'categoria':categoria,'pagina':pagina,
                 'imagenes':ids,'automatica':automatica,'vence':vence}
        request_id=str(uuid.uuid5(uuid.NAMESPACE_URL,self.url+json.dumps(content,sort_keys=True,ensure_ascii=False)))
        result=await self.api('guardar',{'id':request_id,**content})
        return {**result,'estado':'guardado','publicado':False}

    def receipt(self,row,state,post_id=None,error=None):
        with self.store.conexion(True) as db:
            db.execute('UPDATE agenda SET estado=?,post_id=?,error=? WHERE id=? AND estado=\'enviando\'',
                       (state,post_id,error,row['id']))
            if not self.s.DRY_RUN:
                body={'id':row['id'],'estado':'En Meta' if state=='meta' else 'Requiere revisión','post_id':post_id}
                db.execute('INSERT OR REPLACE INTO bridge_outbox VALUES (?,?,?)',
                           (row['id'],'entrega',json.dumps(body)))

    async def flush(self):
        with self.store.conexion() as db:
            receipts=[dict(r) for r in db.execute('SELECT * FROM bridge_outbox')]
        for receipt in receipts:
            await self.api(receipt['action'],json.loads(receipt['body']))
            with self.store.conexion(True) as db:
                db.execute('DELETE FROM bridge_outbox WHERE id=?',(receipt['id'],))

    async def send_one(self):
        row=self.store.reclamar(self.s.MAX_ANTICIPACION.days)
        if not row:
            return False
        try:
            if not self.s.DRY_RUN:
                slot=await self.api('slot',{'id':row['id']})
                if not slot or slot['status']!='planned' or abs(datetime.fromisoformat(slot['planned_for'].replace('Z','+00:00')).timestamp()-row['fecha'])>1:
                    raise ValueError('El calendario cambió o se canceló. Prepará un plan nuevo desde ChatGPT.')
            content=row['contenido']
            ts=self.s._validar_programacion(datetime.fromtimestamp(row['fecha'],self.s.TZ))
            pid,token,_=self.s._pagina(row['pagina'])
            data={'message':content['texto'],'published':'false','scheduled_publish_time':str(ts)}
            for i,name in enumerate(content['imagenes']):
                path=self.store.ruta_media(name)  # La copia aprobada ya está congelada en el MCP.
                datos,mime=self.s._preparar_imagen(path)
                photo=await self.s._graph('POST',f'{pid}/photos',data={'published':'false','temporary':'true'},files={'source':(name,datos,mime)},token=token)
                data[f'attached_media[{i}]']=json.dumps({'media_fbid':photo['id']})
            response=await self.s._graph('POST',f'{pid}/feed',data=data,token=token)
            if not response.get('id'):
                raise ValueError('Meta no devolvió un ID. Revisá Facebook antes de reintentar.')
            self.receipt(row,'simulado' if self.s.DRY_RUN else 'meta',response['id'])
        except Exception as exc:
            message=str(exc)
            for token in [*self.s.TOKENS,self.key]:
                if token:
                    message=message.replace(token,'[oculto]')
            self.receipt(row,'revisar',error=message[:500])
        return True

    async def reconcile(self):
        if self.s.DRY_RUN:
            return
        for row in self.store.agenda():
            if row['estado']!='meta' or row['fecha']>datetime.now(self.s.TZ).timestamp():
                continue
            _,token,_=self.s._pagina(row['pagina'])
            post=await self.s._graph('GET',row['post_id'],params={'fields':'is_published,created_time'},token=token)
            if not post.get('is_published'):
                continue
            await self.api('publicado',{'id':row['id'],'fecha':post.get('created_time') or datetime.fromtimestamp(row['fecha'],self.s.TZ).isoformat(),
                'texto':row['contenido']['texto'],'post_id':row['post_id']})
            with self.store.conexion(True) as db:
                db.execute("UPDATE agenda SET estado='publicado' WHERE id=?",(row['id'],))

    async def cycle(self):
        # El proceso puede morir tras enviar a Meta; nunca repetir ese envío.
        if not self.s.DRY_RUN:
            for row in self.store.agenda():
                if row['estado']=='revisar':
                    with self.store.conexion(True) as db:
                        db.execute('INSERT OR IGNORE INTO bridge_outbox VALUES (?,?,?)',(row['id'],'entrega',json.dumps({'id':row['id'],'estado':'Requiere revisión','post_id':row['post_id']})))
        while True:
            try:
                if self.url and self.key:
                    async with self.lock:
                        await self.flush()
                        while await self.send_one():
                            await self.flush()
                            await asyncio.sleep(.2)
                        await self.reconcile()
            except Exception:
                # Credenciales y URLs de archivos no van a logs; el detalle está en la agenda.
                self.s.logging.getLogger(__name__).warning('El puente del catálogo necesita revisión; no se repitieron envíos.')
            await asyncio.sleep(30)


def instalar(mcp,s):
    bridge=Bridge(s)
    store=bridge.store

    @mcp.tool(annotations=WRITE)
    async def inicializar_categorias_catalogo() -> dict:
        """Agrega los tipos de Multiplanet que falten, sin borrar ni reemplazar categorías existentes.
        Taller incluye computadoras e impresoras. Diseños de flores manual; suministros sí en lotes.
        """
        return await bridge.api('inicializar',{})

    @mcp.tool(annotations=READ)
    async def listar_categorias_catalogo() -> list[dict]:
        """Tipos reales de la biblioteca publicaciones2. Usá sus IDs para guardar y preparar lotes."""
        data=await bridge.sync()
        return data['categories']

    @mcp.tool(annotations=WRITE)
    async def crear_categoria_catalogo(nombre: str,padre: str | None=None,automatica: bool=True) -> dict:
        """Crea un tipo o subtipo compartido con la web. padre es el ID del tipo superior.
        automatica=False deja la categoría para selección manual. No publica nada.
        """
        return await bridge.api('categoria',{'nombre':nombre,'padre':padre,'automatica':automatica})

    @mcp.tool(annotations=READ)
    async def listar_catalogo(categoria: str | None=None,pagina: str | None=None) -> list[dict]:
        """Lee la biblioteca compartida con la web, nunca una biblioteca local independiente.
        Devuelve textos, nombres de fotos, aprobación, página y vigencia. No publica.
        """
        await bridge.sync()
        return [p for p in store.listar() if (not categoria or p['categoria']==categoria) and (not pagina or p['pagina']==pagina)]

    @mcp.tool(annotations=READ)
    async def ver_imagen_catalogo(nombre: str) -> Image:
        """Muestra una foto de listar_catalogo antes de redactar o aprobar su uso."""
        # El nombre es un UUID de Storage, no una ruta o URL arbitraria.
        path=await bridge.cache_image(str(uuid.UUID(Path(nombre).stem))+'.jpg')
        with PILImage.open(path) as im:
            im.thumbnail((768,768))
            buf=io.BytesIO()
            im.save(buf,'JPEG',quality=80)
        return Image(data=buf.getvalue(),format='jpeg')

    @mcp.tool(annotations=WRITE)
    async def guardar_publicacion_catalogo(titulo: str,texto: str,categoria: str,pagina: str='tocoa',
        imagenes: list[str] | None=None,automatica: bool=False,vence: str | None=None) -> dict:
        """Guarda texto y fotos de la bandeja EN LA BIBLIOTECA WEB. No publica.
        categoria: ID de listar_categorias_catalogo. automatica=True si el usuario aprueba para lotes.
        """
        if len(imagenes or [])>10:
            raise ValueError('Hasta 10 fotos.')
        return await bridge.save(titulo,texto,categoria,pagina,[s._ruta_bandeja(n) for n in imagenes or []],automatica,vence)

    async def guardar_publicacion_catalogo_con_imagenes(titulo: str,texto: str,categoria: str,imagenes,
        pagina: str='tocoa',automatica: bool=False,vence: str | None=None) -> dict:
        """Guarda fotos adjuntas del chat con su texto en publicaciones2. NO publica.
        Pasá los adjuntos mismos; nunca /mnt/data ni sandbox:. La web mostrará lo mismo.
        """
        async with s._archivos_chat_en_curso:
            with TemporaryDirectory(prefix='.catalogo-chat-',dir=s.DATA_DIR) as temp:
                files=await s._recibir_archivos_chat(imagenes,Path(temp))
                return await bridge.save(titulo,texto,categoria,pagina,[p for p,_,_,_ in files],automatica,vence)

    guardar_publicacion_catalogo_con_imagenes.__annotations__['imagenes']=s.EntradaArchivosChat
    mcp.add_tool(guardar_publicacion_catalogo_con_imagenes,meta=s.META_ARCHIVOS_CHAT,annotations=WRITE)
    s._anunciar_esquema('guardar_publicacion_catalogo_con_imagenes',{
        'titulo':{'type':'string'},'texto':{'type':'string'},'categoria':{'type':'string'},'imagenes':s._IMAGENES,
        'pagina':s._PAGINA,'automatica':{'type':'boolean'},'vence':{'type':'string'},
    },['titulo','texto','categoria','imagenes'])

    @mcp.tool(annotations=WRITE)
    async def actualizar_publicacion_catalogo(publicacion_id: str,cambios: dict) -> dict:
        """Edita el contenido de la biblioteca compartida sin cambiar snapshots ya aprobados.
        Campos: titulo,texto,categoria,pagina,imagenes (IDs/nombres del catálogo),automatica,vence,activa.
        """
        allowed={'titulo','texto','categoria','pagina','imagenes','automatica','vence','activa'}
        if set(cambios)-allowed:
            raise ValueError('Campos desconocidos.')
        await bridge.sync()
        p=next((p for p in store.listar() if p['id']==publicacion_id),None)
        if not p:
            raise ValueError('La publicación no existe.')
        p.update(cambios)
        return await bridge.api('editar',{'id':publicacion_id,**{k:p[k] for k in allowed},
            'automatica':bool(p['automatica']),'activa':bool(p['activa']),
            'imagenes':[str(uuid.UUID(Path(n).stem)) for n in p['imagenes']]})

    @mcp.tool(annotations=WRITE)
    async def preparar_lote_catalogo(categoria: str,cantidad: int,dias: int,inicio: str,
        horas: list[str] | None=None,pagina: str='tocoa') -> dict:
        """Saca X publicaciones del tipo pedido DIRECTAMENTE de publicaciones2 y las distribuye
        en X días. inicio AAAA-MM-DD, horas HH:MM Honduras. Usa aprobación, vigencia y descanso.
        No repite dentro del lote. Taller incluye subtipos. Flores manuales. No envía a Meta.
        MOSTRÁ textos, fotos y fechas; confirmar_plan_catalogo requiere aprobación expresa.
        """
        async with bridge.lock:
            await bridge.sync()
            plan=store.preparar_lote(categoria,cantidad,dias,inicio,horas,pagina)
            return await bridge.cache_plan(plan)

    @mcp.tool(annotations=WRITE)
    async def preparar_publicacion_catalogo(publicacion_id: str,fecha: str) -> dict:
        """Vista previa de UNA publicación de la biblioteca, también diseños de flores. No publica."""
        async with bridge.lock:
            await bridge.sync()
            return await bridge.cache_plan(store.preparar_individual(publicacion_id,fecha))

    @mcp.tool(annotations=ToolAnnotations(readOnlyHint=False,destructiveHint=False,idempotentHint=True,openWorldHint=True))
    async def confirmar_plan_catalogo(plan_id: str) -> dict:
        """SOLO tras aprobación expresa del usuario: registra el plan en el calendario de la web
        y activa la cola persistente para Meta. Sin el chat abierto; la VM debe estar encendida.
        Repetir con el mismo plan_id no duplica envíos. Consultá la agenda si se perdió una respuesta.
        """
        async with bridge.lock:
            rows=store.agenda(plan_id)
            if not rows:
                raise ValueError('El plan no existe.')
            for row in rows:
                s._pagina(row['pagina'])
            with store.conexion() as db:
                confirmed=db.execute("SELECT 1 FROM planes WHERE id=? AND estado='confirmado'",(plan_id,)).fetchone()
            if confirmed:
                return {'plan_id':plan_id,'estado':'confirmado','simulado':s.DRY_RUN}
            await bridge.sync()
            store.confirmar(plan_id,solo_validar=True)
            if not s.DRY_RUN:
                await bridge.api('confirmar',{'plan_id':plan_id,'jobs':[{'id':r['id'],
                    'publication_id':r['publicacion_id'],'planned_for':r['fecha_local'],'page':r['pagina'],
                    'snapshot':r['contenido']} for r in rows]})
            store.confirmar(plan_id)
            return {'plan_id':plan_id,'estado':'confirmado','simulado':s.DRY_RUN}

    @mcp.tool(annotations=READ)
    def listar_agenda_catalogo(plan_id: str | None=None) -> list[dict]:
        """Cola de ChatGPT: borrador, pendiente, meta, publicado, simulado o revisar.
        'meta' es programación aceptada por Meta. 'publicado' se confirma consultando Facebook.
        'revisar' nunca se reintenta solo: puede haber un envío aceptado antes del error.
        """
        return store.agenda(plan_id)

    @mcp.tool(annotations=WRITE)
    async def cancelar_plan_catalogo(plan_id: str) -> dict:
        """Cancela un plan sin enviar, tanto en el MCP como en la web. No borra posts de Facebook."""
        async with bridge.lock:
            rows=store.agenda(plan_id)
            if any(r['estado'] in ('enviando','meta','revisar') for r in rows):
                raise ValueError('Hay envíos a Meta o dudosos. Revisá sus IDs antes de cancelar.')
            if not s.DRY_RUN:
                await bridge.api('cancelar',{'plan_id':plan_id,'ids':[r['id'] for r in rows]})
            store.cancelar(plan_id)
            return {'plan_id':plan_id,'estado':'cancelado'}

    return store,bridge.cycle,bridge.send_one
