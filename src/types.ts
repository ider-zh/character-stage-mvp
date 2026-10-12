export interface Character {
  id: string;
  name: string;
  assetUrl: string;
  width: number;
  height: number;
  x: number;
  y: number;
  createdAt: number;
  mode: 'basic';
  source: 'seed' | 'upload';
}
export interface Job {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  characterId: string | null;
  error: string | null;
  createdAt: number;
}
export interface Lease { characterId: string; owner: string; expiresAt: number }
export interface StageState { characters: Character[]; jobs: Job[]; leases: Lease[]; online: number }
export type ClientMessage =
 | { type: 'acquire'; characterId: string }
 | { type: 'move'; characterId: string; x: number; y: number }
 | { type: 'release'; characterId: string }
 | { type: 'bounce'; characterId: string };
export type ServerMessage =
 | { type: 'hello'; clientId: string; state: StageState }
 | { type: 'character'; character: Character }
 | { type: 'job'; job: Job }
 | { type: 'lease'; characterId: string; lease: Lease | null }
 | { type: 'bounce'; characterId: string; at: number }
 | { type: 'presence'; online: number }
 | { type: 'error'; code: string; message: string; characterId?: string };
export interface FaceFeedback { x: number; y: number; blink: number; present: boolean }
