import { createStageServer } from './app.ts';
const app=await createStageServer({
 dataDir:process.env.DATA_DIR??'./data',host:process.env.HOST??'127.0.0.1',port:Number(process.env.PORT??8787),
 ...(process.env.ALLOWED_ORIGINS?{allowedOrigins:process.env.ALLOWED_ORIGINS.split(',').map(x=>x.trim())}:{}),
 cookieSecure:process.env.COOKIE_SECURE==='1'
});
console.log(`Character courtyard listening on ${app.url}`);
console.log('Local MVP: SQLite + controlled PNG storage; basic animation, no AI generation.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
