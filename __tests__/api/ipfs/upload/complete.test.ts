/** @jest-environment node */
import { POST } from '@/app/api/ipfs/upload/complete/route';
import { NextRequest } from 'next/server';
import axios from 'axios';
import {
  initSession,
  writeChunk,
  getSessionStatus,
  __resetForTests,
} from '@/lib/chunkedUploadStore';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const JPEG_HEADER = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const INVALID_HEADER = new Uint8Array(12);

function makeRequest(body: unknown, ip = 'ip-complete-default'): NextRequest {
  return new NextRequest('http://localhost:3000/api/ipfs/upload/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

async function seedSession(header: Uint8Array, ip: string) {
  const { sessionId } = await initSession({
    filename: 'photo.jpg',
    fileType: 'image/jpeg',
    fileSize: header.length,
    totalChunks: 1,
  });
  await writeChunk(sessionId, 0, Buffer.from(header));
  return sessionId;
}

describe('POST /api/ipfs/upload/complete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PINATA_API_KEY = 'test-api-key';
    process.env.PINATA_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_SECRET;
    jest.restoreAllMocks();
    __resetForTests();
  });

  it('returns 503 before doing any work when Pinata credentials are missing', async () => {
    delete process.env.PINATA_SECRET;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const sessionId = await seedSession(JPEG_HEADER, 'ip-complete-nocreds');
    const res = await POST(makeRequest({ sessionId }, 'ip-complete-nocreds'));
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'IPFS uploads are not configured',
    });
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/ipfs/upload/complete',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': 'ip-badjson',
        },
        body: 'not json',
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when sessionId is missing', async () => {
    const res = await POST(makeRequest({}, 'ip-nosession'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown session', async () => {
    const res = await POST(makeRequest({ sessionId: 'nope' }, 'ip-unknown'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an incomplete upload (missing chunks)', async () => {
    const { sessionId } = await initSession({
      filename: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: 20,
      totalChunks: 2,
    });
    await writeChunk(sessionId, 0, Buffer.from(new Uint8Array(10)));

    const res = await POST(makeRequest({ sessionId }, 'ip-incomplete'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/incomplete/i);
  });

  it('returns 400 when the assembled file content does not match its declared MIME type', async () => {
    const sessionId = await seedSession(INVALID_HEADER, 'ip-badsignature');
    const res = await POST(makeRequest({ sessionId }, 'ip-badsignature'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not match/i);
    // Session should be cleaned up on rejection.
    expect(await getSessionStatus(sessionId)).toBeNull();
  });

  it('assembles the file and uploads it to Pinata, returning the CID', async () => {
    const sessionId = await seedSession(JPEG_HEADER, 'ip-success');
    mockedAxios.post.mockResolvedValueOnce({
      data: { IpfsHash: 'QmChunkedCID' },
    });
    mockedAxios.get.mockResolvedValueOnce({ data: JPEG_HEADER.buffer });

    const res = await POST(makeRequest({ sessionId }, 'ip-success'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cid: 'QmChunkedCID' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      expect.any(FormData),
      expect.objectContaining({
        headers: expect.objectContaining({
          pinata_api_key: 'test-api-key',
          pinata_secret_api_key: 'test-secret',
        }),
      }),
    );
    // Successful completion cleans up the session.
    expect(await getSessionStatus(sessionId)).toBeNull();
  });

  it('returns 502 and preserves the session when the Pinata upload fails, so a retry can skip re-uploading chunks', async () => {
    const sessionId = await seedSession(JPEG_HEADER, 'ip-pinatafail');
    mockedAxios.post.mockRejectedValueOnce(new Error('Pinata is down'));

    const res = await POST(makeRequest({ sessionId }, 'ip-pinatafail'));

    expect(res.status).toBe(502);
    expect(await getSessionStatus(sessionId)).not.toBeNull();
  });

  describe('post-upload integrity verification (issue #699)', () => {
    it('returns 502 and preserves the session when the gateway serves mismatched content', async () => {
      const sessionId = await seedSession(JPEG_HEADER, 'ip-verify-mismatch');
      mockedAxios.post.mockResolvedValueOnce({
        data: { IpfsHash: 'QmMismatch' },
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: new Uint8Array([9, 9, 9, 9]).buffer,
      });

      const res = await POST(makeRequest({ sessionId }, 'ip-verify-mismatch'));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toMatch(/failed integrity verification/i);
      expect(await getSessionStatus(sessionId)).not.toBeNull();
    });

    it('returns 502 with a retryable error when the gateway cannot be reached for verification', async () => {
      const sessionId = await seedSession(JPEG_HEADER, 'ip-verify-unreachable');
      mockedAxios.post.mockResolvedValueOnce({
        data: { IpfsHash: 'QmGatewayDown' },
      });
      mockedAxios.get.mockRejectedValueOnce(new Error('gateway timeout'));

      const res = await POST(
        makeRequest({ sessionId }, 'ip-verify-unreachable'),
      );

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toMatch(/could not verify the upload/i);
      expect(await getSessionStatus(sessionId)).not.toBeNull();
    });
  });
});
