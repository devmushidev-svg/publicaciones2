import asyncio
import copy
import os
import sys
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from catalogo_bridge import Bridge

TZ=ZoneInfo('America/Tegucigalpa')


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.s=SimpleNamespace(DATA_DIR=Path(self.tmp.name),TZ=TZ,DRY_RUN=True,SECRET='secreto-existente-del-mcp-para-pruebas',
            MAX_ANTICIPACION=timedelta(days=30),TOKENS=[],_pagina=lambda _:('123','token','Tocoa'),
            _graph=AsyncMock(return_value={'id':'123_456'}),_validar_programacion=lambda dt:int(dt.timestamp()))
        self.bridge=Bridge(self.s)
        self.category=str(uuid.uuid4())
        self.data={'categories':[{'id':self.category,'name':'Visa americana','parent_id':None,'is_archived':False,'manual_only':False}],
            'publications':[],'history':[],'scheduled':[],'minimum_repeat_days':30}
        self.start=(datetime.now(TZ)+timedelta(days=1)).date().isoformat()
        self.bridge.api=AsyncMock(side_effect=self.api)

    async def api(self,action,data=None,files=None):
        if action=='listar': return copy.deepcopy(self.data)
        if action=='guardar': return {'id':'saved'}
        return {'ok':True}

    async def test_existing_mcp_secret_and_optional_dedicated_key(self):
        with patch.dict(os.environ, {'CATALOGO_API_KEY':''}):
            self.assertEqual(Bridge(self.s).key,self.s.SECRET)
        with patch.dict(os.environ, {'CATALOGO_API_KEY':'dedicated-catalogue-key-32-characters'}):
            self.assertEqual(Bridge(self.s).key,'dedicated-catalogue-key-32-characters')

    def add(self,n=1,category=None,**changes):
        for i in range(n):
            self.data['publications'].append({'id':str(uuid.uuid4()),'title':f'Copy {i}','body':f'Texto {i}',
                'category_id':category or self.category,'facebook_page':'tocoa','media':[],
                'approved_for_batch':True,'status':'draft','valid_until':None,
                'created_at':datetime.now(TZ).isoformat(),**changes})

    async def plan(self,n=1,dias=7):
        await self.bridge.sync()
        return self.bridge.store.preparar_lote(self.category,n,dias,self.start)

    async def test_43_come_from_shared_library_without_duplicates(self):
        self.add(43)
        plan=await self.plan(43,15)
        rows=self.bridge.store.agenda(plan)
        self.assertEqual({r['publicacion_id'] for r in rows},{p['id'] for p in self.data['publications']})
        self.assertEqual(len({r['fecha'] for r in rows}),43)
        self.assertEqual(len(rows),43)
        self.assertIsNone(self.bridge.store.reclamar(30))

    async def test_insufficient_content_rolls_back_preview(self):
        self.add()
        with self.assertRaises(ValueError): await self.plan(2)
        self.assertEqual(self.bridge.store.agenda(),[])

    async def test_web_edits_refresh_cache_and_missing_items_are_inactive(self):
        self.add()
        await self.bridge.sync()
        self.data['publications'][0]['body']='Editado en web'
        await self.bridge.sync()
        self.assertEqual(self.bridge.store.listar()[0]['texto'],'Editado en web')
        self.data['publications']=[]
        await self.bridge.sync()
        self.assertEqual(self.bridge.store.listar()[0]['activa'],0)

    async def test_flower_designs_and_children_are_manual_supplies_are_eligible(self):
        self.data['categories'][0]['name']='Diseños de flores'
        self.add()
        await self.bridge.sync()
        self.assertEqual(self.bridge.store.listar()[0]['automatica'],0)
        with self.assertRaises(ValueError): await self.plan()
        self.data['categories'][0]['name']='Suministros de arreglos florales'
        self.assertTrue(await self.plan())

    async def test_recent_usage_rest_and_expiry_are_enforced_at_planned_time(self):
        self.add()
        self.data['history']=[{'publication_id':self.data['publications'][0]['id'],'published_at':datetime.now(TZ).isoformat()}]
        with self.assertRaises(ValueError): await self.plan()
        self.start=(datetime.now(TZ)+timedelta(days=35)).date().isoformat()
        self.assertTrue(await self.plan())

    async def test_failed_or_interrupted_meta_send_cannot_retry(self):
        self.add()
        plan=await self.plan()
        self.bridge.store.confirmar(plan)
        self.s._graph.side_effect=RuntimeError('Timeout ambiguo')
        self.assertTrue(await self.bridge.send_one())
        self.assertFalse(await self.bridge.send_one())
        self.assertEqual(self.s._graph.await_count,1)
        self.assertEqual(self.bridge.store.agenda()[0]['estado'],'revisar')

    async def test_changed_calendar_never_sends_to_meta(self):
        self.add()
        plan=await self.plan()
        self.bridge.store.confirmar(plan)
        self.s.DRY_RUN=False
        self.bridge.store.simulado=False
        with self.bridge.store.conexion(True) as db: db.execute('UPDATE agenda SET simulado=0')
        self.bridge.api=AsyncMock(return_value={'status':'cancelled'})
        await self.bridge.send_one()
        self.s._graph.assert_not_called()
        self.assertEqual(self.bridge.store.agenda()[0]['estado'],'revisar')

    async def test_lost_delivery_receipt_is_durable_without_resending_meta(self):
        self.add()
        plan=await self.plan()
        self.bridge.store.confirmar(plan)
        self.s.DRY_RUN=False
        self.bridge.store.simulado=False
        with self.bridge.store.conexion(True) as db: db.execute('UPDATE agenda SET simulado=0')
        row=self.bridge.store.agenda()[0]
        self.bridge.api=AsyncMock(return_value={'status':'planned','planned_for':row['fecha_local']})
        await self.bridge.send_one()
        self.bridge.api.side_effect=ValueError('Servidor inaccesible')
        with self.assertRaises(ValueError): await self.bridge.flush()
        self.assertFalse(await self.bridge.send_one())
        self.assertEqual(self.s._graph.await_count,1)
        reopened=Bridge(self.s)
        reopened.api=AsyncMock(return_value={'ok':True})
        await reopened.flush()
        self.assertEqual(reopened.api.await_args.args[0],'entrega')
        with reopened.store.conexion() as db: self.assertEqual(db.execute('SELECT count(*) FROM bridge_outbox').fetchone()[0],0)

    async def test_saving_same_content_uses_same_request_after_response_loss(self):
        await self.bridge.save('Título','Copy',self.category,'tocoa',[],True,None)
        await self.bridge.save('Título','Copy',self.category,'tocoa',[],True,None)
        first,second=[c.args[1] for c in self.bridge.api.await_args_list]
        self.assertEqual(first['id'],second['id'])

    async def test_snapshot_is_preserved_after_shared_library_changes(self):
        self.add()
        plan=await self.plan()
        self.data['publications'][0]['body']='Nuevo texto'
        await self.bridge.sync()
        self.assertEqual(self.bridge.store.agenda(plan)[0]['contenido']['texto'],'Texto 0')


class MCPTests(unittest.TestCase):
    def test_legacy_and_catalogue_tools_register_with_attachment_schemas(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ,{'MCP_SECRET':'secreto-aislado-pruebas-mcp','FB_DRY_RUN':'1','DATA_DIR':temp}):
            import server
            tools={t.name:t for t in asyncio.run(server.mcp.list_tools())}
            for name in ('programar_post_con_imagenes','verificar_imagenes_chat','guardar_publicacion_catalogo_con_imagenes'):
                self.assertEqual(tools[name].meta['openai/fileParams'],['imagenes'])
                self.assertEqual(tools[name].inputSchema['properties']['imagenes']['maxItems'],10)
            self.assertIn('preparar_lote_catalogo',tools)
            self.assertIn('confirmar_plan_catalogo',tools)


if __name__=='__main__': unittest.main()
