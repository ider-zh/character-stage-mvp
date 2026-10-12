/** Extension contracts only. No network call, image generation, or segmentation is faked. */
export interface GeneratedCharacter { bytes: Uint8Array; mime: 'image/png' | 'image/webp'; attribution?: string }
export interface ImageGenerationProvider { generate(prompt: string, signal: AbortSignal): Promise<GeneratedCharacter> }
export interface CharacterLayer { name: 'body' | 'eyes' | 'mouth' | 'hair' | 'accessory'; png: Uint8Array; pivot: [number, number] }
export interface CharacterLayeringProvider { separate(canonicalPng: Uint8Array, signal: AbortSignal): Promise<CharacterLayer[]> }
export const animationCapability = { mode: 'basic', generatedImages: false, layeredRig: false } as const;
