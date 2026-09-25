import assert from 'node:assert/strict'
import test from 'node:test'
import { detectMediaType, inspectMediaFile } from '../lib/media-upload.ts'

test('recognizes supported media signatures', () => {
  assert.equal(detectMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(detectMediaType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png')
  assert.equal(detectMediaType(new TextEncoder().encode('GIF89a')), 'image/gif')
  assert.equal(detectMediaType(new TextEncoder().encode('RIFFxxxxWEBP')), 'image/webp')
  assert.equal(detectMediaType(new TextEncoder().encode('xxxxftypisom')), 'video/mp4')
})

test('rejects unknown signatures and HEIC media declared as MP4', () => {
  assert.equal(detectMediaType(new TextEncoder().encode('not a media file')), null)
  assert.equal(detectMediaType(new TextEncoder().encode('xxxxftypheic')), null)
})

test('validates the declared MIME type and hashes the file', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const valid = new File([bytes], 'ad.png', { type: 'image/png' })
  const result = await inspectMediaFile(valid)
  assert.equal(result.mimeType, 'image/png')
  assert.match(result.hash, /^[0-9a-f]{64}$/)
  await assert.rejects(inspectMediaFile(new File([bytes], 'fake.jpg', { type: 'image/jpeg' })), /formato real/)
})
