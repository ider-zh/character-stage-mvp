import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStageServer } from '../server/app.ts';

const dataDir = await mkdtemp(path.join(tmpdir(), 'character-stage-e2e-'));
const server = await createStageServer({ dataDir, port: 4173, host: '127.0.0.1', seed: true, staticDir: path.resolve('dist') });
console.log(`E2E isolated server: ${server.url}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
