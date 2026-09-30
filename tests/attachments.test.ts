import test from 'node:test';
import assert from 'node:assert/strict';
import { promptCommand, validateImages, MAX_IMAGE_BYTES, supportsImages } from '../electron/attachments.js';
import { normalizeMessages, parseSavedTranscript } from '../electron/prime.js';
import { conversationToMarkdown } from '../src/export.js';

export const png = { type: 'image' as const, mimeType: 'image/png' as const, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };

test('images reject URLs, executable formats, spoofed MIME, malformed base64 and excessive payloads', () => {
  assert.deepEqual(validateImages([png]), [png]);
  assert.deepEqual(validateImages(undefined), []);
  const excessive = { ...png, data: Buffer.concat([Buffer.from(png.data, 'base64'), Buffer.alloc(MAX_IMAGE_BYTES)]).toString('base64') };
  for (const value of [null, {}, [null], [{...png, mimeType: 'image/svg+xml'}], [{...png, mimeType: 'image/jpeg'}], [{...png, data: 'https://example.com/image.png'}], [{...png, data: 'AAAA='}], [{...png, data: 'a==='}], [excessive], Array(5).fill(png)]) assert.throws(() => validateImages(value));
  const large = { ...png, data: Buffer.concat([Buffer.from(png.data, 'base64'), Buffer.alloc(MAX_IMAGE_BYTES / 2)]).toString('base64') };
  assert.throws(() => validateImages([large, large]), /combined/);
  const boundary = {...png, data: Buffer.concat([Buffer.from(png.data, 'base64').subarray(0, 8), Buffer.alloc(MAX_IMAGE_BYTES - 8)]).toString('base64')};
  assert.equal(validateImages([boundary])[0].data, boundary.data);
});

test('prompt limit measures the complete escaped UTF-8 frame before admission', () => {
  assert.deepEqual(promptCommand('', [png]).images, [png]);
  assert.throws(() => promptCommand(''), /message or attach/);
  assert.throws(() => promptCommand('/login', [png]), /Slash/);
  assert.throws(() => promptCommand('é'.repeat(256 * 1024 + 1)), /512 KiB/);
  assert.throws(() => promptCommand('\x01'.repeat(200000)), /1 MiB/);
  const image = {...png, data: Buffer.concat([Buffer.from(png.data, 'base64').subarray(0,8), Buffer.alloc(MAX_IMAGE_BYTES - 8)]).toString('base64')};
  assert.throws(() => promptCommand('x'.repeat(512 * 1024), [image]), /1 MiB/);
  assert.equal(supportsImages({input: ['text','image']}), true);
  for (const model of [undefined, {}, {input: ['text']}, {input: 'image'}]) assert.equal(supportsImages(model), false);
});

test('live and saved transcripts preserve images and safely describe invalid attachments', () => {
  const record = { role: 'user', content: [{type:'text',text:'Look'}, png] };
  const live = normalizeMessages([record]);
  assert.deepEqual(live[0].images, [png]);
  const saved = normalizeMessages(parseSavedTranscript(JSON.stringify({type:'message',id:'m',parentId:null,message:record})));
  assert.deepEqual(saved[0].images, [png]);
  assert.equal(normalizeMessages([{role:'user',content:[png]}])[0].images?.length,1);
  assert.match(normalizeMessages([{role:'user',content:[{...png,data:'invalid'}]}])[0].content,/unavailable/);
  const md = conversationToMarkdown({title:'Images',cwd:'/tmp',model:'vision'},live);
  assert.ok(md.includes(`data:image/png;base64,${png.data}`));
});
