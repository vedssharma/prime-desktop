import test from 'node:test';
import assert from 'node:assert/strict';
import { imageURL, readImageFiles, sameImages } from '../src/attachments.js';
import { MAX_IMAGE_BYTES } from '../electron/attachments.js';

const png = { type: 'image' as const, mimeType: 'image/png' as const, data: 'AAAA' };
const jpeg = { type: 'image' as const, mimeType: 'image/jpeg' as const, data: 'AAAA' };

test('image previews are data URLs of the attachment type', () => {
  assert.equal(imageURL(png), 'data:image/png;base64,AAAA');
});

test('image lists compare by type and content, treating missing lists as empty', () => {
  assert.equal(sameImages(undefined, undefined), true);
  assert.equal(sameImages([], undefined), true);
  assert.equal(sameImages([png], [{ ...png }]), true);
  assert.equal(sameImages([png], [jpeg]), false);
  assert.equal(sameImages([png], [{ ...png, data: 'BBBB' }]), false);
  assert.equal(sameImages([png], []), false);
  assert.equal(sameImages(undefined, [png]), false);
});

test('picked files are refused before reading when there are too many, they are too large, or not a supported type', async () => {
  const file = (name: string, type: string, size = 8) => new File([new Uint8Array(size)], name, { type });
  await assert.rejects(readImageFiles(Array.from({ length: 5 }, (_, i) => file(`${i}.png`, 'image/png'))), /up to 4 images/);
  await assert.rejects(readImageFiles([file('a.png', 'image/png', MAX_IMAGE_BYTES), file('b.png', 'image/png', 1)]), /384 KiB or less/);
  await assert.rejects(readImageFiles([file('a.gif', 'image/gif')]), /PNG, JPEG, or WebP/);
  await assert.rejects(readImageFiles([file('a.svg', 'image/svg+xml')]), /PNG, JPEG, or WebP/);
  assert.deepEqual(await readImageFiles([]), []);
});
