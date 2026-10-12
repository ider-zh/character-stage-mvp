import { Application, Assets, Sprite, Texture } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { Character, FaceFeedback, Lease } from './types';
import { Icon } from './icons';

interface Props {
  characters: Character[];
  leases: Lease[];
  clientId: string;
  connected: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAcquire: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onRelease: (id: string) => void;
  onBounce: (id: string) => void;
  bounces: Record<string, number>;
  feedback: FaceFeedback | null;
  paused: boolean;
}
interface Drag { id: string; dx: number; dy: number; x: number; y: number; startX?: number; startY?: number; leaseConfirmed?: boolean }
const clampX = (x: number) => Math.max(.10, Math.min(.90, x));
const clampY = (y: number) => Math.max(.35, Math.min(.85, y));
export function Stage(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const appRef = useRef<Application | null>(null);
  const sprites = useRef(new Map<string, Sprite>());
  const drag = useRef<Drag | null>(null);
  const keyboardMove = useRef<Drag | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 430 });
  const [dragging, setDragging] = useState<string | null>(null);
  const size = Math.max(108, Math.min(174, dimensions.width * .21));
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let disposed = false;
    const app = new Application();
    const initialize = async () => {
      try {
        await app.init({ resizeTo: node, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl' });
        if (disposed) { app.destroy(true, { children: true }); return; }
        node.prepend(app.canvas);
        app.canvas.setAttribute('aria-hidden', 'true');
        app.canvas.className = 'stage-canvas';
        appRef.current = app;
        setReady(true);
        let clock = 0;
        app.ticker.add((ticker) => {
          clock += ticker.deltaMS;
          const p = latest.current;
          const width = app.screen.width;
          const height = app.screen.height;
          p.characters.forEach((character, index) => {
            const sprite = sprites.current.get(character.id);
            if (!sprite) return;
            const phase = clock / 1350 + index * 2.1;
            const automatic = !p.paused && drag.current?.id !== character.id;
            const breath = automatic ? Math.sin(phase) * .012 : 0;
            const isSelected = character.id === p.selectedId;
            const response = isSelected && !p.paused ? (p.feedback?.present ? p.feedback : pointer.current) : { x: 0, y: 0 };
            const blink = isSelected && !p.paused && p.feedback?.present ? Math.max(0, Math.min(1, p.feedback.blink)) : 0;
            const bounceAt = p.bounces[character.id];
            const elapsed = bounceAt === undefined ? 1000 : performance.now() - bounceAt;
            const bounce = elapsed >= 0 && elapsed < 650 ? Math.sin(elapsed / 650 * Math.PI) * (p.paused ? 8 : 36) : 0;
            const texture = sprite.texture;
            const base = sizeRef.current / Math.max(texture.width, texture.height);
            sprite.scale.set(base * (1 - breath * .4 + blink * .012), base * (1 + breath - blink * .025));
            sprite.position.set(character.x * width + response.x * 4, character.y * height - bounce - (automatic ? Math.sin(phase) * 2 : 0) + response.y * 2);
            sprite.rotation = automatic ? Math.sin(phase * .7) * .022 + response.x * .024 : 0;
            sprite.zIndex = Math.round(character.y * 1000);
          });
        });
        app.stage.sortableChildren = true;
      } catch {
        if (!disposed) { setFallback(true); setReady(false); }
        try { if (app.renderer) app.destroy(true, { children: true }); } catch { /* Failed renderer init has no usable context. */ }
      }
    };
    void initialize();
    return () => {
      disposed = true;
      appRef.current = null;
      sprites.current.clear();
      if (app.renderer) { try { app.destroy(true, { children: true }); } catch { /* Already destroyed. */ } }
    };
  }, []);
  useEffect(() => {
    const app = appRef.current;
    if (!ready || !app) return;
    let cancelled = false;
    const currentIds = new Set(props.characters.map(c => c.id));
    sprites.current.forEach((sprite, id) => {
      if (!currentIds.has(id)) { sprite.destroy(); sprites.current.delete(id); }
    });
    void Promise.all(props.characters.map(async character => {
      if (sprites.current.has(character.id)) return;
      try {
        const texture = await Assets.load<Texture>(character.assetUrl);
        if (cancelled || appRef.current !== app || sprites.current.has(character.id)) return;
        const sprite = new Sprite(texture);
        sprite.anchor.set(.5);
        sprites.current.set(character.id, sprite);
        app.stage.addChild(sprite);
      } catch {
        if (!cancelled) setFallback(true);
      }
    }));
    return () => { cancelled = true; };
  }, [props.characters.map(c => `${c.id}:${c.assetUrl}`).join('|'), ready]);
  const endDrag = () => {
    const active = drag.current;
    drag.current = null;
    setDragging(null);
    if (active) latest.current.onRelease(active.id);
  };
  useEffect(() => {
    const blur = () => {
      endDrag();
      if (keyboardMove.current) latest.current.onRelease(keyboardMove.current.id);
      keyboardMove.current = null;
    };
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); blur(); };
  }, []);
  useEffect(() => {
    if (!props.connected) { drag.current = null; keyboardMove.current = null; setDragging(null); }
  }, [props.connected]);
  useEffect(() => {
    const active = drag.current;
    if (active && props.leases.some(l => l.characterId === active.id && l.owner === props.clientId)) {
      if (!active.leaseConfirmed) { active.leaseConfirmed = true; props.onMove(active.id, active.x, active.y); }
    } else if (active?.leaseConfirmed && props.connected) {
      active.leaseConfirmed = false;
      props.onAcquire(active.id);
    }
    const key = keyboardMove.current;
    if (key && props.leases.some(l => l.characterId === key.id && l.owner === props.clientId)) {
      keyboardMove.current = null;
      props.onMove(key.id, key.x, key.y);
      props.onRelease(key.id);
    }
  }, [props.leases, props.clientId]);
  useEffect(() => {
    const renewal = setInterval(() => {
      const active = drag.current;
      const p = latest.current;
      if (active?.leaseConfirmed && p.connected && p.leases.some(lease => lease.characterId === active.id && lease.owner === p.clientId)) p.onAcquire(active.id);
    }, 1500);
    return () => clearInterval(renewal);
  }, []);
  function down(event: PointerEvent<HTMLButtonElement>, character: Character) {
    if (event.button !== 0 || !props.connected) return;
    props.onSelect(character.id);
    const busy = props.leases.some(l => l.characterId === character.id && l.owner !== props.clientId);
    if (busy) return;
    const rect = host.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: character.id, dx: (event.clientX - rect.left) / rect.width - character.x, dy: (event.clientY - rect.top) / rect.height - character.y, x: character.x, y: character.y, startX: event.clientX, startY: event.clientY };
    setDragging(character.id);
    props.onAcquire(character.id);
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (active && active.startX !== undefined && active.startY !== undefined && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 4) latest.current.onBounce(active.id);
    endDrag();
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const rect = host.current?.getBoundingClientRect();
    if (!rect) return;
    pointer.current = { x: (event.clientX - rect.left) / rect.width * 2 - 1, y: (event.clientY - rect.top) / rect.height * 2 - 1 };
    const active = drag.current;
    if (!active) return;
    active.x = clampX((event.clientX - rect.left) / rect.width - active.dx);
    active.y = clampY((event.clientY - rect.top) / rect.height - active.dy);
    if (props.leases.some(l => l.characterId === active.id && l.owner === props.clientId)) props.onMove(active.id, active.x, active.y);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, character: Character) {
    if (!props.connected) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      props.onSelect(character.id);
      props.onBounce(character.id);
      return;
    }
    const delta = event.shiftKey ? .05 : .015;
    const axes: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (!axes[event.key]) return;
    event.preventDefault();
    if (props.leases.some(l => l.characterId === character.id && l.owner !== props.clientId)) return;
    props.onSelect(character.id);
    const previous = keyboardMove.current?.id === character.id ? keyboardMove.current : character;
    const [dx, dy] = axes[event.key];
    keyboardMove.current = { id: character.id, dx: 0, dy: 0, x: clampX(previous.x + dx), y: clampY(previous.y + dy) };
    props.onAcquire(character.id);
  }
  return <div ref={host} className={`courtyard ${fallback ? 'is-fallback' : ''} ${props.paused ? 'is-paused' : ''}`} data-testid="stage" aria-label="所有人共享的角色舞台" onPointerMove={move} onPointerLeave={() => { pointer.current = { x: 0, y: 0 }; }}>
    <div className="stage-grain" />
    <div className="courtyard-orb orb-one" /><div className="courtyard-orb orb-two" />
    <div className="ground-line line-one" /><div className="ground-line line-two" /><div className="ground-line line-three" />
    <div className="garden-mark"><Icon name="spark" size={29} /><span>慢一点，也很可爱。</span></div>
    <div className="stage-badge"><i /> PUBLIC COURTYARD <span>01</span></div>
    <div className="plant plant-left"><span /><span /><span /></div><div className="plant plant-right"><span /><span /><span /></div>
    <div className="pebble pebble-one" /><div className="pebble pebble-two" /><div className="pebble pebble-three" />
    <div className="character-hit-layer">
      {props.characters.map(character => {
        const lease = props.leases.find(l => l.characterId === character.id);
        const busy = !!lease && lease.owner !== props.clientId;
        return <button key={character.id} className={`character-hit ${props.selectedId === character.id ? 'is-selected' : ''} ${dragging === character.id ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`} style={{ left: `${character.x * 100}%`, top: `${character.y * 100}%`, width: size, height: size, zIndex: Math.round(character.y * 1000), '--character-phase': `${character.createdAt % 3}s` } as CSSProperties} data-testid={`character-${character.id}`} data-x={character.x.toFixed(4)} data-y={character.y.toFixed(4)} data-bounce={props.bounces[character.id] ?? 0} aria-label={`${character.name}，拖动或用方向键移动，空格跳跃`} aria-pressed={props.selectedId === character.id} onPointerDown={event => down(event, character)} onPointerUp={pointerUp} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={event => keyDown(event, character)} onClick={() => props.onSelect(character.id)}>
          <span className="character-shadow" />
          {fallback && <span className="fallback-wrap" key={props.bounces[character.id] ?? "rest"} style={{ animation: props.bounces[character.id] ? "fallback-bounce 650ms ease-out" : undefined }}><img src={character.assetUrl} alt="" draggable={false} className="fallback-character" /></span>}
          <span className="character-name">{busy ? <span className="busy-dot" /> : props.selectedId === character.id ? <span className="selected-dot" /> : null}{character.name}{busy && <small>朋友正在移动</small>}</span>
        </button>;
      })}
    </div>
    {!props.characters.length && <div className="stage-empty"><Icon name="leaf" size={36} /><p>{props.connected ? '小院准备好了，带第一位朋友来吧。' : '正在打开小院…'}</p></div>}
    <div className="stage-hint"><Icon name="move" size={14} /><span>拖一拖，找个喜欢的位置</span></div>
    {fallback && <span className="fallback-label">图片兼容模式</span>}
    <div className="stage-coordinate">一起发呆，也很好。</div>
  </div>;
}
