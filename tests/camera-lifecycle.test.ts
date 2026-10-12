/** Independent unit-level lifecycle QA. This deliberately does not claim browser,
 * MediaPipe model, permission UI, or visual coverage. The production hook executes
 * with controlled React hook slots and browser resource doubles. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

type Mode = 'reject' | 'pending' | 'loading' | 'ready' | 'model-error' | 'capture-error' | 'play-pending' | 'bitmap-pending';
type Camera = { status: string; message: string; feedback: unknown; start(): Promise<void>; stop(): void };
const source = await readFile(new URL('../src/useCamera.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replaceAll('import.meta.url', JSON.stringify('http://localhost/src/useCamera.ts')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(mode: Mode) {
  const slots: unknown[] = [];
  const effects: Array<() => unknown> = [];
  const cleanups: Array<() => void> = [];
  let index = 0;
  const counts = { requested: 0, stopped: 0, workers: 0, terminated: 0, bitmapClosed: 0, videoReleased: 0, framePosts: 0 };
  let resolvePermission: ((value: unknown) => void) | undefined;
  let resolvePlay: (() => void) | undefined;
  let resolveBitmap: ((value: { close(): void }) => void) | undefined;
  let lastWorker: StubWorker | undefined;
  const track = { onended: null as (() => void) | null, stop: () => { counts.stopped++; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const react = {
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], (next: unknown) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
    },
    useRef(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useCallback(callback: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = callback;
      return slots[slot];
    },
    useEffect(effect: () => unknown) {
      const slot = index++;
      if (!(slot in slots)) { slots[slot] = true; effects.push(effect); }
    },
  };
  class StubWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { preventDefault(): void }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor() { counts.workers++; lastWorker = this; }
    terminate() { counts.terminated++; }
    postMessage(message: { type: string; bitmap?: { close(): void } }) {
      if (message.type === 'init' && mode !== 'loading') {
        queueMicrotask(() => this.onmessage?.({ data: mode === 'model-error' ? { type: 'error', code: 'model' } : { type: 'ready' } }));
      }
      if (message.type === 'frame') {
        counts.framePosts++;
        message.bitmap?.close();
        queueMicrotask(() => this.onmessage?.({ data: { type: 'result', feedback: { present: false, x: 0, y: 0, blink: 0 } } }));
      }
    }
  }
  const exports: { useCamera?: () => Camera } = {};
  const context = vm.createContext({
    exports, require: (name: string) => { assert.equal(name, 'react'); return react; },
    window: { isSecureContext: true },
    navigator: { mediaDevices: { getUserMedia: () => {
      counts.requested++;
      if (mode === 'reject') return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      if (mode === 'pending') return new Promise(resolve => { resolvePermission = resolve; });
      return Promise.resolve(stream);
    } } },
    document: { createElement: (tag: string) => {
      assert.equal(tag, 'video');
      return { play: () => mode === 'play-pending' ? new Promise<void>(resolve => { resolvePlay = resolve; }) : Promise.resolve(), pause() {}, load() {}, removeAttribute() {}, remove() { counts.videoReleased++; }, readyState: 2, currentTime: 1, srcObject: null };
    } },
    Worker: StubWorker, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    createImageBitmap: () => {
      if (mode === 'capture-error') throw new Error('Synthetic capture failure');
      if (mode === 'bitmap-pending') return new Promise(resolve => { resolveBitmap = resolve; });
      return Promise.resolve({ close: () => { counts.bitmapClosed++; } });
    },
    URL, DOMException, Error, AbortController, setTimeout, clearTimeout, performance,
  });
  new vm.Script(compiled, { filename: 'useCamera.transpiled.cjs' }).runInContext(context);
  const render = () => {
    index = 0;
    const camera = exports.useCamera!();
    while (effects.length) {
      const cleanup = effects.shift()!();
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
    }
    return camera;
  };
  const settle = async () => { for (let step = 0; step < 16; step++) await Promise.resolve(); };
  render();
  return { counts, render, settle, resolve: () => resolvePermission?.(stream), resolvePlay: () => resolvePlay?.(), resolveBitmap: () => resolveBitmap?.({ close: () => { counts.bitmapClosed++; } }), disconnect: () => track.onended?.(), workerFailure: () => lastWorker?.onerror?.({ preventDefault() {} }), unmount: () => cleanups.splice(0).forEach(fn => fn()) };
}

test('camera unit: does not request on mount; permission rejection leaves no live resources', async () => {
  const h = harness('reject');
  assert.equal(h.counts.requested, 0);
  assert.equal(h.render().status, 'off');
  await h.render().start();
  assert.equal(h.render().status, 'error');
  assert.match(h.render().message, /未获得摄像头权限/);
  assert.equal(h.counts.workers, 0);
  h.unmount();
});

test('camera unit: cancellation beats late permission and suppresses duplicate requests', async () => {
  const h = harness('pending');
  const pending = h.render().start();
  await h.render().start();
  assert.equal(h.counts.requested, 1);
  h.render().stop();
  h.resolve();
  await pending;
  await h.settle();
  assert.equal(h.render().status, 'off');
  assert.equal(h.counts.stopped, 1);
  assert.equal(h.counts.workers, 0);
  h.unmount();
});

test('camera unit: cancel during model loading stops stream, releases video and terminates worker', async () => {
  const h = harness('loading');
  const pending = h.render().start();
  await h.settle();
  assert.equal(h.counts.workers, 1);
  assert.equal(h.render().status, 'loading');
  h.render().stop();
  await pending;
  assert.equal(h.render().status, 'off');
  assert.equal(h.counts.stopped, 1);
  assert.equal(h.counts.terminated, 1);
  assert.equal(h.counts.videoReleased, 1);
  h.unmount();
});

test('camera unit: repeated active start/stop releases every stream and worker exactly once', async () => {
  const h = harness('ready');
  for (let cycle = 1; cycle <= 3; cycle++) {
    await h.render().start();
    await h.settle();
    assert.equal(h.render().status, 'on');
    h.render().stop();
    h.render().stop();
    assert.equal(h.render().status, 'off');
    assert.equal(h.counts.requested, cycle);
    assert.equal(h.counts.stopped, cycle);
    assert.equal(h.counts.terminated, cycle);
    assert.equal(h.counts.videoReleased, cycle);
  }
  h.unmount();
});

for (const mode of ['model-error', 'capture-error'] as const) test(`camera unit: ${mode} safely releases resources and reports mouse fallback`, async () => {
  const h = harness(mode);
  await h.render().start();
  await h.settle();
  assert.equal(h.render().status, 'error');
  assert.match(h.render().message, /鼠标/);
  assert.equal(h.counts.stopped, 1);
  assert.equal(h.counts.terminated, 1);
  assert.equal(h.counts.videoReleased, 1);
  h.unmount();
});

test('camera unit: track disconnect and runtime failure stop capture; unmount releases active camera', async () => {
  for (const action of ['disconnect', 'workerFailure', 'unmount'] as const) {
    const h = harness('ready');
    await h.render().start();
    await h.settle();
    h[action]();
    assert.equal(h.counts.stopped, 1, action);
    assert.equal(h.counts.terminated, 1, action);
    assert.equal(h.counts.videoReleased, 1, action);
    if (action !== 'unmount') {
      assert.equal(h.render().status, 'error', action);
      assert.match(h.render().message, /鼠标/);
    }
    h.unmount();
  }
});


test('camera unit: unmount beats late permission without creating a worker', async () => {
  const h = harness('pending');
  const pending = h.render().start();
  h.unmount();
  h.resolve();
  await pending;
  await h.settle();
  assert.equal(h.counts.stopped, 1);
  assert.equal(h.counts.workers, 0);
});

test('camera unit: cancellation beats late video playback and skips worker creation', async () => {
  const h = harness('play-pending');
  const pending = h.render().start();
  await h.settle();
  assert.equal(h.counts.workers, 0);
  h.render().stop();
  h.resolvePlay();
  await pending;
  await h.settle();
  assert.equal(h.render().status, 'off');
  assert.equal(h.counts.stopped, 1);
  assert.equal(h.counts.videoReleased, 1);
  assert.equal(h.counts.workers, 0);
  h.unmount();
});

test('camera unit: late captured bitmap closes after stop and is never sent to a dead worker', async () => {
  const h = harness('bitmap-pending');
  await h.render().start();
  await h.settle();
  assert.equal(h.render().status, 'on');
  assert.equal(h.counts.framePosts, 0);
  h.render().stop();
  h.resolveBitmap();
  await h.settle();
  assert.equal(h.render().status, 'off');
  assert.equal(h.counts.stopped, 1);
  assert.equal(h.counts.terminated, 1);
  assert.equal(h.counts.bitmapClosed, 1);
  assert.equal(h.counts.framePosts, 0);
  h.unmount();
});
