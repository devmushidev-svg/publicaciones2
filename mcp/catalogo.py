"""Catálogo durable y planes locales. No depende de Facebook ni del SDK MCP."""
from __future__ import annotations

import json
import math
import re
import sqlite3
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, time
from pathlib import Path


CATEGORIAS = [
    ("visa-americana", "Visa americana", None, 1),
    ("taller", "Reparación de taller", None, 1),
    ("computadoras", "Computadoras", "taller", 1),
    ("impresoras", "Impresoras", "taller", 1),
    ("utiles-oficina", "Útiles de oficina", None, 1),
    ("utiles-escolares", "Útiles escolares", None, 1),
    ("suministros-florales", "Suministros de arreglos florales", None, 1),
    ("papeleria", "Papelería", None, 1),
    ("servicios-secretariales", "Servicios secretariales", None, 1),
    ("flores", "Diseños de flores", None, 0),
]


class Catalogo:
    def __init__(self, carpeta: Path, tz, simulado: bool = False):
        self.carpeta = carpeta
        self.media = carpeta / "catalogo-media"
        self.media.mkdir(parents=True, exist_ok=True)
        self.db = carpeta / "catalogo.sqlite3"
        self.tz = tz
        self.simulado = simulado
        with self.conexion() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS categorias (
                    id TEXT PRIMARY KEY, nombre TEXT NOT NULL,
                    padre TEXT REFERENCES categorias(id), automatica INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS publicaciones (
                    id TEXT PRIMARY KEY, titulo TEXT NOT NULL, texto TEXT NOT NULL,
                    categoria TEXT NOT NULL REFERENCES categorias(id), pagina TEXT NOT NULL,
                    imagenes TEXT NOT NULL, link TEXT, automatica INTEGER NOT NULL,
                    activa INTEGER NOT NULL DEFAULT 1, vence TEXT, creada TEXT NOT NULL, not_before REAL NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS planes (
                    id TEXT PRIMARY KEY, estado TEXT NOT NULL, creado TEXT NOT NULL,
                    simulado INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agenda (
                    id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES planes(id),
                    publicacion_id TEXT NOT NULL REFERENCES publicaciones(id),
                    fecha REAL NOT NULL, pagina TEXT NOT NULL, estado TEXT NOT NULL,
                    contenido TEXT NOT NULL, post_id TEXT, error TEXT,
                    simulado INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS agenda_fecha ON agenda(estado, fecha);
            """)
            db.executemany("INSERT OR IGNORE INTO categorias VALUES (?, ?, ?, ?)", CATEGORIAS)

    @contextmanager
    def conexion(self, escritura=False):
        db = sqlite3.connect(self.db, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            if escritura:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def ahora(self):
        return datetime.now(self.tz)

    def categorias(self):
        with self.conexion() as db:
            return [dict(r) for r in db.execute("SELECT * FROM categorias ORDER BY rowid")]

    def crear_categoria(self, nombre: str, padre: str | None = None, automatica: bool = True):
        nombre = nombre.strip()
        if not nombre or len(nombre) > 100:
            raise ValueError("Escribí un nombre de categoría de hasta 100 caracteres.")
        slug = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode().lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
        if not slug:
            raise ValueError("El nombre necesita letras o números.")
        with self.conexion(True) as db:
            if padre:
                superior = db.execute("SELECT * FROM categorias WHERE id=?", (padre,)).fetchone()
                if not superior:
                    raise ValueError("La categoría superior no existe.")
                automatica = automatica and bool(superior["automatica"])
            try:
                db.execute("INSERT INTO categorias VALUES (?, ?, ?, ?)", (slug, nombre, padre, int(automatica)))
            except sqlite3.IntegrityError:
                raise ValueError("Esa categoría ya existe.") from None
        return slug

    @staticmethod
    def _publicacion(r):
        p = dict(r)
        p["imagenes"] = json.loads(p["imagenes"])
        return p

    def listar(self):
        with self.conexion() as db:
            return [self._publicacion(r) for r in db.execute("SELECT * FROM publicaciones ORDER BY creada DESC")]

    def guardar(self, titulo: str, texto: str, categoria: str, pagina="tocoa", imagenes=None,
                link=None, automatica=False, vence=None, publicacion_id=None, activa=True):
        titulo, texto = titulo.strip(), texto.strip()
        imagenes = imagenes or []
        if not titulo or len(titulo) > 160:
            raise ValueError("El título es obligatorio y admite hasta 160 caracteres.")
        if len(texto) > 60000 or (not texto and not imagenes and not link):
            raise ValueError("La publicación necesita contenido; el texto admite hasta 60 000 caracteres.")
        if pagina not in ("tocoa", "floristeria"):
            raise ValueError("Página desconocida.")
        if link and not re.match(r"^https?://[^\s]+$", link):
            raise ValueError("El enlace debe comenzar con http:// o https://.")
        if len(imagenes) > 10 or (imagenes and link):
            raise ValueError("Elegí hasta 10 imágenes o un enlace, sin combinarlos.")
        for nombre in imagenes:
            self.ruta_media(nombre)
        if vence:
            try:
                vence = datetime.strptime(vence, "%Y-%m-%d").date().isoformat()
            except (TypeError, ValueError):
                raise ValueError("La vigencia debe ser AAAA-MM-DD.") from None
        pid = publicacion_id or uuid.uuid4().hex
        with self.conexion(True) as db:
            c = db.execute("SELECT * FROM categorias WHERE id=?", (categoria,)).fetchone()
            if not c:
                raise ValueError("Seleccioná una categoría existente.")
            automatica = bool(automatica and c["automatica"])
            valores = (titulo, texto, categoria, pagina, json.dumps(imagenes), link or None,
                       int(automatica), int(activa), vence, pid)
            if publicacion_id:
                if not db.execute("SELECT 1 FROM publicaciones WHERE id=?", (pid,)).fetchone():
                    raise ValueError("La publicación ya no existe.")
                db.execute("""UPDATE publicaciones SET titulo=?,texto=?,categoria=?,pagina=?,imagenes=?,
                    link=?,automatica=?,activa=?,vence=? WHERE id=?""", valores)
            else:
                db.execute("""INSERT INTO publicaciones
                    (titulo,texto,categoria,pagina,imagenes,link,automatica,activa,vence,id,creada)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (*valores, self.ahora().isoformat()))
        return pid

    def ruta_media(self, nombre: str):
        ruta = (self.media / nombre).resolve()
        if ruta.parent != self.media.resolve() or not ruta.is_file():
            raise ValueError("La imagen del catálogo no existe.")
        return ruta

    def _fecha(self, valor: str):
        try:
            dt = datetime.fromisoformat(valor.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            raise ValueError("Usá una fecha AAAA-MM-DD HH:MM.") from None
        return dt.replace(tzinfo=self.tz) if dt.tzinfo is None else dt.astimezone(self.tz)

    def _insertar_plan(self, db, seleccion):
        plan = uuid.uuid4().hex
        db.execute("INSERT INTO planes VALUES (?, 'borrador', ?, ?)",
                   (plan, self.ahora().isoformat(), int(self.simulado)))
        for p, fecha in seleccion:
            db.execute("""INSERT INTO agenda
                (id,plan_id,publicacion_id,fecha,pagina,estado,contenido,simulado)
                VALUES (?,?,?,?,?,'borrador',?,?)""",
                (uuid.uuid4().hex, plan, p["id"], fecha.timestamp(), p["pagina"],
                 json.dumps(p, ensure_ascii=False), int(self.simulado)))
        return plan

    def _libre(self, db, pagina, fecha):
        return not db.execute("""SELECT 1 FROM agenda WHERE pagina=? AND fecha=?
            AND estado IN ('borrador','pendiente','enviando','meta','revisar','simulado')
            AND simulado=?""", (pagina, fecha.timestamp(), int(self.simulado))).fetchone()

    def preparar_lote(self, categoria: str, cantidad: int, dias: int, inicio: str,
                      horas: list[str] | None = None, pagina="tocoa"):
        if not 1 <= cantidad <= 500 or not 1 <= dias <= 365:
            raise ValueError("Elegí de 1 a 500 publicaciones y de 1 a 365 días.")
        if pagina not in ("tocoa", "floristeria"):
            raise ValueError("Página desconocida.")
        try:
            dia = datetime.strptime(inicio, "%Y-%m-%d").date()
            relojes = sorted({time.fromisoformat(h) for h in (horas or ["09:00", "12:00", "15:00", "18:00"])})
            if any(h.tzinfo or h.second or h.microsecond for h in relojes) or len(relojes) > 24:
                raise ValueError()
        except (TypeError, ValueError):
            raise ValueError("Inicio AAAA-MM-DD y hasta 24 horarios HH:MM, sin zona horaria.") from None
        if dia < self.ahora().date() or dia + timedelta(days=dias - 1) > (self.ahora() + timedelta(days=365)).date():
            raise ValueError("El período debe estar entre hoy y los próximos 365 días.")
        with self.conexion(True) as db:
            c = db.execute("SELECT * FROM categorias WHERE id=?", (categoria,)).fetchone()
            if not c or not c["automatica"]:
                raise ValueError("Esta categoría requiere elegir y programar cada diseño manualmente.")
            categorias = [r[0] for r in db.execute("""WITH RECURSIVE arbol(id) AS (
                SELECT id FROM categorias WHERE id=? UNION ALL
                SELECT c.id FROM categorias c JOIN arbol a ON c.padre=a.id)
                SELECT id FROM arbol""", (categoria,))]
            candidatas = [self._publicacion(r) for r in db.execute("""SELECT p.* FROM publicaciones p
                JOIN categorias c ON c.id=p.categoria WHERE p.activa=1 AND p.automatica=1
                AND c.automatica=1 AND p.pagina=? AND NOT EXISTS (
                    SELECT 1 FROM agenda a WHERE a.publicacion_id=p.id AND a.simulado=?
                    AND a.estado IN ('borrador','pendiente','enviando','meta','revisar','simulado'))
                ORDER BY COALESCE(p.vence, '9999-12-31'), p.creada""", (pagina, int(self.simulado)))
                if r["categoria"] in categorias]
            slots = [datetime.combine(dia + timedelta(days=d), h, self.tz)
                     for d in range(dias) for h in relojes]
            slots = [s for s in slots if s >= self.ahora() + timedelta(minutes=20)
                     and self._libre(db, pagina, s)]
            if len(slots) < cantidad:
                raise ValueError(f"Solo hay {len(slots)} horarios libres. Ampliá los días o los horarios.")
            elegidos = [slots[math.floor(i * (len(slots) - 1) / (cantidad - 1))]
                        for i in range(cantidad)] if cantidad > 1 else slots[:1]
            seleccion = []
            for fecha in elegidos:
                p = next((p for p in candidatas if (not p["vence"] or p["vence"] >= fecha.date().isoformat()) and p.get("not_before", 0) <= fecha.timestamp()), None)
                if p is None:
                    raise ValueError(f"No hay {cantidad} publicaciones distintas, vigentes y aptas para este lote. "
                                     f"Se pudieron elegir {len(seleccion)}; agregá contenido o reducí la cantidad.")
                candidatas.remove(p)
                seleccion.append((p, fecha))
            return self._insertar_plan(db, seleccion)

    def preparar_individual(self, publicacion_id: str, fecha: str):
        dt = self._fecha(fecha)
        if not self.ahora() + timedelta(minutes=20) <= dt <= self.ahora() + timedelta(days=365):
            raise ValueError("Elegí una fecha entre 20 minutos y 365 días adelante.")
        with self.conexion(True) as db:
            r = db.execute("SELECT * FROM publicaciones WHERE id=? AND activa=1", (publicacion_id,)).fetchone()
            if not r:
                raise ValueError("La publicación no existe o está archivada.")
            p = self._publicacion(r)
            if p["vence"] and p["vence"] < dt.date().isoformat():
                raise ValueError("La publicación vence antes de esa fecha.")
            if not self._libre(db, p["pagina"], dt):
                raise ValueError("Ese horario ya está ocupado en esa página.")
            return self._insertar_plan(db, [(p, dt)])

    def agenda(self, plan_id=None):
        with self.conexion() as db:
            filas = db.execute("SELECT * FROM agenda" + (" WHERE plan_id=?" if plan_id else "")
                               + " ORDER BY fecha", (plan_id,) if plan_id else ())
            resultado = []
            for r in filas:
                p = dict(r)
                p["contenido"] = json.loads(p["contenido"])
                p["fecha_local"] = datetime.fromtimestamp(p["fecha"], self.tz).isoformat(timespec="minutes")
                resultado.append(p)
            return resultado

    def confirmar(self, plan_id, solo_validar=False):
        with self.conexion(True) as db:
            plan = db.execute("SELECT * FROM planes WHERE id=?", (plan_id,)).fetchone()
            if not plan:
                raise ValueError("El plan no existe.")
            if plan["simulado"] != int(self.simulado):
                raise ValueError("Este plan pertenece a otro modo de ejecución. Prepará uno nuevo.")
            if plan["estado"] == "confirmado":
                return  # Confirmar dos veces no duplica la cola.
            if plan["estado"] != "borrador":
                raise ValueError("El plan ya fue cancelado.")
            filas = db.execute("""SELECT a.*,p.activa,p.vence FROM agenda a
                JOIN publicaciones p ON p.id=a.publicacion_id WHERE a.plan_id=?""", (plan_id,)).fetchall()
            for r in filas:
                dt = datetime.fromtimestamp(r["fecha"], self.tz)
                if dt < self.ahora() + timedelta(minutes=15):
                    raise ValueError("Un horario está demasiado cerca o ya pasó. Cancelá el borrador y prepará otro.")
                if not r["activa"] or (r["vence"] and r["vence"] < dt.date().isoformat()):
                    raise ValueError("Hay contenido archivado o vencido. Prepará un plan nuevo.")
            if solo_validar:
                return
            db.execute("UPDATE planes SET estado='confirmado' WHERE id=?", (plan_id,))
            db.execute("UPDATE agenda SET estado='pendiente' WHERE plan_id=? AND estado='borrador'", (plan_id,))

    def cancelar(self, plan_id):
        with self.conexion(True) as db:
            if not db.execute("SELECT 1 FROM planes WHERE id=?", (plan_id,)).fetchone():
                raise ValueError("El plan no existe.")
            if db.execute("SELECT 1 FROM agenda WHERE plan_id=? AND estado IN ('enviando','meta','revisar')",
                          (plan_id,)).fetchone():
                raise ValueError("Hay envíos a Meta o envíos por revisar. Cancelá los posts en Meta por su ID; "
                                 "este botón solo cancela planes locales sin enviar.")
            db.execute("UPDATE agenda SET estado='cancelado' WHERE plan_id=? AND estado IN ('borrador','pendiente')",
                       (plan_id,))
            db.execute("UPDATE planes SET estado='cancelado' WHERE id=?", (plan_id,))

    def recuperar_interrumpidos(self):
        with self.conexion(True) as db:
            db.execute("""UPDATE agenda SET estado='revisar',error='El servidor se reinició durante el envío. '
                || 'Comprobá en Facebook antes de volver a programar.' WHERE estado='enviando'""")

    def reclamar(self, max_dias: int, min_minutos=12):
        """Una transacción reserva cada envío; los errores ambiguos nunca se reintentan solos."""
        ahora = self.ahora().timestamp()
        with self.conexion(True) as db:
            db.execute("""UPDATE agenda SET estado='vencido', error='El servidor no alcanzó a enviarlo '
                || 'con anticipación. Elegí una nueva fecha.'
                WHERE estado='pendiente' AND fecha<? AND simulado=?""",
                (ahora + min_minutos * 60, int(self.simulado)))
            r = db.execute("""SELECT * FROM agenda WHERE estado='pendiente' AND fecha<=? AND simulado=?
                ORDER BY fecha LIMIT 1""", (ahora + max_dias * 86400 - 60, int(self.simulado))).fetchone()
            if not r:
                return None
            db.execute("UPDATE agenda SET estado='enviando',error=NULL WHERE id=?", (r["id"],))
            p = dict(r)
            p["contenido"] = json.loads(p["contenido"])
            return p

    def terminar(self, agenda_id, estado, post_id=None, error=None):
        with self.conexion(True) as db:
            db.execute("UPDATE agenda SET estado=?,post_id=?,error=? WHERE id=? AND estado='enviando'",
                       (estado, post_id, error, agenda_id))

    def actualizar_desde_meta(self, post_id, *, estado=None, fecha=None, texto=None):
        """Mantiene la agenda consistente con cambios hechos por las herramientas originales."""
        with self.conexion(True) as db:
            for r in db.execute("SELECT * FROM agenda WHERE post_id=?", (post_id,)).fetchall():
                contenido = json.loads(r["contenido"])
                if texto is not None:
                    contenido["texto"] = texto
                db.execute("UPDATE agenda SET estado=?,fecha=?,contenido=? WHERE id=?",
                           (estado or r["estado"], fecha if fecha is not None else r["fecha"],
                            json.dumps(contenido, ensure_ascii=False), r["id"]))
                if not self.simulado and db.execute("SELECT 1 FROM sqlite_master WHERE name='bridge_outbox'").fetchone():
                    action, body = None, None
                    if estado == 'cancelado':
                        action, body = 'cancelar', {'plan_id':r['plan_id'],'ids':[r['id']]}
                    elif estado == 'publicado':
                        action, body = 'publicado', {'id':r['id'],'fecha':datetime.fromtimestamp(fecha or self.ahora().timestamp(),self.tz).isoformat(),
                                                    'texto':contenido['texto'],'post_id':post_id}
                    elif fecha is not None:
                        action, body = 'mover', {'id':r['id'],'fecha':datetime.fromtimestamp(fecha,self.tz).isoformat()}
                    if action:
                        db.execute('INSERT OR REPLACE INTO bridge_outbox VALUES (?,?,?)',(r['id'],action,json.dumps(body)))
