import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source='node_modules/@mediapipe/tasks-vision/wasm';
const target='public/mediapipe/wasm';
await mkdir(target,{recursive:true});
for(const suffix of ['internal','nosimd_internal']){
 const base=`vision_wasm_${suffix}`;
 await copyFile(`${source}/${base}.wasm`,`${target}/${base}.wasm`);
 const js=await readFile(`${source}/${base}.js`,'utf8');
 await writeFile(`${target}/${base}.js`,js);
 await writeFile(`${target}/${base}.mjs`,`${js}\nexport default ModuleFactory;\n`);
}
await mkdir('public/models',{recursive:true});
const model='public/models/face_landmarker.task';
try{await access(model);}catch{
 const url='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
 const response=await fetch(url);if(!response.ok)throw new Error(`Model download failed: ${response.status}`);
 await writeFile(model,new Uint8Array(await response.arrayBuffer()));
}
const digest=createHash('sha256').update(await readFile(model)).digest('hex');
if(digest!=='64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff')throw new Error('Unexpected face model hash.');
console.log('Local MediaPipe runtime and pinned model are ready.');
