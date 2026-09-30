/** Shared, browser-compatible attachment validation. Never accept paths or remote URLs. */
export interface ImageAttachment { type: 'image'; data: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; }
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 384 * 1024;
export const MAX_PROMPT_BYTES = 512 * 1024;
export const MAX_RPC_BYTES = 1024 * 1024;

export function validateImages(value: unknown): ImageAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) throw Error('Attach up to 4 images.');
  let total = 0;
  return value.map(image => {
    if (!image || typeof image !== 'object' || image.type !== 'image' ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) || typeof image.data !== 'string') {
      throw Error('Attachments must be PNG, JPEG, or WebP images.');
    }
    const data: string = image.data;
    if (!data.length || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
        data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw Error('Invalid image data or images exceed the combined 384 KiB limit.');
    }
    let bytes: string;
    try { bytes = atob(data); } catch { throw Error('Invalid base64 image data.'); }
    // Reject noncanonical encodings as well as MIME spoofing (including SVG/HTML).
    const png = bytes.startsWith('\x89PNG\r\n\x1a\n');
    const jpeg = bytes.startsWith('\xff\xd8\xff');
    const webp = bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
    if (btoa(bytes) !== data || !(image.mimeType === 'image/png' ? png : image.mimeType === 'image/jpeg' ? jpeg : webp)) {
      throw Error('Image data does not match its PNG, JPEG, or WebP type.');
    }
    total += bytes.length;
    if (total > MAX_IMAGE_BYTES) throw Error('Images exceed the combined 384 KiB limit.');
    return { type: 'image', data, mimeType: image.mimeType };
  });
}

export function promptCommand(message: unknown, images?: unknown) {
  const attachments = validateImages(images);
  if (typeof message !== 'string' || (!message.trim() && !attachments.length)) throw Error('Enter a message or attach an image.');
  if (message.includes('\0')) throw Error('Message contains an invalid NUL character.');
  if (message.trimStart().startsWith('/')) throw Error('Slash commands are not supported in desktop-owned sessions.');
  if (new TextEncoder().encode(message).length > MAX_PROMPT_BYTES) throw Error('Message exceeds the 512 KiB limit.');
  const command = { type: 'prompt', message, streamingBehavior: 'followUp', ...(attachments.length ? { images: attachments } : {}) };
  // Reserve the actual UUID and LF used by RpcClient; escaping can enlarge even small text.
  if (new TextEncoder().encode(JSON.stringify({ ...command, id: '0'.repeat(36) }) + '\n').length > MAX_RPC_BYTES) {
    throw Error('Message and images exceed the 1 MiB request limit. Shorten the message or remove images.');
  }
  return command;
}

export function supportsImages(model: unknown): boolean {
  return !!model && typeof model === 'object' && 'input' in model && Array.isArray(model.input) && model.input.includes('image');
}
