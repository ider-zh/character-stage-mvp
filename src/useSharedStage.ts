import { useCallback, useEffect, useRef, useState } from 'react';
import type { Character, ClientMessage, Job, ServerMessage, StageState } from './types';

const empty: StageState = { characters: [], jobs: [], leases: [], online: 0 };
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';
export function useSharedStage() {
  const [state, setState] = useState<StageState>(empty);
  const [clientId, setClientId] = useState('');
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [notice, setNotice] = useState('');
  const [bounces, setBounces] = useState<Record<string, number>>({});
  const socket = useRef<WebSocket | null>(null);
  const pendingMove = useRef<Extract<ClientMessage, { type: 'move' }> | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(0);
  const reconnectNow = useRef<() => void>(() => {});
  const send = useCallback((message: ClientMessage) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);
  const flush = useCallback(() => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = null;
    if (pendingMove.current) {
      send(pendingMove.current);
      pendingMove.current = null;
      lastSent.current = performance.now();
    }
  }, [send]);
  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let abort: AbortController | undefined;
    let activeSocket: WebSocket | undefined;
    let generation = 0;
    const connect = async () => {
      const mine = ++generation;
      abort?.abort();
      abort = new AbortController();
      if (activeSocket) { activeSocket.onclose = null; activeSocket.close(); }
      socket.current = null;
      if (moveTimer.current) clearTimeout(moveTimer.current);
      moveTimer.current = null;
      pendingMove.current = null;
      setClientId('');
      setConnection(attempt ? 'reconnecting' : 'connecting');
      try {
        const response = await fetch('/api/state', { credentials: 'same-origin', signal: abort.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('无法读取共享舞台');
        const fresh: StageState = await response.json();
        if (stopped || mine !== generation) return;
        setState(fresh);
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
        activeSocket = ws;
        socket.current = ws;
        ws.onmessage = (event) => {
          if (stopped || mine !== generation) return;
          let message: ServerMessage;
          try { message = JSON.parse(String(event.data)) as ServerMessage; } catch { return; }
          if (message.type === 'hello') {
            attempt = 0;
            setClientId(message.clientId);
            setState(message.state);
            setConnection('connected');
            setNotice('');
          } else if (message.type === 'character') {
            setState(s => ({ ...s, characters: upsert(s.characters, message.character) }));
          } else if (message.type === 'job') {
            setState(s => ({ ...s, jobs: upsert(s.jobs, message.job) }));
          } else if (message.type === 'lease') {
            setState(s => ({ ...s, leases: [...s.leases.filter(l => l.characterId !== message.characterId), ...(message.lease ? [message.lease] : [])] }));
          } else if (message.type === 'presence') {
            setState(s => ({ ...s, online: message.online }));
          } else if (message.type === 'bounce') {
            setBounces(b => ({ ...b, [message.characterId]: performance.now() }));
          } else if (message.type === 'error') {
            setNotice(message.message);
          }
        };
        ws.onerror = () => { ws.close(); };
        ws.onclose = () => {
          if (stopped || mine !== generation) return;
          socket.current = null;
          setClientId('');
          setState(s => ({ ...s, leases: [] }));
          setConnection('reconnecting');
          schedule();
        };
      } catch (error) {
        if (stopped || mine !== generation || (error instanceof DOMException && error.name === 'AbortError')) return;
        setConnection('reconnecting');
        schedule();
      }
    };
    const schedule = () => {
      if (stopped) return;
      attempt += 1;
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** Math.min(attempt - 1, 4), 15000));
    };
    reconnectNow.current = () => { if (retry) clearTimeout(retry); void connect(); };
    void connect();
    return () => {
      stopped = true;
      generation += 1;
      abort?.abort();
      if (retry) clearTimeout(retry);
      if (moveTimer.current) clearTimeout(moveTimer.current);
      pendingMove.current = null;
      if (activeSocket) { activeSocket.onclose = null; activeSocket.close(); }
      socket.current = null;
    };
  }, []);
  const move = useCallback((id: string, x: number, y: number) => {
    setState(s => ({ ...s, characters: s.characters.map(c => c.id === id ? { ...c, x, y } : c) }));
    pendingMove.current = { type: 'move', characterId: id, x, y };
    const remaining = 50 - (performance.now() - lastSent.current);
    if (remaining <= 0) flush();
    else if (!moveTimer.current) moveTimer.current = setTimeout(flush, remaining);
  }, [flush]);
  const release = useCallback((id: string) => { flush(); send({ type: 'release', characterId: id }); }, [flush, send]);
  const addJob = useCallback((job: Job) => setState(s => ({ ...s, jobs: s.jobs.some(existing => existing.id === job.id) ? s.jobs : [...s.jobs, job] })), []);
  return { state, clientId, connection, notice, bounces, move, release, send, addJob, retry: () => reconnectNow.current() };
}
function upsert<T extends Character | Job>(items: T[], item: T): T[] {
  return items.some(c => c.id === item.id) ? items.map(c => c.id === item.id ? item : c) : [...items, item];
}
