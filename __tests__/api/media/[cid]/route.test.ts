/** @jest-environment node */
jest.mock('@/lib/mediaUrlSigning', () => ({
  verifyMediaUrlSignature: jest.fn(),
}));

import { GET } from '../../../../app/api/media/[cid]/route';
import { NextRequest } from 'next/server';
import { verifyMediaUrlSignature } from '@/lib/mediaUrlSigning';

const mockVerify = verifyMediaUrlSignature as jest.Mock;

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, { headers });
}

function mockFetchOnce(response: Partial<Response> & { ok: boolean }) {
  const body =
    response.body ??
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ...response,
    body,
  } as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  process.env.NEXT_PUBLIC_APP_URL = 'https://scoutoff.app';
  delete process.env.MEDIA_URL_SIGNING_SECRET;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/media/[cid] — happy path', () => {
  it('streams the upstream body and sets long-lived immutable cache headers', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: makeBody([new Uint8Array([1])]),
      headers: new Headers({ 'content-type': 'image/webp' }),
    } as unknown as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('vary')).toBe('Range, Accept');
  });

  it('falls back to the next gateway when the primary fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 502 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeBody([new Uint8Array([1])]),
        headers: new Headers({ 'content-type': 'image/png' }),
      } as unknown as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns 502 when every gateway fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
    } as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });

    expect(res.status).toBe(502);
  });
});

describe('GET /api/media/[cid] — input validation', () => {
  it('returns 400 when cid is empty', async () => {
    const req = makeRequest('http://localhost:3000/api/media/');
    const res = await GET(req, { params: { cid: '' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/media/[cid] — referrer gating (no signature)', () => {
  it('allows a request with no Referer header', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: makeBody([new Uint8Array([1])]),
      headers: new Headers({ 'content-type': 'image/png' }),
    } as unknown as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });
    expect(res.status).toBe(200);
  });

  it('allows a same-origin Referer', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: makeBody([new Uint8Array([1])]),
      headers: new Headers({ 'content-type': 'image/png' }),
    } as unknown as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      {
        referer: 'https://scoutoff.app/player/abc',
      },
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a cross-site Referer', async () => {
    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      {
        referer: 'https://evil-hotlinker.example/steal',
      },
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/media/[cid] — signed URL handling', () => {
  it('accepts a request with a valid signature even from a cross-site Referer', async () => {
    mockVerify.mockReturnValue(true);
    mockFetchOnce({
      ok: true,
      status: 200,
      body: makeBody([new Uint8Array([1])]),
      headers: new Headers({ 'content-type': 'image/png' }),
    } as unknown as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG?exp=9999999999&sig=deadbeef',
      { referer: 'https://evil-hotlinker.example/steal' },
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a request with an invalid signature', async () => {
    mockVerify.mockReturnValue(false);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG?exp=9999999999&sig=bad',
    );
    const res = await GET(req, {
      params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    });
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/media/[cid] — rate limiting', () => {
  it('returns 429 with Retry-After once a single IP exceeds the window limit', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: makeBody([new Uint8Array([1])]),
      headers: new Headers({ 'content-type': 'image/png' }),
    } as unknown as Response);

    const ip = `rate-limit-test-ip-${Math.random()}`;
    let lastRes;
    for (let i = 0; i < 121; i++) {
      const req = makeRequest(
        'http://localhost:3000/api/media/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        {
          'x-forwarded-for': ip,
        },
      );
      lastRes = await GET(req, {
        params: { cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
      });
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.headers.get('retry-after')).toBe('60');
  });
});

function makeBody(
  chunks: Uint8Array[],
  failOnChunkIndex?: number,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (failOnChunkIndex !== undefined && index >= failOnChunkIndex) {
        controller.error(new Error('stream failed'));
        return;
      }
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

describe('GET /api/media/[cid] — HTTP Range support', () => {
  it('returns 206 with Content-Range when upstream honors Range', async () => {
    const chunk = new Uint8Array([1, 2, 3, 4]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 206,
      body: makeBody([chunk]),
      headers: new Headers({
        'content-type': 'video/mp4',
        'content-range': 'bytes 1024-1027/20971520',
        'content-length': '4',
        'accept-ranges': 'bytes',
      }),
    } as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB',
      {
        range: 'bytes=1024-1027',
      },
    );
    const res = await GET(req, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 1024-1027/20971520');
    expect(res.headers.get('content-length')).toBe('4');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB'),
      expect.objectContaining({
        headers: { Range: 'bytes=1024-1027' },
      }),
    );
  });

  it('falls back to 200 when upstream ignores Range', async () => {
    const chunk = new Uint8Array(1024).fill(1);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeBody([chunk]),
      headers: new Headers({
        'content-type': 'video/mp4',
        'content-length': '1024',
      }),
    } as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB',
      {
        range: 'bytes=0-1023',
      },
    );
    const res = await GET(req, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBeNull();
  });

  it('simulates seek/scrub via a second Range request for a large clip', async () => {
    const firstChunk = new Uint8Array(4096).fill(2);
    const seekChunk = new Uint8Array(4096).fill(9);

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 206,
        body: makeBody([firstChunk]),
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-4095/20971520',
          'content-length': '4096',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 206,
        body: makeBody([seekChunk]),
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-range': 'bytes 1048576-1048576+4095/20971520',
          'content-length': '4096',
        }),
      } as Response);

    const startReq = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB',
      {
        range: 'bytes=0-4095',
      },
    );
    const startRes = await GET(startReq, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });
    expect(startRes.status).toBe(206);

    const seekReq = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB',
      {
        range: 'bytes=1048576-1048576+4095',
      },
    );
    const seekRes = await GET(seekReq, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });
    expect(seekRes.status).toBe(206);
    expect(seekRes.headers.get('content-range')).toContain('1048576');
  });
});

describe('GET /api/media/[cid] — mid-stream gateway failover', () => {
  it('retries the next gateway when the first upstream stream fails during read-ahead', async () => {
    const okChunk = new Uint8Array([5, 6, 7]);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeBody([], 0),
        headers: new Headers({ 'content-type': 'video/mp4' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeBody([okChunk]),
        headers: new Headers({ 'content-type': 'video/mp4' }),
      } as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB',
    );
    const res = await GET(req, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(Array.from(value!)).toEqual([5, 6, 7]);
  });

  it('surfaces a clean error when every gateway fails during read-ahead', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: makeBody([], 0),
      headers: new Headers({ 'content-type': 'video/mp4' }),
    } as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB',
    );
    const res = await GET(req, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });

    expect(res.status).toBe(502);
  });
});

describe('GET /api/media/[cid] — Range with signature/referrer gating', () => {
  it('accepts a valid signature with a Range header', async () => {
    mockVerify.mockReturnValue(true);
    mockFetchOnce({
      ok: true,
      status: 206,
      body: makeBody([new Uint8Array([1])]),
      headers: new Headers({
        'content-type': 'video/mp4',
        'content-range': 'bytes 0-0/100',
        'content-length': '1',
      }),
    } as unknown as Response);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB?exp=9999999999&sig=deadbeef',
      { range: 'bytes=0-0' },
    );
    const res = await GET(req, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });
    expect(res.status).toBe(206);
  });

  it('rejects an invalid signature with a Range header', async () => {
    mockVerify.mockReturnValue(false);

    const req = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB?exp=9999999999&sig=bad',
      { range: 'bytes=0-1023' },
    );
    const res = await GET(req, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/media/[cid] — startup latency (no-regression guard)', () => {
  it('delivers the first byte quickly for a representative 20MB clip (full-file, no Range)', async () => {
    const firstByte = new Uint8Array([0x00]);
    mockFetchOnce({
      ok: true,
      status: 200,
      body: makeBody([firstByte]),
      headers: new Headers({
        'content-type': 'video/mp4',
        'content-length': '20971520',
      }),
    } as unknown as Response);

    const start = performance.now();
    const req = makeRequest(
      'http://localhost:3000/api/media/QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB',
    );
    const res = await GET(req, {
      params: { cid: 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
    });
    const reader = res.body!.getReader();
    await reader.read();
    const elapsed = performance.now() - start;

    // Method: measure wall time from route handler entry to first body chunk
    // via ReadableStream reader — same path browsers use for first-byte delivery.
    // Budget: 500ms in unit tests (mocked upstream, no real network).
    expect(elapsed).toBeLessThan(500);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/media/[cid] — CID validation', () => {
  const V1_BASE32 =
    'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

  it.each([
    ['CIDv0', 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'],
    ['CIDv1', V1_BASE32],
  ])('accepts a valid %s and encodes the upstream URL', async (_label, cid) => {
    mockFetchOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
    } as unknown as Response);

    const res = await GET(
      makeRequest(`http://localhost:3000/api/media/${cid}`),
      { params: { cid } },
    );

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/${cid}$`)),
      expect.anything(),
    );
  });

  it.each([
    [
      'path traversal',
      'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/../../ipns/something',
    ],
    ['encoded traversal', `${V1_BASE32}..%2F..%2Fipns%2Fsomething`],
    [
      'query injection',
      'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG?filename=evil.html',
    ],
    ['fragment', 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG#x'],
    ['overlong input', `b${'a'.repeat(120)}`],
    ['non-CID string', 'QmAbc123'],
  ])(
    'rejects %s with an uncacheable 400 before any upstream fetch',
    async (_label, cid) => {
      const res = await GET(makeRequest('http://localhost:3000/api/media/x'), {
        params: { cid },
      });

      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('cache-control')).not.toContain('immutable');
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
});
