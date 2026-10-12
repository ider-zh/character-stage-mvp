import type { CSSProperties } from 'react';
type Name = 'arrow' | 'upload' | 'camera' | 'cursor' | 'spark' | 'close' | 'check' | 'info' | 'leaf' | 'pause' | 'play' | 'retry' | 'move' | 'plus';
export function Icon({ name, size = 20, style, className = '' }: { name: Name; size?: number; style?: CSSProperties; className?: string }) {
  const paths: Record<Name, React.ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></>,
    camera: <><rect x="3" y="6" width="14" height="13" rx="3" /><path d="m17 10 4-3v12l-4-3" /></>,
    cursor: <><path d="m5 3 14 9-7 2-3 7-4-18Z" /></>,
    spark: <><path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
    leaf: <><path d="M19 3C8 2 2 9 7 16s15-1 12-13ZM5 21l10-12" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    play: <><path d="m8 5 11 7-11 7V5Z" /></>,
    retry: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" /></>,
    move: <><path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
