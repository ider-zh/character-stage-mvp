import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_PIXELS = 16_000_000;
export class InputError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'invalid_input') {
    super(message); this.status = status; this.code = code;
  }
}
export function sniffImage(bytes: Buffer): 'png' | 'jpeg' | 'webp' {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  throw new InputError('只支持真实的 PNG、JPEG 或 WebP 静态图片。', 415, 'invalid_format');
}
export async function validateImage(bytes: Buffer, contentType: string) {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new InputError('图片需小于 5 MB。', 413, 'too_large');
  const format = sniffImage(bytes);
  if (contentType.split(';')[0] !== `image/${format}`) throw new InputError('图片内容与声明的格式不一致。', 415, 'mime_mismatch');
  try {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' }).metadata();
    const { width, height } = metadata;
    if (!width || !height || width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > MAX_PIXELS) {
      throw new InputError('图片边长需为 64–4096 像素，总像素不超过 1600 万。', 422, 'invalid_dimensions');
    }
    if ((metadata.pages ?? 1) > 1 || metadata.format !== format) throw new InputError('仅支持静态 PNG、JPEG、WebP。', 415, 'animated_image');
    // Fully decode then re-encode. This drops EXIF, ICC metadata, trailing payloads and all user filenames.
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' }).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
    return { png: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('图片损坏、过大或无法安全解码。', 422, 'invalid_image');
  }
}
export function validName(encoded: string | undefined) {
  let name: string;
  try { name = decodeURIComponent(encoded || '').trim(); } catch { throw new InputError('角色名字编码无效。'); }
  if (!name) name = '新朋友';
  if (name.length > 30 || /[\u0000-\u001f\u007f<>\\/]/u.test(name) || name.includes('..')) throw new InputError('名字最多 30 个字，不能包含路径或控制字符。', 400, 'invalid_name');
  return name;
}
