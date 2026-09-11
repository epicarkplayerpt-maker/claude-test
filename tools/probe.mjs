import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT='/home/user/claude-test';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';
const f=join(ROOT,normalize(p).replace(/^(\.\.[/\\])+/,''));const d=await readFile(f);
res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end('x');}});
await new Promise(r=>server.listen(8124,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--autoplay-policy=no-user-gesture-required']});
const pg=await b.newPage({viewport:{width:1200,height:700}});
const logs=[];
pg.on('console',m=>{if(m.type()!=='log')logs.push(`[${m.type()}] ${m.text()}`)});
pg.on('pageerror',e=>logs.push(`[PAGEERROR] ${e.message}\n${(e.stack||'').split('\n').slice(0,5).join('\n')}`));
await pg.goto('http://127.0.0.1:8124/',{waitUntil:'load',timeout:90000});
try{ await pg.waitForFunction(()=>window.__ready===true,null,{timeout:150000}); }catch(e){ logs.push('[TIMEOUT] __ready never set'); }
console.log('boot logs:', logs.length?('\n'+logs.slice(0,20).join('\n')):'clean');
await b.close(); server.close();
