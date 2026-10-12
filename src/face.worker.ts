import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type { FaceFeedback } from './types';

export type CameraWorkerRequest =
  | { type: 'init'; modelPath: string; wasmPath: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number };
export type CameraWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; feedback: FaceFeedback }
  | { type: 'error'; code: 'model' | 'runtime' | 'inference' };

// This module runs only inside a dedicated Worker. No frames, landmarks, or
// feedback leave the browser; network requests below read same-origin assets.
const scope = self as unknown as {
  location: Location;
  onmessage: ((event: MessageEvent<CameraWorkerRequest>) => void) | null;
  postMessage: (message: CameraWorkerResponse) => void;
  ModuleFactory?: unknown;
};
let landmarker: FaceLandmarker | null = null;
let initializing = false;
const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;

function summarize(result: FaceLandmarkerResult): FaceFeedback {
  const points = result.faceLandmarks[0];
  const nose = points?.[1];
  if (!nose || !Number.isFinite(nose.x) || !Number.isFinite(nose.y)) {
    return { x: 0, y: 0, blink: 0, present: false };
  }
  const categories = result.faceBlendshapes[0]?.categories ?? [];
  const score = (name: string) => categories.find((category) => category.categoryName === name)?.score ?? 0;
  // Mirrored face POSITION, not calibrated gaze. Deliberately do not derive
  // precise eye direction or expose the full face mesh to the application.
  return {
    x: clamp((0.5 - nose.x) * 2, -1, 1),
    y: clamp((nose.y - 0.5) * 2, -1, 1),
    blink: clamp((score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2, 0, 1),
    present: true,
  };
}

function sameOrigin(path: string): string {
  const url = new URL(path, scope.location.href);
  if (url.origin !== scope.location.origin) throw new Error('Only local assets are allowed');
  return url.href;
}

async function initialize(message: Extract<CameraWorkerRequest, { type: 'init' }>): Promise<void> {
  if (initializing || landmarker) return;
  initializing = true;
  let phase: 'model' | 'runtime' = 'model';
  try {
    // Fetch explicitly so a missing model or Vite's HTML fallback produces a
    // useful failure rather than an opaque native model parser exception.
    const response = await fetch(sameOrigin(message.modelPath), { credentials: 'same-origin' });
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Face model is unavailable');
    }
    const model = new Uint8Array(await response.arrayBuffer());
    if (model.byteLength < 1024) throw new Error('Face model is incomplete');
    phase = 'runtime';
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas is unavailable');
    const fileset = await FilesetResolver.forVisionTasks(sameOrigin(message.wasmPath));

    // MediaPipe 0.10.32 ships a classic-script WASM loader. Its built-in
    // importScripts cannot run in Vite module workers. Asset preparation
    // creates matching same-origin .mjs wrappers exporting ModuleFactory.
    // No eval, blob URLs, CDN scripts, or inference on the UI thread.
    const loaderUrl = sameOrigin(fileset.wasmLoaderPath.replace(/\.js$/, '.mjs'));
    try {
      const loader = await import(/* @vite-ignore */ loaderUrl) as { default: unknown };
      scope.ModuleFactory = loader.default;
      landmarker = await FaceLandmarker.createFromOptions({ ...fileset, wasmLoaderPath: '' }, {
        baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        canvas: new OffscreenCanvas(640, 480),
      });
    } finally {
      scope.ModuleFactory = undefined;
    }
    scope.postMessage({ type: 'ready' });
  } catch {
    landmarker?.close();
    landmarker = null;
    scope.postMessage({ type: 'error', code: phase });
  } finally {
    initializing = false;
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    void initialize(message);
    return;
  }
  if (message.type !== 'frame') return;
  let feedback: FaceFeedback | null = null;
  try {
    if (!landmarker) throw new Error('Face model is not ready');
    feedback = summarize(landmarker.detectForVideo(message.bitmap, message.timestamp));
  } catch {
    landmarker?.close();
    landmarker = null;
  } finally {
    // Ownership moves here with postMessage's transfer list. Release GPU /
    // pixel resources after every inference, including failures.
    message.bitmap.close();
  }
  scope.postMessage(feedback ? { type: 'result', feedback } : { type: 'error', code: 'inference' });
};
