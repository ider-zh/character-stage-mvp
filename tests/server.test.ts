import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import sharp from 'sharp';
import WebSocket from 'ws';
import { createStageServer } from '../server/app.ts';
import type { Character, Job, ServerMessage, StageState } from '../src/types.ts';

type Server = Awaited<ReturnType<typeof createStageServer>>;
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(options: { leaseMs?: number; seed?: boolean; dataDir?: string; uploadPerMinute?: number; wsPerSecond?: number } = {}) {
  const dataDir = options.dataDir ?? await mkdtemp(path.join(tmpdir(), 'character-stage-test-'));
  if (!options.dataDir) cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const server = await createStageServer({ dataDir, port: 0, host: '127.0.0.1', seed: false, ...options });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await server.close(); } };
  cleanups.push(close);
  const response = await fetch(`${server.url}/api/state`);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'state establishes an anonymous session cookie');
  const cookie = setCookie.split(';')[0]!;
  return { ...server, close, cookie, setCookie, dataDir };
}

type RunningServer = Awaited<ReturnType<typeof start>>;
async function state(server: Pick<RunningServer, 'url' | 'cookie'>): Promise<StageState> {
  const response = await fetch(`${server.url}/api/state`, { headers: { Cookie: server.cookie } });
  assert.equal(response.status, 200);
  return await response.json() as StageState;
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, description: string, timeout = 5000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T;
  do {
    value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${description}. Last value: ${JSON.stringify(value)}`);
}
async function png(width = 128, height = 128) {
  return sharp({ create: { width, height, channels: 4, background: '#eb706f' } }).png().toBuffer();
}
async function postImage(server: RunningServer, body: Buffer, mime = 'image/png', name = '小桃') {
  return fetch(`${server.url}/api/characters`, {
    method: 'POST',
    headers: { Cookie: server.cookie, 'Content-Type': mime, 'X-Character-Name': encodeURIComponent(name) },
    body: new Uint8Array(body),
  });
}
async function finishedJob(server: RunningServer, jobId: string) {
  const result = await until(() => state(server), s => s.jobs.some(job => job.id === jobId && ['ready', 'failed'].includes(job.status)), 'image processing');
  return { state: result, job: result.jobs.find(job => job.id === jobId)! };
}
async function upload(server: RunningServer, body?: Buffer, name?: string) {
  const response = await postImage(server, body ?? await png(), 'image/png', name);
  assert.equal(response.status, 202, await response.clone().text());
  const { job } = await response.json() as { job: Job };
  assert.ok(job.id);
  const result = await finishedJob(server, job.id);
  assert.equal(result.job.status, 'ready', result.job.error ?? 'upload should become ready');
  const character = result.state.characters.find(item => item.id === result.job.characterId);
  assert.ok(character);
  return { ...result, character };
}
async function expectRejectedImage(server: RunningServer, body: Buffer, mime: string, acceptedStatuses = [400, 413, 415, 422]) {
  const response = await postImage(server, body, mime);
  if (response.status === 202) {
    const { job } = await response.json() as { job: Job };
    const result = await finishedJob(server, job.id);
    assert.equal(result.job.status, 'failed');
    assert.equal(result.job.characterId, null);
    assert.ok(result.job.error);
  } else {
    assert.ok(acceptedStatuses.includes(response.status), `Expected safe rejection, got ${response.status}: ${await response.text()}`);
  }
}

class Peer {
  readonly messages: ServerMessage[] = [];
  readonly socket: WebSocket;
  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', data => this.messages.push(JSON.parse(String(data)) as ServerMessage));
  }
  send(message: object) { this.socket.send(JSON.stringify(message)); }
  mark() { return this.messages.length; }
  async wait<T extends ServerMessage['type']>(type: T, predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true, from = 0, timeout = 3000) {
    const messages = await until(async () => this.messages.slice(from), list => list.some(message => message.type === type && predicate(message as Extract<ServerMessage, { type: T }>)), `WebSocket ${type}`, timeout);
    return messages.find(message => message.type === type && predicate(message as Extract<ServerMessage, { type: T }>)) as Extract<ServerMessage, { type: T }>;
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const done = once(this.socket, 'close');
    this.socket.close();
    await done;
  }
}
async function connect(server: RunningServer, cookie = server.cookie) {
  const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/ws`, { headers: { Cookie: cookie, Origin: server.url } });
  const peer = new Peer(socket);
  cleanups.push(() => peer.close());
  const hello = await peer.wait('hello');
  return { peer, hello };
}
async function rejectedSocket(server: Server, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/ws`, { headers });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Unauthenticated WebSocket did not reject')); }, 2500);
    socket.on('unexpected-response', (_request, response) => { clearTimeout(timer); response.resume(); socket.terminate(); resolve(response.statusCode!); });
    socket.on('open', () => { clearTimeout(timer); socket.close(); reject(new Error('Unexpected accepted WebSocket')); });
    socket.on('error', () => { /* Upgrade rejection can also emit an error. */ });
  });
}

test('anonymous state establishes an HTTP-only session and disallows unauthenticated / cross-origin sockets', async () => {
  const server = await start();
  assert.match(server.setCookie, /HttpOnly/i);
  assert.match(server.setCookie, /SameSite=(Lax|Strict)/i);
  assert.deepEqual((await state(server)).characters, []);
  assert.ok([401, 403].includes(await rejectedSocket(server, {})));
  assert.ok([401, 403].includes(await rejectedSocket(server, { Cookie: 'stage_session=forged' })));
  assert.equal(await rejectedSocket(server, { Cookie: server.cookie, Origin: 'https://evil.example' }), 403);
  const { hello } = await connect(server);
  assert.ok(hello.clientId);
  assert.ok(hello.state.online >= 1);
});

test('real raster uploads become ready and are stored as canonical random PNG assets', async () => {
  const server = await start();
  const { character, job } = await upload(server);
  assert.equal(character.name, '小桃');
  assert.equal(character.mode, 'basic');
  assert.equal(character.source, 'upload');
  assert.equal(character.width, 128);
  assert.equal(character.height, 128);
  assert.equal(job.characterId, character.id);
  assert.match(character.assetUrl, /^\/assets\/[a-f\d-]+\.png$/i);
  const asset = await fetch(`${server.url}${character.assetUrl}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') ?? '', /^image\/png/);
  assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
  const metadata = await sharp(Buffer.from(await asset.arrayBuffer())).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  for (const format of ['jpeg', 'webp'] as const) {
    const input = await sharp(await png()).toFormat(format).toBuffer();
    const response = await postImage(server, input, `image/${format}`, format);
    assert.equal(response.status, 202);
    const { job: nextJob } = await response.json() as { job: Job };
    assert.equal((await finishedJob(server, nextJob.id)).job.status, 'ready');
  }
});

test('rejects disguised SVG, corrupt data, excessive bytes, and image dimensions outside limits', async () => {
  const server = await start({ uploadPerMinute: 20 });
  await expectRejectedImage(server, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><script>alert(1)</script></svg>'), 'image/png');
  await expectRejectedImage(server, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), 'image/png');
  await expectRejectedImage(server, await png(), 'image/svg+xml');
  await expectRejectedImage(server, Buffer.alloc(5 * 1024 * 1024 + 1, 65), 'image/png');
  await expectRejectedImage(server, await png(63, 128), 'image/png');
  await expectRejectedImage(server, await png(4097, 64), 'image/png');
  await expectRejectedImage(server, await png(4096, 4096), 'image/png');
  await expectRejectedImage(server, await sharp(await png()).jpeg().toBuffer(), 'image/png');
  await expectRejectedImage(server, Buffer.alloc(0), 'image/png');
  assert.deepEqual(await readdir(path.join(server.dataDir, 'pending')), []);
  assert.deepEqual(await readdir(path.join(server.dataDir, 'assets')), []);
  assert.equal((await state(server)).characters.length, 0);
});

test('untrusted character names cannot choose asset paths or trigger public deletion', async () => {
  const server = await start();
  const traversal = await postImage(server, await png(), 'image/png', '../../outside<script>alert(1)</script>');
  assert.equal(traversal.status, 400);
  const { character } = await upload(server, undefined, 'Safe name');
  assert.match(character.assetUrl, /^\/assets\/[a-f\d-]+\.png$/i);
  assert.ok(!character.assetUrl.includes('outside'));
  const deletion = await fetch(`${server.url}/api/characters/${character.id}`, { method: 'DELETE', headers: { Cookie: server.cookie } });
  assert.ok([403, 404, 405].includes(deletion.status));
  assert.equal((await state(server)).characters.length, 1);
  for (const unsafePath of ['/assets/%2e%2e%2fstage.sqlite', '/assets/not-an-asset.png']) {
    const response = await fetch(`${server.url}${unsafePath}`);
    assert.ok(response.status >= 400, `Unexpected asset access for ${unsafePath}`);
  }
  assert.ok(!(await readdir(path.dirname(server.dataDir))).includes('outside<script>alert(1)</script>'));
});

test('generation endpoint honestly reports unavailable and does not create a fake image job', async () => {
  const server = await start();
  const response = await fetch(`${server.url}/api/generations`, { method: 'POST', headers: { Cookie: server.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '粉色小龙' }) });
  assert.equal(response.status, 503);
  assert.equal((await state(server)).jobs.length, 0);
});

test('two clients receive live characters, positions, bounces, and presence', async () => {
  const server = await start();
  const a = await connect(server);
  const b = await connect(server);
  assert.notEqual(a.hello.clientId, b.hello.clientId, 'leases belong to connections, including same-session tabs');
  await a.peer.wait('presence', message => message.online === 2);
  const { character } = await upload(server);
  await a.peer.wait('character', message => message.character.id === character.id);
  await b.peer.wait('character', message => message.character.id === character.id);
  a.peer.send({ type: 'acquire', characterId: character.id });
  await b.peer.wait('lease', message => message.characterId === character.id && message.lease?.owner === a.hello.clientId);
  a.peer.send({ type: 'move', characterId: character.id, x: 0.67, y: 0.71 });
  await b.peer.wait('character', message => message.character.id === character.id && message.character.x === 0.67 && message.character.y === 0.71);
  a.peer.send({ type: 'bounce', characterId: character.id });
  await a.peer.wait('bounce', message => message.characterId === character.id);
  await b.peer.wait('bounce', message => message.characterId === character.id);
  await b.peer.close();
  await a.peer.wait('presence', message => message.online === 1);
});

test('concurrent lease acquisition has one winner; unauthorized movement and invalid coordinates are rejected', async () => {
  const server = await start();
  const { character } = await upload(server);
  const a = await connect(server);
  const b = await connect(server);
  a.peer.send({ type: 'acquire', characterId: character.id });
  b.peer.send({ type: 'acquire', characterId: character.id });
  const shared = await a.peer.wait('lease', message => message.characterId === character.id && message.lease !== null);
  const winner = shared.lease!.owner === a.hello.clientId ? a : b;
  const loser = winner === a ? b : a;
  await loser.peer.wait('error');
  const before = (await state(server)).characters[0]!;
  const mark = loser.peer.mark();
  loser.peer.send({ type: 'move', characterId: character.id, x: 0.11, y: 0.88 });
  await loser.peer.wait('error', () => true, mark);
  assert.equal((await state(server)).characters[0]!.x, before.x);
  const invalidMark = winner.peer.mark();
  winner.peer.send({ type: 'move', characterId: character.id, x: 'not-a-number', y: null });
  await winner.peer.wait('error', () => true, invalidMark);
  const invalidState = (await state(server)).characters[0]!;
  assert.ok(Number.isFinite(invalidState.x) && Number.isFinite(invalidState.y));
  winner.peer.send({ type: 'move', characterId: character.id, x: -100, y: 100 });
  await winner.peer.wait('character', message => message.character.id === character.id && message.character.x === 0.08 && message.character.y === 0.9);
  const leases = (await state(server)).leases.filter(lease => lease.characterId === character.id);
  assert.equal(leases.length, 1);
  assert.equal(leases[0]!.owner, winner.hello.clientId);
});

test('explicit release and disconnect free leases; reconnect receives a fresh identity and synchronized state', async () => {
  const server = await start();
  const { character } = await upload(server);
  const a = await connect(server);
  const b = await connect(server);
  a.peer.send({ type: 'acquire', characterId: character.id });
  await b.peer.wait('lease', message => message.lease?.owner === a.hello.clientId);
  let mark = b.peer.mark();
  a.peer.send({ type: 'release', characterId: character.id });
  await b.peer.wait('lease', message => message.characterId === character.id && message.lease === null, mark);
  b.peer.send({ type: 'acquire', characterId: character.id });
  await a.peer.wait('lease', message => message.lease?.owner === b.hello.clientId);
  mark = a.peer.mark();
  await b.peer.close();
  await a.peer.wait('lease', message => message.characterId === character.id && message.lease === null, mark);
  const reconnected = await connect(server);
  assert.notEqual(reconnected.hello.clientId, b.hello.clientId);
  assert.equal(reconnected.hello.state.characters[0]!.id, character.id);
  assert.equal(reconnected.hello.state.leases.length, 0);
});

test('leases expire and valid owner moves renew them', async () => {
  const server = await start({ leaseMs: 500 });
  const { character } = await upload(server);
  const a = await connect(server);
  const b = await connect(server);
  a.peer.send({ type: 'acquire', characterId: character.id });
  const first = await b.peer.wait('lease', message => message.lease?.owner === a.hello.clientId);
  await new Promise(resolve => setTimeout(resolve, 120));
  a.peer.send({ type: 'move', characterId: character.id, x: 0.44, y: 0.7 });
  await b.peer.wait('character', message => message.character.x === 0.44);
  const renewed = (await state(server)).leases.find(lease => lease.characterId === character.id)!;
  assert.ok(renewed.expiresAt > first.lease!.expiresAt, 'accepted move renews the lease');
  await until(() => state(server), value => value.leases.length === 0, 'expired lease removal', 3000);
  const mark = a.peer.mark();
  a.peer.send({ type: 'move', characterId: character.id, x: 0.2, y: 0.7 });
  await a.peer.wait('error', () => true, mark);
  b.peer.send({ type: 'acquire', characterId: character.id });
  await b.peer.wait('lease', message => message.lease?.owner === b.hello.clientId);
});

test('characters, canonical assets, jobs, and moved positions survive SQLite restart; transient leases do not', async () => {
  const original = await start();
  const { character, job } = await upload(original);
  const { peer, hello } = await connect(original);
  peer.send({ type: 'acquire', characterId: character.id });
  await peer.wait('lease', message => message.lease?.owner === hello.clientId);
  peer.send({ type: 'move', characterId: character.id, x: 0.61, y: 0.82 });
  await peer.wait('character', message => message.character.x === 0.61);
  const originalAsset = Buffer.from(await (await fetch(`${original.url}${character.assetUrl}`)).arrayBuffer());
  await peer.close();
  await original.close();
  const restarted = await start({ dataDir: original.dataDir });
  const persisted = await state(restarted);
  const persistedCharacter = persisted.characters.find(item => item.id === character.id) as Character;
  assert.equal(persistedCharacter.x, 0.61);
  assert.equal(persistedCharacter.y, 0.82);
  assert.equal(persistedCharacter.assetUrl, character.assetUrl);
  assert.equal(persisted.jobs.find(item => item.id === job.id)?.status, 'ready');
  assert.equal(persisted.leases.length, 0);
  const asset = await fetch(`${restarted.url}${character.assetUrl}`);
  assert.equal(asset.status, 200);
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), originalAsset);
});

test('malformed WebSocket payloads fail safely without mutating state', async () => {
  const server = await start();
  const { character } = await upload(server);
  const { peer } = await connect(server);
  for (const payload of ['this is not json', 'null', '[]', '{"type":"eraseEverything"}', '{"type":"acquire","characterId":"missing"}']) {
    const mark = peer.mark();
    peer.socket.send(payload);
    await peer.wait('error', () => true, mark);
  }
  const current = await state(server);
  assert.equal(current.characters.length, 1);
  assert.equal(current.characters[0]!.id, character.id);
  assert.equal(current.leases.length, 0);
});


test('upload rate limits prevent unbounded image processing', async () => {
  const server = await start({ uploadPerMinute: 1 });
  await upload(server);
  const response = await postImage(server, await png());
  assert.equal(response.status, 429);
  assert.equal((await state(server)).characters.length, 1);
});

test('WebSocket rate limits reject a burst without taking the shared stage down', async () => {
  const server = await start({ wsPerSecond: 5 });
  const { character } = await upload(server);
  const { peer } = await connect(server);
  for (let i = 0; i < 25; i++) peer.send({ type: 'bounce', characterId: character.id });
  await until(async () => ({ messages: peer.messages, status: peer.socket.readyState }), result => result.status === WebSocket.CLOSED || result.messages.some(message => message.type === 'error' && /rate|limit/i.test(message.code + message.message)), 'WebSocket rate limiting');
  assert.equal((await state(server)).characters.length, 1);
});


test('HTTP upload rejects missing sessions and hostile origins without creating assets', async () => {
  const server = await start();
  const bytes = new Uint8Array(await png());
  const unauthenticated = await fetch(`${server.url}/api/characters`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
  assert.equal(unauthenticated.status, 401);
  for (const extra of [{ Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }] as Array<Record<string, string>>) {
    const response = await fetch(`${server.url}/api/characters`, { method: 'POST', headers: { Cookie: server.cookie, 'Content-Type': 'image/png', ...extra }, body: bytes });
    assert.equal(response.status, 403);
  }
  assert.equal((await state(server)).jobs.length, 0);
  assert.deepEqual(await readdir(path.join(server.dataDir, 'assets')), []);
});

test('same-origin security headers constrain scripts, framing, camera, and microphone', async () => {
  const server = await start();
  const response = await fetch(`${server.url}/api/state`, { headers: { Cookie: server.cookie } });
  const csp = response.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(response.headers.get('permissions-policy') ?? '', /camera=\(self\)/);
  assert.match(response.headers.get('permissions-policy') ?? '', /microphone=\(\)/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const rows = server.db.prepare('SELECT tokenHash FROM sessions').all() as Array<{ tokenHash: string }>;
  assert.ok(rows.every(row => !server.cookie.includes(row.tokenHash)), 'session tokens are stored as hashes');
});

test('restart recovers a queued image and marks an interrupted missing image failed', async () => {
  const original = await start();
  const queuedId = randomUUID();
  const characterId = randomUUID();
  const missingId = randomUUID();
  await writeFile(path.join(original.dataDir, 'pending', `${queuedId}.png`), await png());
  const insert = original.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run(queuedId, 'queued', characterId, null, Date.now(), 'Recovered friend', `${queuedId}.png`, 128, 128);
  insert.run(missingId, 'processing', randomUUID(), null, Date.now() + 1, 'Missing friend', `${missingId}.png`, 128, 128);
  await original.close();
  const restarted = await start({ dataDir: original.dataDir });
  const recovered = await finishedJob(restarted, queuedId);
  assert.equal(recovered.job.status, 'ready');
  assert.equal(recovered.job.characterId, characterId);
  assert.equal((await finishedJob(restarted, missingId)).job.status, 'failed');
  assert.equal((await state(restarted)).characters.length, 1);
  assert.equal((await fetch(`${restarted.url}/assets/${characterId}.png`)).status, 200);
});

test('seed artwork is valid local PNG and seeding does not duplicate on restart', async () => {
  const original = await start({ seed: true });
  const seeded = (await state(original)).characters;
  assert.equal(seeded.length, 3);
  for (const item of seeded) {
    assert.equal(item.source, 'seed');
    assert.equal(item.mode, 'basic');
    assert.ok(item.x >= 0.08 && item.x <= 0.92 && item.y >= 0.35 && item.y <= 0.9);
    const response = await fetch(`${original.url}${item.assetUrl}`);
    assert.equal(response.status, 200);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
  }
  await original.close();
  const restarted = await start({ dataDir: original.dataDir, seed: true });
  assert.deepEqual((await state(restarted)).characters.map(character => character.id), seeded.map(character => character.id));
});

test('one connection cannot hoard leases and another connection cannot release its lease', async () => {
  const server = await start({ seed: true });
  const [one, two] = (await state(server)).characters;
  const a = await connect(server);
  const b = await connect(server);
  a.peer.send({ type: 'acquire', characterId: one!.id });
  await b.peer.wait('lease', message => message.characterId === one!.id && message.lease?.owner === a.hello.clientId);
  a.peer.send({ type: 'acquire', characterId: two!.id });
  await b.peer.wait('lease', message => message.characterId === two!.id && message.lease?.owner === a.hello.clientId);
  await b.peer.wait('lease', message => message.characterId === one!.id && message.lease === null);
  b.peer.send({ type: 'release', characterId: two!.id });
  // A subsequent acknowledged bounce is an ordering barrier for the release message.
  b.peer.send({ type: 'bounce', characterId: one!.id });
  await b.peer.wait('bounce', message => message.characterId === one!.id);
  const current = await state(server);
  assert.equal(current.leases.length, 1);
  assert.equal(current.leases[0]!.characterId, two!.id);
  assert.equal(current.leases[0]!.owner, a.hello.clientId);
});
