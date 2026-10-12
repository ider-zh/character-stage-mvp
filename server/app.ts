import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { Character, Job, Lease, StageState, ServerMessage } from '../src/types.ts';
import { InputError, MAX_UPLOAD_BYTES, validName, validateImage } from './images.ts';
import { getSeeds } from './seeds.ts';

export interface ServerOptions {
 dataDir: string; port?: number; host?: string; seed?: boolean; leaseMs?: number; staticDir?: string;
 allowedOrigins?: string[]; uploadPerMinute?: number; wsPerSecond?: number; cookieSecure?: boolean;
}
type JobRow = Job & {name:string;pendingFile:string;width:number;height:number};
type Peer = {id:string;session:string;ip:string;alive:boolean;tokens:number;updated:number};
const uuidRe=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
class Limiter {
 private buckets=new Map<string,{count:number;until:number}>();
 take(key:string,max:number,window=60_000){
  const now=Date.now();let b=this.buckets.get(key);
  if(!b||b.until<=now){b={count:0,until:now+window};this.buckets.set(key,b);}
  if(this.buckets.size>5000)for(const[k,v]of this.buckets)if(v.until<=now)this.buckets.delete(k);
  return ++b.count<=max;
 }
}
export async function createStageServer(options:ServerOptions){
 const dataDir=path.resolve(options.dataDir),assetDir=path.join(dataDir,'assets'),pendingDir=path.join(dataDir,'pending');
 await Promise.all([mkdir(assetDir,{recursive:true}),mkdir(pendingDir,{recursive:true})]);
 const db=new DatabaseSync(path.join(dataDir,'stage.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS characters(id TEXT PRIMARY KEY,name TEXT NOT NULL,assetUrl TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,x REAL NOT NULL,y REAL NOT NULL,createdAt INTEGER NOT NULL,mode TEXT NOT NULL,source TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,status TEXT NOT NULL,characterId TEXT,error TEXT,createdAt INTEGER NOT NULL,name TEXT NOT NULL,pendingFile TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY,expiresAt INTEGER NOT NULL);
 `);
 const insertCharacter=db.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?,?)');
 const insert=(c:Character)=>insertCharacter.run(c.id,c.name,c.assetUrl,c.width,c.height,c.x,c.y,c.createdAt,c.mode,c.source);
 if(options.seed!==false && Number((db.prepare('SELECT count(*) n FROM characters').get() as {n:number}).n)===0){
  for(const seed of await getSeeds()){
   await writeFile(path.join(assetDir,`${seed.id}.png`),seed.png,{mode:0o600});
   insert({id:seed.id,name:seed.name,assetUrl:`/assets/${seed.id}.png`,width:512,height:512,x:seed.x,y:seed.y,createdAt:Date.now(),mode:'basic',source:'seed'});
  }
 }
 const characters=()=>db.prepare('SELECT * FROM characters ORDER BY createdAt,id').all() as unknown as Character[];
 const character=(id:string)=>db.prepare('SELECT * FROM characters WHERE id=?').get(id) as unknown as Character|undefined;
 const job=(id:string)=>db.prepare('SELECT id,status,characterId,error,createdAt FROM jobs WHERE id=?').get(id) as unknown as Job;
 const jobs=()=>db.prepare('SELECT id,status,characterId,error,createdAt FROM jobs ORDER BY createdAt DESC LIMIT 50').all() as unknown as Job[];
 const peers=new Map<WebSocket,Peer>(),leases=new Map<string,Lease>(), limiter=new Limiter();
 const leaseMs=options.leaseMs??4000,wsRate=options.wsPerSecond??40;
 let closing=false,activeUploads=0,workerRunning=false;
 const workerTasks=new Set<Promise<void>>();
 const wss=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false});
 const send=(ws:WebSocket,msg:ServerMessage)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<1_000_000)ws.send(JSON.stringify(msg));else if(ws.bufferedAmount>=1_000_000)ws.terminate();};
 const broadcast=(msg:ServerMessage)=>{for(const ws of peers.keys())send(ws,msg);};
 const release=(id:string)=>{if(leases.delete(id))broadcast({type:'lease',characterId:id,lease:null});};
 const expire=()=>{const now=Date.now();for(const[id,l]of leases)if(l.expiresAt<=now)release(id);};
 const snapshot=():StageState=>{expire();return {characters:characters(),jobs:jobs(),leases:[...leases.values()],online:peers.size};};
 const publicJob=(id:string)=>broadcast({type:'job',job:job(id)});
 async function processJobs(){
  if(workerRunning||closing)return;workerRunning=true;
  try {
   while(!closing){
    const row=db.prepare("SELECT * FROM jobs WHERE status IN ('queued','processing') ORDER BY createdAt LIMIT 1").get() as unknown as JobRow|undefined;
    if(!row)break;
    db.prepare("UPDATE jobs SET status='processing' WHERE id=?").run(row.id);publicJob(row.id);
    try {
     const id=row.characterId??randomUUID(),target=path.join(assetDir,`${id}.png`);
     try{await rename(path.join(pendingDir,row.pendingFile),target);}catch(err){if(!(await stat(target).catch(()=>null)))throw err;}
     const c:Character={id,name:row.name,assetUrl:`/assets/${id}.png`,width:row.width,height:row.height,x:.25+Math.random()*.5,y:.5+Math.random()*.18,createdAt:Date.now(),mode:'basic',source:'upload'};
     db.exec('BEGIN IMMEDIATE');
     try{if(!character(id))insert(c);db.prepare("UPDATE jobs SET status='ready',characterId=?,error=NULL WHERE id=?").run(id,row.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
     broadcast({type:'character',character:character(id)!});publicJob(row.id);
    }catch{
     db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run('处理未完成，请重新上传。',row.id);publicJob(row.id);
     await unlink(path.join(pendingDir,row.pendingFile)).catch(()=>{});
    }
   }
  }finally{workerRunning=false;}
 }
 function queue(){const task=processJobs();workerTasks.add(task);void task.finally(()=>workerTasks.delete(task));}
 const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const cookieToken=(req:IncomingMessage)=>req.headers.cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith('stage_session='))?.slice(14);
 function getSession(req:IncomingMessage){const token=cookieToken(req);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const tokenHash=sha(token);const entry=db.prepare('SELECT expiresAt FROM sessions WHERE tokenHash=?').get(tokenHash) as {expiresAt:number}|undefined;return entry&&entry.expiresAt>Date.now()?tokenHash:null;}
 function ensureSession(req:IncomingMessage,res:ServerResponse){let session=getSession(req);if(session)return session;
  db.prepare('DELETE FROM sessions WHERE expiresAt<?').run(Date.now());
  const count=(db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n;
  if(count>=10000)throw new InputError('暂时来访人数较多，请稍后重试。',503,'session_capacity');
  const token=randomBytes(32).toString('hex');session=sha(token);db.prepare('INSERT INTO sessions VALUES(?,?)').run(session,Date.now()+7*86400000);
  res.setHeader('Set-Cookie',`stage_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${options.cookieSecure?'; Secure':''}`);return session;
 }
 let allowedOrigins=new Set(options.allowedOrigins??[]);
 function validOrigin(req:IncomingMessage){const origin=req.headers.origin;return req.headers['sec-fetch-site']!=='cross-site'&&(!origin||allowedOrigins.has(origin));}
 async function body(req:IncomingMessage){
  if(Number(req.headers['content-length']??0)>MAX_UPLOAD_BYTES){req.resume();throw new InputError('图片需小于 5 MB。',413,'too_large');}
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_UPLOAD_BYTES)throw new InputError('图片需小于 5 MB。',413,'too_large');chunks.push(chunk);}
  return Buffer.concat(chunks);
 }
 const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.task':'application/octet-stream','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
 async function serveFile(res:ServerResponse,file:string,type:string,cache='no-cache'){
  try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':cache});res.end(bytes);}catch{json(res,404,{error:{code:'not_found',message:'资源不存在。'}});}
 }
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try{
   if(closing)throw new InputError('服务正在重启。',503,'restarting');
   const url=new URL(req.url??'/', 'http://localhost'),pathname=url.pathname,ip=req.socket.remoteAddress??'unknown';
   if(pathname.startsWith('/api/')&&!limiter.take(`api:${ip}`,180))throw new InputError('操作太频繁，请稍后再试。',429,'rate_limit');
   if(req.method==='GET'&&pathname==='/api/health'){json(res,200,{ok:true,mode:'basic',imageGeneration:false,storage:'sqlite'});return;}
   if(req.method==='GET'&&pathname==='/api/state'){ensureSession(req,res);json(res,200,snapshot());return;}
   if(req.method==='POST'&&pathname==='/api/characters'){
    if(!validOrigin(req))throw new InputError('请求来源不被允许。',403,'origin_denied');
    const session=getSession(req);if(!session)throw new InputError('请刷新页面建立匿名会话。',401,'session_required');
    if(!limiter.take(`upload-ip:${ip}`,options.uploadPerMinute??6)||!limiter.take(`upload:${session}`,options.uploadPerMinute??6))throw new InputError('上传太频繁，请一分钟后再试。',429,'upload_rate_limit');
    if(activeUploads>=2)throw new InputError('其他图片正在处理，请稍后重试。',503,'upload_busy');
    const count=(db.prepare("SELECT (SELECT count(*) FROM characters)+(SELECT count(*) FROM jobs WHERE status IN ('queued','processing')) n").get() as {n:number}).n;
    if(count+activeUploads>=100)throw new InputError('庭院已满，需要管理员整理后再添加。',409,'stage_full');
    const name=validName(typeof req.headers['x-character-name']==='string'?req.headers['x-character-name']:undefined);
    activeUploads++;
    try{
     const validated=await validateImage(await body(req),req.headers['content-type']??'');
     const id=randomUUID(),characterId=randomUUID(),pendingFile=`${id}.png`;
     await writeFile(path.join(pendingDir,pendingFile),validated.png,{flag:'wx',mode:0o600});
     try{db.prepare("INSERT INTO jobs VALUES(?,'queued',?,NULL,?,?,?,?,?)").run(id,characterId,Date.now(),name,pendingFile,validated.width,validated.height);}catch(e){await unlink(path.join(pendingDir,pendingFile)).catch(()=>{});throw e;}
     const queued=job(id);json(res,202,{job:queued});publicJob(id);setImmediate(queue);
    }finally{activeUploads--;}
    return;
   }
   if(req.method==='POST'&&pathname==='/api/generations'){if(!validOrigin(req))throw new InputError('请求来源不被允许。',403,'origin_denied');throw new InputError('未配置图像生成服务。请上传已有角色图片；当前为基础动画模式。',503,'generation_unavailable');}
   if(req.method==='DELETE'&&pathname.startsWith('/api/characters/'))throw new InputError('公共访客没有删除角色的权限。',403,'delete_forbidden');
   if(pathname.startsWith('/api/'))throw new InputError('接口不存在。',404,'not_found');
   if(req.method!=='GET')throw new InputError('不支持此请求。',405,'method_not_allowed');
   const match=pathname.match(/^\/assets\/([a-f0-9-]{36})\.png$/);
   if(match){
    if(!uuidRe.test(match[1])||!character(match[1]))throw new InputError('资源不存在。',404,'not_found');
    await serveFile(res,path.join(assetDir,`${match[1]}.png`),'image/png','public, max-age=31536000, immutable');return;
   }
   const staticDir=path.resolve(options.staticDir??'dist');let decoded:string;
   try{decoded=decodeURIComponent(pathname);}catch{throw new InputError('资源路径无效。');}
   if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(p=>p.startsWith('.')))throw new InputError('资源不存在。',404,'not_found');
   let file=path.resolve(staticDir,`.${decoded}`);
   if(file!==staticDir&&!file.startsWith(staticDir+path.sep))throw new InputError('资源不存在。',404,'not_found');
   if(decoded==='/'||!path.extname(decoded))file=path.join(staticDir,'index.html');
   await serveFile(res,file,mime[path.extname(file)]??'application/octet-stream');
  }catch(error){
   if(res.headersSent){res.end();return;}
   const e=error instanceof InputError?error:new InputError('服务器暂时无法处理请求。',500,'internal_error');
   if(!(error instanceof InputError))console.error('Request failed:',error instanceof Error?error.message:'unknown');
   json(res,e.status,{error:{code:e.code,message:e.message}});
  }
 });
 server.requestTimeout=15_000;server.headersTimeout=10_000;server.maxHeadersCount=40;
 server.on('upgrade',(req,socket,head)=>{
  if(closing||req.url!=='/ws'||!validOrigin(req)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  const session=getSession(req),ip=req.socket.remoteAddress??'unknown';
  if(!session){socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return;}
  if(peers.size>=128||[...peers.values()].filter(p=>p.ip===ip).length>=8||!limiter.take(`connect:${ip}`,30)){socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>{wss.emit('connection',ws,{session,ip});});
 });
 wss.on('connection',(ws:WebSocket,context:{session:string;ip:string})=>{
  const peer:Peer={id:randomUUID(),session:context.session,ip:context.ip,alive:true,tokens:wsRate,updated:Date.now()};peers.set(ws,peer);
  send(ws,{type:'hello',clientId:peer.id,state:snapshot()});broadcast({type:'presence',online:peers.size});
  ws.on('pong',()=>{peer.alive=true;});
  ws.on('error',()=>{});
  ws.on('message',(raw,isBinary)=>{
   const fail=(code:string,message:string,characterId?:string)=>send(ws,{type:'error',code,message,...(characterId?{characterId}:{})});
   const now=Date.now();peer.tokens=Math.min(wsRate,peer.tokens+(now-peer.updated)/1000*wsRate);peer.updated=now;
   if(peer.tokens<1){fail('rate_limit','动作太快了，慢一点再试。');return;}peer.tokens--;
   if(isBinary){fail('invalid_message','仅支持 JSON 消息。');return;}
   let msg:Record<string,unknown>;try{msg=JSON.parse(raw.toString());if(!msg||typeof msg!=='object'||Array.isArray(msg))throw 0;}catch{fail('invalid_message','消息格式无效。');return;}
   const id=msg.characterId;if(typeof id!=='string'||!uuidRe.test(id)||!character(id)){fail('not_found','角色不存在。');return;}
   expire();const lease=leases.get(id);
   if(msg.type==='acquire'){
    if(lease&&lease.owner!==peer.id){fail('lease_conflict','有人正在移动这个角色，稍等一下。',id);return;}
    // One active drag per connection prevents hoarding the entire public stage.
    for(const[key,l]of leases)if(l.owner===peer.id&&key!==id)release(key);
    const next={characterId:id,owner:peer.id,expiresAt:now+leaseMs};leases.set(id,next);broadcast({type:'lease',characterId:id,lease:next});return;
   }
   if(msg.type==='move'){
    if(!lease||lease.owner!==peer.id){fail('lease_required','请先取得拖动权限。',id);return;}
    if(typeof msg.x!=='number'||typeof msg.y!=='number'||!Number.isFinite(msg.x)||!Number.isFinite(msg.y)){fail('invalid_position','位置必须是有限数值。',id);return;}
    const x=Math.min(.92,Math.max(.08,msg.x)),y=Math.min(.9,Math.max(.35,msg.y));
    db.prepare('UPDATE characters SET x=?,y=? WHERE id=?').run(x,y,id);lease.expiresAt=now+leaseMs;
    broadcast({type:'character',character:character(id)!});broadcast({type:'lease',characterId:id,lease});return;
   }
   if(msg.type==='release'){if(lease?.owner===peer.id)release(id);return;}
   if(msg.type==='bounce'){
    if(!limiter.take(`bounce:${peer.id}`,5,1000)){fail('rate_limit','让角色休息一下。',id);return;}
    broadcast({type:'bounce',characterId:id,at:now});return;
   }
   fail('unknown_action','不支持这个动作。',id);
  });
  ws.on('close',()=>{peers.delete(ws);for(const[id,l]of leases)if(l.owner===peer.id)release(id);broadcast({type:'presence',online:peers.size});});
 });
 const leaseTimer=setInterval(expire,Math.min(500,leaseMs));leaseTimer.unref();
 const pingTimer=setInterval(()=>{for(const[ws,p]of peers){if(!p.alive){ws.terminate();continue;}p.alive=false;ws.ping();}},15_000);pingTimer.unref();
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,options.host??'127.0.0.1',()=>resolve());});
 const port=(server.address() as {port:number}).port;
 if(!options.allowedOrigins)allowedOrigins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173']);
 const url=`http://${options.host??'127.0.0.1'}:${port}`;
 queue();
 async function close(){if(closing)return;closing=true;clearInterval(leaseTimer);clearInterval(pingTimer);for(const ws of peers.keys())ws.terminate();
  await Promise.all([...workerTasks]);
  await new Promise<void>(resolve=>wss.close(()=>resolve()));
  await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});db.close();
 }
 return {url,close,db};
}
