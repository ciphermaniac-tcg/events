import test from 'node:test';
import assert from 'node:assert/strict';

import { readBoundedBytes } from '../../functions/lib/api/bytes.ts';
import { chunkedRequest } from '../__utils__/chunkedRequest.ts';

const URL = 'https://example.test/api';

const put = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(URL, { method: 'PUT', body, headers });

const chunked = (chunks: Uint8Array[]) => chunkedRequest(URL, 'PUT', chunks);

test('reads a body under or exactly at the cap, in one buffer across chunks', async () => {
  assert.deepEqual(await readBoundedBytes(put(new Uint8Array([1, 2, 3])), 8), {
    ok: true,
    bytes: new Uint8Array([1, 2, 3])
  });
  const { request } = chunked([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]);
  assert.deepEqual(await readBoundedBytes(request, 5), { ok: true, bytes: new Uint8Array([1, 2, 3, 4, 5]) });
});

test('refuses on the declared length without reading the body', async () => {
  const request = put(new Uint8Array(4), { 'content-length': '9999' });
  assert.deepEqual(await readBoundedBytes(request, 64), { ok: false, reason: 'too-large' });
  assert.equal(request.bodyUsed, false);
});

test('stops reading a chunked body once it passes the cap', async () => {
  const chunk = new Uint8Array(10);
  const { request, pulled } = chunked(Array.from({ length: 100 }, () => chunk));
  assert.deepEqual(await readBoundedBytes(request, 25), { ok: false, reason: 'too-large' });
  assert.ok(pulled() < 10, `read ${pulled()} chunks of 100`);
});

test('no body is no bytes, and a stream that fails is unreadable', async () => {
  assert.deepEqual(await readBoundedBytes(put(null), 8), { ok: true, bytes: new Uint8Array(0) });
  const failing = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('connection reset'));
    }
  });
  const request = new Request(URL, { method: 'PUT', body: failing, duplex: 'half' } as RequestInit);
  assert.deepEqual(await readBoundedBytes(request, 8), { ok: false, reason: 'unreadable' });
});
