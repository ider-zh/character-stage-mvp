import { spawn } from 'node:child_process';
const children = [spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
let exiting=false;
const stop=()=>{if(exiting)return;exiting=true;for(const child of children)child.kill('SIGTERM');};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of children)child.on('exit',(code)=>{if(!exiting){stop();process.exitCode=code||0;}});
