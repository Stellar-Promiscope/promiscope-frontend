/** @jest-environment node */
import { POST } from '@/app/api/ipfs/upload/complete/route';
import { buildStreamingMultipartBody } from '@/lib/streamingMultipart';
import { NextRequest } from 'next/server';
import {
  initSession,
  writeChunk,
  prepareStreamedAssembly,
  getSessionStatus,
  __resetForTests,
} from '@/lib/chunkedUploadStore';
import {
  sha256Hex,
  sha256HexOfStream,
  verifyUploadedDigest,
  UploadVerificationError,
} from '@/lib/uploadVerification';

function completeRequest(sid: string, ip: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/ipfs/upload/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ sessionId: sid }),
  });
}

async function* bytesToStream(
  b: Buffer,
  piece = 64 * 1024,
): AsyncGenerator<Uint8Array> {
  for (let off = 0; off < b.length; off += piece) {
    yield new Uint8Array(b.subarray(off, Math.min(off + piece, b.length)));
  }
}

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__pinStreamedFileToIPFSForTests;
  delete g.__gatewayStreamForTests;
  __resetForTests();
  jest.restoreAllMocks();
});

describe('issue #1295 streaming complete pipeline', () => {
  it('multipart body streams framing + chunks in order with exact length', async () => {
    const a = Buffer.from('aaa-first-');
    const b = Buffer.from('bbb-second');
    const { sessionId } = await initSession({
      filename: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: a.length + b.length,
      totalChunks: 2,
    });
    await writeChunk(sessionId, 0, a);
    await writeChunk(sessionId, 1, b);
    const assembly = await prepareStreamedAssembly(sessionId);

    const boundary = 'test-boundary-1295';
    const { stream, contentLength, contentType } = buildStreamingMultipartBody(
      boundary,
      assembly.filename,
      assembly.fileType,
      assembly.totalBytes,
      assembly.chunks,
    );
    expect(contentType).toContain(boundary);
    // Collect the lazily-pulled stream. Importing 'stream/consumers' would
    // buffer with the same semantics; manual iteration keeps the assertion
    // explicit that framing + chunks arrive in order.
    const received: Uint8Array[] = [];
    let receivedLength = 0;
    for await (const piece of stream as unknown as AsyncIterable<Uint8Array>) {
      // Copy to plain-ArrayBuffer views so Buffer.concat() type-checks under
      // this project's DOM lib (see sha256Hex's note on the generic mismatch).
      received.push(new Uint8Array(piece));
      receivedLength += piece.length;
      if (receivedLength > contentLength + 16) {
        throw new Error('multipart stream exceeded declared length');
      }
    }
    const raw = Buffer.concat(received);
    expect(raw.length).toBe(contentLength);
    const text = raw.toString('binary');
    expect(text).toContain(`filename="clip.mp4"`);
    expect(text.indexOf('aaa-first-')).toBeLessThan(text.indexOf('bbb-second'));
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('digest verification still detects a corrupted gateway response', async () => {
    const file = Buffer.from('the streamed file');
    const expected = sha256Hex(file);
    await expect(
      verifyUploadedDigest('QmX', expected, () => bytesToStream(file)),
    ).resolves.toBeUndefined();
    await expect(
      verifyUploadedDigest('QmX', expected, () =>
        bytesToStream(Buffer.from('a different file')),
      ),
    ).rejects.toThrow(UploadVerificationError);
    await expect(
      verifyUploadedDigest('QmX', expected, () => {
        throw new Error('gateway timeout');
      }),
    ).rejects.toThrow(/could not verify/i);
  });

  it('sha256 of a stream matches sha256 of the buffer', async () => {
    const file = Buffer.from('streamed hashing must equal buffered hashing');
    await expect(sha256HexOfStream(bytesToStream(file))).resolves.toBe(
      sha256Hex(file),
    );
  });

  it('magic-byte gate runs before any byte is pinned', async () => {
    const bad = Buffer.alloc(12, 0);
    const { sessionId } = await initSession({
      filename: 'evil.jpg',
      fileType: 'image/jpeg',
      fileSize: bad.length,
      totalChunks: 1,
    });
    await writeChunk(sessionId, 0, bad);
    const g = globalThis as unknown as Record<string, unknown>;
    let pinned = false;
    g.__pinStreamedFileToIPFSForTests = async () => {
      pinned = true;
      return 'QmNope';
    };
    const res = await POST(completeRequest(sessionId, 'ip-1295-magic'));
    expect(res.status).toBe(400);
    expect(pinned).toBe(false);
    expect(await getSessionStatus(sessionId)).toBeNull();
  });
});
