import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceFeedback } from './types';
import type { CameraWorkerRequest, CameraWorkerResponse } from './face.worker';

export type CameraStatus = 'off' | 'loading' | 'on' | 'error';
const OFF_MESSAGE = '摄像头已关闭。可以继续用鼠标和角色互动。';
const FRAME_INTERVAL_MS = 100; // At most 10 captures/inferences per second.
const MODEL_TIMEOUT_MS = 25_000;
const VIDEO_TIMEOUT_MS = 10_000;
const INFERENCE_TIMEOUT_MS = 10_000;

interface CameraSession {
  abort: AbortController;
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  worker: Worker | null;
  timer: ReturnType<typeof setTimeout> | null;
  inferenceTimer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  lastVideoTime: number;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}

function dispose(session: CameraSession): void {
  session.abort.abort();
  if (session.timer !== null) clearTimeout(session.timer);
  if (session.inferenceTimer !== null) clearTimeout(session.inferenceTimer);
  session.timer = session.inferenceTimer = null;
  if (session.worker) {
    session.worker.onmessage = session.worker.onerror = session.worker.onmessageerror = null;
    // Termination also cancels model loading / inference and releases all
    // transferred bitmaps and worker-owned WASM/OffscreenCanvas resources.
    session.worker.terminate();
    session.worker = null;
  }
  if (session.stream) stopTracks(session.stream);
  session.stream = null;
  if (session.video) {
    session.video.pause();
    session.video.srcObject = null;
    session.video.removeAttribute('src');
    session.video.load();
    session.video.remove();
    session.video = null;
  }
}

function abortError(): DOMException {
  return new DOMException('Camera session cancelled', 'AbortError');
}

function cancellable<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs?: number, timeoutMessage?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      signal.removeEventListener('abort', aborted);
      if (timeout !== undefined) clearTimeout(timeout);
    };
    const aborted = () => { cleanup(); reject(abortError()); };
    if (signal.aborted) { void promise.catch(() => {}); reject(abortError()); return; }
    signal.addEventListener('abort', aborted, { once: true });
    if (timeoutMs !== undefined) timeout = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage ?? '摄像头启动超时，请继续用鼠标互动。'));
    }, timeoutMs);
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

function errorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return '未获得摄像头权限。摄像头已关闭，可以继续用鼠标互动。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有找到摄像头。可以继续用鼠标互动。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'OverconstrainedError') {
    return '摄像头暂时无法使用，可能正被其他应用占用。可以继续用鼠标互动。';
  }
  if (error instanceof Error && /[\u3400-\u9fff]/.test(error.message)) return error.message;
  return '摄像头暂时无法启动，已关闭。可以继续用鼠标互动。';
}

/** Optional local-only face-position/blink feedback. Never call start on mount. */
export function useCamera(): {
  status: CameraStatus;
  message: string;
  feedback: FaceFeedback | null;
  start: () => Promise<void>;
  stop: () => void;
} {
  const [status, setStatus] = useState<CameraStatus>('off');
  const [message, setMessage] = useState(OFF_MESSAGE);
  const [feedback, setFeedback] = useState<FaceFeedback | null>(null);
  const active = useRef<CameraSession | null>(null);
  const mounted = useRef(true);
  const isActive = useCallback((session: CameraSession) => mounted.current && active.current === session && !session.abort.signal.aborted, []);

  const fail = useCallback((session: CameraSession, reason: string) => {
    if (!isActive(session)) return;
    active.current = null;
    dispose(session);
    setFeedback(null);
    setMessage(reason);
    setStatus('error');
  }, [isActive]);

  const stop = useCallback(() => {
    const session = active.current;
    active.current = null; // Invalidate before any resource cleanup / callbacks.
    if (session) dispose(session);
    if (mounted.current) {
      setFeedback(null);
      setMessage(OFF_MESSAGE);
      setStatus('off');
    }
  }, []);

  const start = useCallback(async () => {
    // Ignore repeated clicks, including while a permission prompt is pending.
    if (!mounted.current || active.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setMessage('当前环境不支持摄像头；请在 HTTPS 或 localhost 中使用。现在可以继续用鼠标互动。');
      return;
    }
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
      setStatus('error');
      setMessage('此浏览器不支持本地人脸处理。可以继续用鼠标互动。');
      return;
    }
    const session: CameraSession = {
      abort: new AbortController(), stream: null, video: null, worker: null,
      timer: null, inferenceTimer: null, busy: false, lastVideoTime: -1,
    };
    active.current = session;
    setStatus('loading');
    setFeedback(null);
    setMessage('等待摄像头权限。画面仅在此浏览器处理，不会上传。');
    try {
      // This is the only camera permission request, reached only by explicit
      // start(). getUserMedia cannot be aborted, so stop late-arriving tracks.
      const requested = navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
        audio: false,
      }).then((stream) => {
        if (!isActive(session)) { stopTracks(stream); throw abortError(); }
        session.stream = stream;
        return stream;
      });
      const stream = await cancellable(requested, session.abort.signal);
      if (!isActive(session)) return;
      for (const track of stream.getVideoTracks()) track.onended = () => {
        fail(session, '摄像头连接已断开，已停止处理。可以继续用鼠标互动。');
      };
      const video = document.createElement('video');
      session.video = video;
      video.muted = true;
      video.playsInline = true;
      video.disablePictureInPicture = true;
      video.disableRemotePlayback = true;
      video.srcObject = stream;
      await cancellable(video.play(), session.abort.signal, VIDEO_TIMEOUT_MS);
      if (!isActive(session)) return;
      setMessage('正在加载本地人脸模型。随时可以关闭摄像头。');
      const worker = new Worker(new URL('./face.worker.ts', import.meta.url), { type: 'module' });
      session.worker = worker;
      let ready!: () => void;
      const initialized = new Promise<void>((resolve) => { ready = resolve; });
      worker.onmessage = (event: MessageEvent<CameraWorkerResponse>) => {
        if (!isActive(session)) return;
        if (event.data.type === 'ready') { ready(); return; }
        if (event.data.type === 'error') {
          fail(session, event.data.code === 'model'
            ? '本地人脸模型未安装或无法读取，摄像头已关闭。可以继续用鼠标互动。'
            : '本地人脸处理不可用，摄像头已关闭。可以继续用鼠标互动。');
          return;
        }
        if (event.data.type === 'result') {
          if (session.inferenceTimer !== null) clearTimeout(session.inferenceTimer);
          session.inferenceTimer = null;
          session.busy = false;
          setFeedback(event.data.feedback);
          setMessage(event.data.feedback.present
            ? '仅本机估计头部位置与眨眼，不是精确视线；画面不会上传。'
            : '暂未看到人脸。可以调整位置或继续用鼠标互动；画面不会上传。');
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail(session, '本地人脸处理启动失败，摄像头已关闭。可以继续用鼠标互动。');
      };
      worker.onmessageerror = () => fail(session, '本地人脸处理出现错误，摄像头已关闭。可以继续用鼠标互动。');
      const init: CameraWorkerRequest = { type: 'init', modelPath: '/models/face_landmarker.task', wasmPath: '/mediapipe/wasm' };
      worker.postMessage(init);
      await cancellable(initialized, session.abort.signal, MODEL_TIMEOUT_MS, '本地人脸模型加载超时，摄像头已关闭。可以继续用鼠标互动。');
      if (!isActive(session)) return;
      setStatus('on');
      setMessage('摄像头已开启。仅本机估计头部位置与眨眼，不是精确视线。');
      const tick = () => {
        if (!isActive(session)) return;
        session.timer = setTimeout(tick, FRAME_INTERVAL_MS);
        if (session.busy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === session.lastVideoTime) return;
        session.busy = true;
        session.lastVideoTime = video.currentTime;
        session.inferenceTimer = setTimeout(() => {
          fail(session, '本地人脸处理超时，摄像头已关闭。可以继续用鼠标互动。');
        }, INFERENCE_TIMEOUT_MS);
        const timestamp = performance.now();
        // createImageBitmap may fail synchronously on some browsers as well
        // as reject asynchronously. Handle both without leaving a live camera.
        let capture: Promise<ImageBitmap>;
        try { capture = createImageBitmap(video); } catch {
          fail(session, '无法读取摄像头画面，摄像头已关闭。可以继续用鼠标互动。');
          return;
        }
        void capture.then((bitmap) => {
          if (!isActive(session)) { bitmap.close(); return; }
          try {
            const frame: CameraWorkerRequest = { type: 'frame', bitmap, timestamp };
            worker.postMessage(frame, [bitmap]);
          } catch {
            bitmap.close();
            fail(session, '无法处理摄像头画面，摄像头已关闭。可以继续用鼠标互动。');
          }
        }, () => fail(session, '无法读取摄像头画面，摄像头已关闭。可以继续用鼠标互动。'));
      };
      tick();
    } catch (error) {
      // A prior stop/failure/unmount wins over every asynchronous completion.
      if (isActive(session)) fail(session, errorMessage(error));
    }
  }, [fail, isActive]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = active.current;
      active.current = null;
      if (session) dispose(session);
    };
  }, []);

  return { status, message, feedback, start, stop };
}
