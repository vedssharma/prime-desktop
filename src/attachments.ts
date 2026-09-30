import { MAX_IMAGES, MAX_IMAGE_BYTES, validateImages, type ImageAttachment } from '../electron/attachments';

export interface DraftImage extends ImageAttachment { id: string; name: string; }
export const imageURL = (image: ImageAttachment) => `data:${image.mimeType};base64,${image.data}`;

export async function readImageFiles(files: File[]): Promise<DraftImage[]> {
  if (files.length > MAX_IMAGES) throw Error('Attach up to 4 images.');
  if (files.reduce((total, file) => total + file.size, 0) > MAX_IMAGE_BYTES) throw Error('Images must total 384 KiB or less. Resize them before attaching.');
  const result: DraftImage[] = [];
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('Choose PNG, JPEG, or WebP images.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const image = validateImages([{type:'image', mimeType:file.type, data:btoa(binary)}])[0];
    // A header alone is insufficient for a usable preview; reject corrupt raster files.
    const preview = new Image();
    preview.src = imageURL(image);
    try { await preview.decode(); } catch { throw Error(`${file.name.slice(0, 200)} could not be decoded as an image.`); }
    if (preview.naturalWidth * preview.naturalHeight > 16_000_000 || preview.naturalWidth > 8192 || preview.naturalHeight > 8192) {
      throw Error('Resize images to at most 16 megapixels and 8192 pixels on each side.');
    }
    result.push({...image, id:crypto.randomUUID(), name:file.name.slice(0, 200)});
  }
  validateImages(result);
  return result;
}

export function sameImages(a?: ImageAttachment[], b?: ImageAttachment[]): boolean {
  return (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((image, index) => image.mimeType === b?.[index].mimeType && image.data === b?.[index].data);
}
