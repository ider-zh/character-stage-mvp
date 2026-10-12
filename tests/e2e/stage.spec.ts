import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { StageState } from '../../src/types';

async function getState(page: Page): Promise<StageState> {
  const response = await page.request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return await response.json() as StageState;
}
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toContainText(/已连接|实时|在线|同步/);
  await expect.poll(async () => (await getState(page)).characters.length).toBeGreaterThan(0);
}
async function uploadPng(page: Page, name: string) {
  const buffer = await sharp({ create: { width: 180, height: 180, channels: 4, background: '#d893bb' } }).png().toBuffer();
  await page.getByTestId('upload-input').setInputFiles({ name: 'new-friend.png', mimeType: 'image/png', buffer });
  await page.getByTestId('upload-name').fill(name);
  await page.getByTestId('upload-submit').click();
  await expect.poll(async () => (await getState(page)).characters.some(character => character.name === name)).toBeTruthy();
  const character = (await getState(page)).characters.find(item => item.name === name)!;
  await expect(page.getByTestId(`character-${character.id}`)).toBeVisible();
  return character;
}

test('Chinese stage loads without fatal errors and all seeded art assets resolve', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', /zh/);
  const state = await getState(page);
  expect(state.characters.length).toBeGreaterThanOrEqual(3);
  for (const character of state.characters) {
    const response = await page.request.get(character.assetUrl);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\/png/);
    await expect(page.getByTestId(`character-${character.id}`)).toBeVisible();
  }
  await page.screenshot({ path: 'evidence/desktop-stage.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('two independent browsers synchronize keyboard movement, bounce, drag, and upload', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  try {
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    await Promise.all([ready(pageA), ready(pageB)]);
    const character = (await getState(pageA)).characters[0]!;
    const targetA = pageA.getByTestId(`character-${character.id}`);
    const targetB = pageB.getByTestId(`character-${character.id}`);
    const before = Number(await targetA.getAttribute('data-x'));
    await targetA.focus();
    await targetA.press('ArrowRight');
    await expect.poll(async () => Number(await targetB.getAttribute('data-x'))).toBeCloseTo(before + 0.015, 3);
    await targetA.press('Space');
    await expect.poll(async () => Number(await targetB.getAttribute('data-bounce'))).toBeGreaterThan(0);
    const box = await targetA.boundingBox();
    const stage = await pageA.getByTestId('stage').boundingBox();
    expect(box).not.toBeNull();
    expect(stage).not.toBeNull();
    await pageA.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await pageA.mouse.down();
    await expect.poll(async () => (await getState(pageA)).leases.some(lease => lease.characterId === character.id)).toBeTruthy();
    await pageA.mouse.move(box!.x + box!.width / 2 + stage!.width * 0.08, box!.y + box!.height / 2 - 20, { steps: 6 });
    await pageA.mouse.up();
    await expect.poll(async () => Number(await targetB.getAttribute('data-x'))).toBeCloseTo(before + 0.095, 2);
    await expect.poll(async () => (await getState(pageA)).leases.length).toBe(0);
    const newCharacter = await uploadPng(pageA, `浏览器新朋友${Date.now()}`);
    await expect(pageB.getByTestId(`character-${newCharacter.id}`)).toBeVisible();
    await pageB.reload();
    await expect(pageB.getByTestId(`character-${newCharacter.id}`)).toBeVisible();
    await expect.poll(async () => Number(await pageB.getByTestId(`character-${character.id}`).getAttribute('data-x'))).toBeCloseTo(before + 0.095, 2);
  } finally {
    await a.close();
    await b.close();
  }
});

test('mobile viewport fits the page and can upload and interact with a character', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  const character = await uploadPng(page, `手机朋友${Date.now()}`);
  const target = page.getByTestId(`character-${character.id}`);
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  await target.press('Space');
  await expect.poll(async () => Number(await target.getAttribute('data-bounce'))).toBeGreaterThan(0);
  await page.screenshot({ path: 'evidence/mobile-stage.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});

test('camera starts only after consent, reports rejection, and leaves ordinary interaction usable', async ({ page }) => {
  await stubCamera(page, 'reject');
  await ready(page);
  expect(await page.evaluate(() => window.__camera.calls)).toBe(0);
  await page.getByTestId('camera-toggle').click();
  await expect(page.getByTestId('camera-status')).toContainText('未获得摄像头权限');
  expect(await page.evaluate(() => window.__camera.calls)).toBe(1);
  const character = (await getState(page)).characters[0]!;
  const target = page.getByTestId(`character-${character.id}`);
  await target.focus();
  await target.press('Space');
  await expect.poll(async () => Number(await target.getAttribute('data-bounce'))).toBeGreaterThan(0);
});

test('stopping while permission is pending immediately stays off and cleans up late tracks', async ({ page }) => {
  await stubCamera(page, 'pending');
  await ready(page);
  const toggle = page.getByTestId('camera-toggle');
  await toggle.click();
  await expect(page.getByTestId('camera-status')).toContainText('等待摄像头权限');
  await toggle.click();
  await expect(page.getByTestId('camera-status')).toContainText('摄像头已关闭');
  await page.evaluate(() => window.__camera.resolvePending?.());
  await expect.poll(() => page.evaluate(() => window.__camera.stopped)).toBe(1);
  await expect(page.getByTestId('camera-status')).toContainText('摄像头已关闭');
  expect(await page.evaluate(() => window.__camera.workers)).toBe(0);
});

test('stopping during model initialization releases camera tracks and terminates its worker', async ({ page }) => {
  await stubCamera(page, 'loading');
  await ready(page);
  await page.getByTestId('camera-toggle').click();
  await expect(page.getByTestId('camera-status')).toContainText('正在加载本地人脸模型');
  await page.getByTestId('camera-toggle').click();
  await expect(page.getByTestId('camera-status')).toContainText('摄像头已关闭');
  expect(await page.evaluate(() => ({ stopped: window.__camera.stopped, terminated: window.__camera.terminated }))).toEqual({ stopped: 1, terminated: 1 });
});

test('active camera stop and repeated start-stop release every stream and worker', async ({ page }) => {
  await stubCamera(page, 'ready');
  await ready(page);
  const externalRequests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.getByTestId('camera-toggle').click();
    await expect(page.getByTestId('camera-status')).toContainText('摄像头已开启');
    await page.getByTestId('camera-toggle').click();
    await expect(page.getByTestId('camera-status')).toContainText('摄像头已关闭');
    expect(await page.evaluate(() => ({ calls: window.__camera.calls, stopped: window.__camera.stopped, terminated: window.__camera.terminated }))).toEqual({ calls: attempt, stopped: attempt, terminated: attempt });
  }
  expect(externalRequests).toEqual([]);
});

test('model failure closes the camera and explains its local fallback', async ({ page }) => {
  await stubCamera(page, 'model-error');
  await ready(page);
  await page.getByTestId('camera-toggle').click();
  await expect(page.getByTestId('camera-status')).toContainText('本地人脸模型未安装或无法读取');
  await expect.poll(() => page.evaluate(() => window.__camera.stopped)).toBe(1);
  expect(await page.evaluate(() => window.__camera.terminated)).toBe(1);
});

declare global {
  interface Window {
    __camera: { calls: number; stopped: number; workers: number; terminated: number; resolvePending?: () => void };
  }
}
async function stubCamera(page: Page, mode: 'reject' | 'pending' | 'loading' | 'ready' | 'model-error') {
  await page.addInitScript((selectedMode) => {
    window.__camera = { calls: 0, stopped: 0, workers: 0, terminated: 0 };
    const makeStream = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const stream = canvas.captureStream(1);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { window.__camera.stopped++; stop(); };
      }
      return stream;
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: () => {
      window.__camera.calls++;
      if (selectedMode === 'reject') return Promise.reject(new DOMException('Permission denied in test', 'NotAllowedError'));
      if (selectedMode === 'pending') return new Promise<MediaStream>(resolve => { window.__camera.resolvePending = () => resolve(makeStream()); });
      return Promise.resolve(makeStream());
    } });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
    HTMLMediaElement.prototype.load = () => {};
    class StubWorker {
      onmessage: ((event: { data: object }) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      constructor() { window.__camera.workers++; }
      postMessage(message: { type: string }) {
        if (message.type === 'init' && selectedMode !== 'loading') setTimeout(() => this.onmessage?.({ data: selectedMode === 'model-error' ? { type: 'error', code: 'model' } : { type: 'ready' } }), 10);
      }
      terminate() { window.__camera.terminated++; }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, value: StubWorker });
  }, mode);
}

test('a server-side upload error is readable and leaves the page usable for retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  const buffer = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#72c6ad' } }).png().toBuffer();
  await page.getByTestId('upload-input').setInputFiles({ name: 'retry-friend.png', mimeType: 'image/png', buffer });
  await page.getByTestId('upload-name').fill('../unsafe');
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-status')).toContainText(/名字|路径/);
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(page.getByTestId('upload-submit')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('a late queued upload response never overwrites the completed WebSocket job', async ({ page }) => {
  await ready(page);
  await page.route('**/api/characters', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.json() as { job: { id: string } };
    if (response.status() === 202) {
      await expect.poll(async () => (await getState(page)).jobs.find(job => job.id === body.job.id)?.status).toBe('ready');
      await page.waitForTimeout(100); // Force completion event before the original HTTP 202 callback.
    }
    await route.fulfill({ response });
  });
  await uploadPng(page, `慢回执朋友${Date.now()}`);
  await expect(page.getByTestId('upload-status')).toContainText('新朋友已加入');
  await expect(page.getByTestId('upload-submit')).toBeEnabled();
});

test('closing a connection reconnects automatically and reloads shared stage state', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.defineProperty(window, '__testSockets', { value: sockets });
    class ObservedSocket extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); }
    }
    window.WebSocket = ObservedSocket;
  });
  await ready(page);
  const before = (await getState(page)).characters;
  await page.evaluate(() => {
    const sockets = (window as unknown as { __testSockets: WebSocket[] }).__testSockets;
    sockets.filter(socket => socket.readyState === WebSocket.OPEN).forEach(socket => socket.close());
  });
  await expect(page.getByTestId('connection-status')).toContainText('连接中');
  await expect(page.getByTestId('connection-status')).toContainText('已实时同步');
  expect((await getState(page)).characters).toEqual(before);
  const target = page.getByTestId(`character-${before[0]!.id}`);
  await target.focus();
  await target.press('Space');
  await expect.poll(async () => Number(await target.getAttribute('data-bounce'))).toBeGreaterThan(0);
});
