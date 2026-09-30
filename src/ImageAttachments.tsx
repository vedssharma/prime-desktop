import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { ImageAttachment } from '../shared/types';
import { validateImages } from '../electron/attachments';
import { imageURL, type DraftImage } from './attachments';

export function ImagePicker({ disabled, busy, reason, onFiles }: { disabled: boolean; busy: boolean; reason: string; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple tabIndex={-1} aria-label="Choose image attachments" disabled={disabled || busy} onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length) onFiles(files);
    }} />
    <button type="button" className="attachment-button" aria-label="Attach images" disabled={disabled || busy} title={disabled ? reason : 'Attach PNG, JPEG, or WebP images (up to 4; 384 KiB total)'} onClick={() => input.current?.click()}><ImagePlus size={16} />{busy && <span>Reading…</span>}</button>
  </>;
}

export function DraftImages({ images, onRemove }: { images: DraftImage[]; onRemove: (id: string) => void }) {
  if (!images.length) return null;
  return <div className="draft-images" aria-label="Draft image attachments">{images.map(image => <div className="draft-image" key={image.id}>
    <img src={imageURL(image)} alt={image.name} />
    <span title={image.name}>{image.name}</span>
    <button type="button" aria-label={`Remove ${image.name}`} onClick={() => onRemove(image.id)}><X size={14} /></button>
  </div>)}</div>;
}

export function MessageImages({ images }: { images?: ImageAttachment[] }) {
  if (!images?.length) return null;
  let safe: ImageAttachment[];
  try { safe = validateImages(images); } catch { return <p>Image attachment unavailable.</p>; }
  return <div className="message-images">{safe.map((image, index) => <img key={index} src={imageURL(image)} alt={`Image attachment ${index + 1}`} loading="lazy" />)}</div>;
}
