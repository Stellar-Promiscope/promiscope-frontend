/** @jest-environment node */
import { POST as chunkPOST } from '@/app/api/ipfs/upload/chunk/route';
import { POST as completePOST } from '@/app/api/ipfs/upload/complete/route';
import { GET as statusGET } from '@/app/api/ipfs/upload/status/route';
import { NextRequest } from 'next/server';
import axios from 'axios';
import {
  initSession,
  writeChunk,
  __resetForTests,
} from '@/lib/chunkedUploadStore';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';

jest.mock('axios');

const OWNER = 'GOWNERWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const OTHER = 'GOTHERWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const JPEG_HEADER = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

let sidCounter = 0;
function cookieFor(wallet: string): string {
  const sid = `upload-sid-${sidCounter++}`;
  const token = createSessionToken(wallet, 'access', 20 * 60, { sid });
  SessionStore.getInstance().create(sid, wallet, Date.now() + 60 * 60 * 1000);
  return `session=${token}`;
}

function headers(cookie?: string, ip = 'ip-ownership'): Record<string, string> {
  const h: Record<string, string> = { 'x-forwarded-for': ip };
  if (cookie) h.cookie = cookie;
  return h;
}

function chunkReq(sessionId: string, cookie?: string) {
  const form = new FormData();
  form.set('sessionId', sessionId);
  form.set('chunkIndex', '0');
  form.set('chunk', new Blob([JPEG_HEADER]));
  return new NextRequest('http://localhost:3000/api/ipfs/upload/chunk', {
    method: 'POST',
    headers: headers(cookie),
    body: form,
  });
}

function completeReq(sessionId: string, cookie?: string) {
  return new NextRequest('http://localhost:3000/api/ipfs/upload/complete', {
    method: 'POST',
    headers: { ...headers(cookie), 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

function statusReq(sessionId: string, cookie?: string) {
  const url = new URL('http://localhost:3000/api/ipfs/upload/status');
  url.searchParams.set('sessionId', sessionId);
  return new NextRequest(url, { headers: headers(cookie) });
}

async function ownedSession() {
  const { sessionId } = await initSession({
    filename: 'photo.jpg',
    fileType: 'image/jpeg',
    fileSize: JPEG_HEADER.length,
    totalChunks: 1,
    ownerWallet: OWNER,
  });
  return sessionId;
}

beforeEach(() => {
  SessionStore.resetInstance();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  SessionStore.resetInstance();
  await __resetForTests();
  jest.restoreAllMocks();
});

describe('chunked upload session ownership (issue #1328)', () => {
  it.each([
    ['anonymous caller', undefined],
    ['different wallet', () => cookieFor(OTHER)],
  ])('returns 404 on chunk, complete and status for a %s', async (_l, mk) => {
    const sessionId = await ownedSession();
    const cookie = mk?.();

    expect((await chunkPOST(chunkReq(sessionId, cookie))).status).toBe(404);
    expect((await completePOST(completeReq(sessionId, cookie))).status).toBe(
      404,
    );
    expect((await statusGET(statusReq(sessionId, cookie))).status).toBe(404);
  });

  it('lets the owning wallet use chunk, status and complete', async () => {
    const sessionId = await ownedSession();
    const cookie = cookieFor(OWNER);

    expect((await chunkPOST(chunkReq(sessionId, cookie))).status).toBe(200);
    expect((await statusGET(statusReq(sessionId, cookie))).status).toBe(200);

    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { IpfsHash: 'QmOwner' },
    });
    const res = await completePOST(completeReq(sessionId, cookie));
    expect(res.status).not.toBe(404);
  });

  it('does not let a wallet hijack an anonymous session', async () => {
    const { sessionId } = await initSession({
      filename: 'photo.jpg',
      fileType: 'image/jpeg',
      fileSize: JPEG_HEADER.length,
      totalChunks: 1,
    });
    await writeChunk(sessionId, 0, Buffer.from(JPEG_HEADER));

    expect(
      (await statusGET(statusReq(sessionId, cookieFor(OTHER)))).status,
    ).toBe(404);
  });
});
