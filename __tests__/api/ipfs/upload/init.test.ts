/** @jest-environment node */
import { POST } from '@/app/api/ipfs/upload/init/route';
import { NextRequest } from 'next/server';
import { __resetForTests } from '@/lib/chunkedUploadStore';

function makeRequest(body: unknown, ip = 'ip-init-default'): NextRequest {
  return new NextRequest('http://localhost:3000/api/ipfs/upload/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.PINATA_API_KEY = 'test-api-key';
  process.env.PINATA_SECRET = 'test-secret';
});

afterEach(() => {
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_SECRET;
  jest.restoreAllMocks();
  __resetForTests();
});

describe('POST /api/ipfs/upload/init', () => {
  it('returns 503 before doing any work when Pinata credentials are missing', async () => {
    delete process.env.PINATA_SECRET;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(
      makeRequest(
        {
          filename: 'clip.mp4',
          fileType: 'video/mp4',
          fileSize: 100,
          totalChunks: 1,
        },
        'ip-init-nocreds',
      ),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'IPFS uploads are not configured',
    });
  });
  it('returns 201 with a sessionId for a valid request', async () => {
    const res = await POST(
      makeRequest({
        filename: 'clip.mp4',
        fileType: 'video/mp4',
        fileSize: 10 * 1024 * 1024,
        totalChunks: 10,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/ipfs/upload/init', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': 'ip-badjson',
      },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when filename is missing', async () => {
    const res = await POST(
      makeRequest(
        { fileType: 'video/mp4', fileSize: 100, totalChunks: 1 },
        'ip-nofilename',
      ),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for a disallowed MIME type', async () => {
    const res = await POST(
      makeRequest(
        {
          filename: 'doc.pdf',
          fileType: 'application/pdf',
          fileSize: 100,
          totalChunks: 1,
        },
        'ip-badmime',
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not allowed/i);
  });

  it('returns 400 when fileSize exceeds the 100 MB limit', async () => {
    const res = await POST(
      makeRequest(
        {
          filename: 'clip.mp4',
          fileType: 'video/mp4',
          fileSize: 101 * 1024 * 1024,
          totalChunks: 100,
        },
        'ip-oversized',
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/100 MB/i);
  });

  it('returns 400 when totalChunks is not a positive integer', async () => {
    const res = await POST(
      makeRequest(
        {
          filename: 'clip.mp4',
          fileType: 'video/mp4',
          fileSize: 100,
          totalChunks: 0,
        },
        'ip-badchunks',
      ),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when the implied chunk size is unreasonably small', async () => {
    const res = await POST(
      makeRequest(
        {
          filename: 'clip.mp4',
          fileType: 'video/mp4',
          fileSize: 1024,
          totalChunks: 1000, // ~1 byte/chunk
        },
        'ip-tinychunks',
      ),
    );
    expect(res.status).toBe(400);
  });

  it('rate limits after exceeding 20 requests from the same IP within the window', async () => {
    const ip = 'ip-init-rate-limited';
    let lastRes;
    for (let i = 0; i < 21; i++) {
      lastRes = await POST(
        makeRequest(
          {
            filename: 'clip.mp4',
            fileType: 'video/mp4',
            fileSize: 100,
            totalChunks: 1,
          },
          ip,
        ),
      );
    }
    expect(lastRes!.status).toBe(429);
    expect(lastRes!.headers.get('Retry-After')).toBeTruthy();
  });
});
