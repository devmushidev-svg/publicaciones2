"""QA local con Supabase simulado y Edge; no usa datos ni tokens de producción.
Ejecutar con un Python con playwright instalado. El resto de la aplicación es real.
"""
import base64
import json
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'
OUT.mkdir(exist_ok=True)
OWNER='11111111-1111-4111-8111-111111111111'
KEY='private-browser-test-key-over-thirty-two-characters'
API_KEY='bridge-browser-test-key-over-thirty-two-characters'
CAT='22222222-2222-4222-8222-222222222222'
now=datetime.now(timezone.utc).isoformat()
USER={'id':OWNER,'email':'qa@example.test','aud':'authenticated','role':'authenticated',
      'app_metadata':{'provider':'email'},'user_metadata':{'full_name':'Multiplanet · Prueba'},'created_at':now}
def enc(data): return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')
TOKEN=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':OWNER,'role':'authenticated','aud':'authenticated','exp':int(time.time())+3600})+'.'+('a'*43)
SESSION={'access_token':TOKEN,'refresh_token':'test-refresh-token','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':USER}
TABLES={
    'profiles':[{'id':OWNER,'full_name':'Multiplanet · Prueba','timezone':'America/Tegucigalpa'}],
    'account_preferences':[{'user_id':OWNER,'timezone':'America/Tegucigalpa','week_starts_on':1,'email_digest':False}],
    'recommendation_settings':[{'user_id':OWNER,'posts_per_day':3,'minimum_repeat_days':14,'balance_window_days':14}],
    'categories':[{'id':CAT,'user_id':OWNER,'name':'Visa americana','color':'#71866f','is_archived':False,'manual_only':False,'parent_id':None}],
    'publications':[],'publication_media':[],'publication_tags':[],'media_assets':[],
    'publication_history':[],'ideas':[],'performance_metrics':[],'social_connections':[],
    'category_preferences':[],'ai_copy_generations':[],'scheduled_posts':[],'campaigns':[],
}
for i,title in enumerate(['Asesoría para tu visa americana','Documentos para tu trámite','Prepará tu entrevista']):
    TABLES['publications'].append({'id':str(uuid.uuid4()),'user_id':OWNER,'title':title,'body':'Contenido de prueba del catálogo compartido.',
        'category_id':CAT,'categories':{'name':'Visa americana'},'status':'draft','approved_for_batch':True,'valid_until':None,
        'facebook_page':'tocoa','scheduled_for':None,'published_at':None,'platforms':['facebook'],'created_at':now})

class Supabase(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def output(self,data,status=200):
        raw=json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers',self.headers.get('Access-Control-Request-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version'))
        self.send_header('Access-Control-Allow-Methods','GET,POST,HEAD,OPTIONS')
        self.send_header('Content-Range',f'0-{max(0,len(data)-1) if isinstance(data,list) else 0}/{len(data) if isinstance(data,list) else 1}')
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        if self.command!='HEAD': self.wfile.write(raw)
    def do_OPTIONS(self): self.output({})
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/auth/v1/'):
            return self.output(USER)
        table=parsed.path.split('/')[-1]
        rows=TABLES.get(table,[])
        query=urllib.parse.parse_qs(parsed.query)
        for key,values in query.items():
            if key not in ('select','order','limit','offset') and values[0].startswith('eq.'):
                value=values[0][3:]
                rows=[r for r in rows if str(r.get(key)).lower()==value.lower()]
        if 'application/vnd.pgrst.object+json' in self.headers.get('Accept',''):
            return self.output(rows[0] if rows else None)
        return self.output(rows)
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}')
        path=urllib.parse.urlparse(self.path).path
        if path=='/auth/v1/admin/generate_link':
            return self.output({**USER,'action_link':'http://localhost/test','email_otp':'123456','hashed_token':'test-hashed-token',
                                'verification_type':'magiclink','redirect_to':'http://localhost/'})
        if path in ('/auth/v1/verify','/auth/v1/token'): return self.output(SESSION)
        if path.startswith('/storage/v1/object/list/'): return self.output([])
        if path.endswith('/rpc/save_my_catalogue_publication'):
            pid=data['p_id'] or str(uuid.uuid4())
            row=next((p for p in TABLES['publications'] if p['id']==pid),None)
            if not row:
                row={'id':pid,'user_id':OWNER,'created_at':now,'scheduled_for':None,'published_at':None}
                TABLES['publications'].append(row)
            row.update({'title':data['p_title'],'body':data['p_body'],'category_id':data['p_category_id'],
                'categories':{'name':'Visa americana'},'status':data['p_status'],'platforms':data['p_platforms'],
                'approved_for_batch':data['p_approved_for_batch'],'valid_until':data['p_valid_until'],'facebook_page':data['p_facebook_page']})
            return self.output(pid)
        return self.output({'message':'Unexpected mock endpoint: '+path},400)

def post(url,data,key=None):
    headers={'Content-Type':'application/json'}
    if key: headers['Authorization']='Bearer '+key
    req=urllib.request.Request(url,json.dumps(data).encode(),headers=headers)
    return urllib.request.urlopen(req,timeout=30)

supabase=ThreadingHTTPServer(('127.0.0.1',0),Supabase)
thread=threading.Thread(target=supabase.serve_forever,daemon=True)
thread.start()
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
base=f'http://127.0.0.1:{port}'
env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{supabase.server_port}',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'sb_publishable_test','SUPABASE_SECRET_KEY':'server-only-test',
    'CATALOG_OWNER_ID':OWNER,'CATALOG_ACCESS_KEY':KEY,'CATALOG_API_KEY':API_KEY,'NEXT_PUBLIC_SITE_URL':base}
log=(OUT/'web-server.log').open('w',encoding='utf-8')
process=subprocess.Popen(['node',str(ROOT/'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
try:
    for _ in range(120):
        try: urllib.request.urlopen(base+'/login',timeout=1); break
        except urllib.error.HTTPError: break
        except OSError:
            if process.poll() is not None: raise RuntimeError('Next terminó antes de iniciar.')
            time.sleep(.25)
    try: post(base+'/api/catalogo/listar',{})
    except urllib.error.HTTPError as error: assert error.code==401
    else: raise AssertionError('API pública sin clave')
    with sync_playwright() as p:
        edge=Path(os.environ.get('PROGRAMFILES(X86)',r'C:\Program Files (x86)'))/'Microsoft/Edge/Application/msedge.exe'
        browser=p.chromium.launch(executable_path=str(edge),headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        console_errors=[]
        failed_requests=[]
        redirects=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:console_errors.append(m.text) if m.type=='error' else None)
        page.on('requestfailed',lambda r:failed_requests.append({'url':r.url,'error':r.failure}))
        page.on('response',lambda r:redirects.append({'url':r.url,'location':r.headers.get('location'),'cookie':r.headers.get('set-cookie')}) if r.status in (307,302) else None)
        response=page.goto(base+'/access/'+KEY,wait_until='networkidle',timeout=120000)
        assert response.status==200, {'body':page.locator('body').inner_text(),'url':page.url,'redirects':redirects,'cookies':page.context.cookies()}
        page.get_by_role('heading',name='Biblioteca',exact=True).wait_for()
        assert page.get_by_label('Contraseña',exact=True).count()==0
        page.screenshot(path=str(OUT/'biblioteca-chatgpt.png'),full_page=False)
        page.wait_for_function("Array.from(document.querySelectorAll('button')).some(el=>el.textContent.includes('Nueva publicación') && Object.keys(el).some(key=>key.startsWith('__reactProps$')))")
        page.get_by_role('button',name='Nueva publicación',exact=True).click()
        assert not errors,errors
        dialog=page.locator('dialog[open]').filter(has=page.locator('#publication-dialog-title'))
        dialog.locator('[name="title"]').fill('Creada desde la web')
        dialog.locator('[name="body"]').fill('El MCP debe leer este mismo contenido.')
        dialog.locator('[name="category_id"]').select_option(CAT)
        dialog.locator('[name="approved_for_batch"]').check()
        dialog.locator('[name="facebook_page"]').select_option('tocoa')
        dialog.get_by_role('button',name='Guardar publicación',exact=True).click()
        dialog.wait_for(state='hidden')
        page.get_by_text('Creada desde la web',exact=True).wait_for()
        response=json.load(post(base+'/api/catalogo/listar',{},API_KEY))
        assert any(p['title']=='Creada desde la web' and p['approved_for_batch'] for p in response['publications'])
        page.goto(base+'/login',wait_until='networkidle')
        page.get_by_role('heading',name='Biblioteca',exact=True).wait_for()
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(OUT/'biblioteca-mobile.png'),full_page=False)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        browser.close()
    print('OK: enlace privado sin login, cookie de dueño, biblioteca, guardar con aprobación y lectura por la API del MCP; móvil sin desbordamiento.')
finally:
    subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    process.wait(timeout=15)
    supabase.shutdown()
    log.close()
