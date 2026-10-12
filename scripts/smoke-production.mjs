import { createStageServer } from '../server/app.ts';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(os.tmpdir(),'courtyard-production-'));
const app=await createStageServer({dataDir:dir,staticDir:path.resolve('dist')});
try{
 const home=await fetch(app.url);assert.equal(home.status,200);assert.match(home.headers.get('content-type')??'',/text\/html/);
 const html=await home.text();assert.match(html,/<title>同在/);
 let files=0;
 async function inspect(folder){for(const entry of await readdir(path.join('dist',folder),{withFileTypes:true})){
  const relative=path.posix.join(folder,entry.name);
  if(entry.isDirectory()){await inspect(relative);continue;}
  const res=await fetch(`${app.url}/${relative}`);assert.equal(res.status,200,relative);const bytes=await res.arrayBuffer();assert.ok(bytes.byteLength,relative);
  if(/\.m?js$/.test(relative))assert.match(res.headers.get('content-type')??'',/javascript/,relative);
  if(relative.endsWith('.wasm'))assert.equal(res.headers.get('content-type'),'application/wasm');
  files++;
 }}
 await inspect('');
 const state=await(await fetch(`${app.url}/api/state`)).json();assert.equal(state.characters.length,3);
 for(const c of state.characters){const asset=await fetch(`${app.url}${c.assetUrl}`);assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/png');}
 for(const probe of ['/.env','/server/app.ts','/%2e%2e%2fpackage.json','/assets/../../package.json']){const res=await fetch(app.url+probe);assert.equal(res.status,404,probe);}
 console.log(`PASS production smoke: HTML, ${files} built/runtime assets with MIME checks, 3 seed images, API state, and private-source path probes.`);
 console.log('This is an HTTP serving test, not browser visual or WebGL verification.');
}finally{await app.close();await rm(dir,{recursive:true,force:true});}
