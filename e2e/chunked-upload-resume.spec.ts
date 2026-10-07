import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockSorobanRpc } from './fixtures/mock-contract';

/**
 * Resumable highlight-reel upload across a page reload (#1360, #664, #1003).
 *
 * The /api/ipfs/upload/{init,chunk,status,complete} endpoints are replaced by
 * an in-test fake so the spec doesn't depend on Pinata: it exercises the
 * client side of the flow — localStorage persistence (lib/uploadResumeStore),
 * the status lookup, file re-selection, and resuming from the last
 * acknowledged chunk.
 */

const CHUNK_SIZE = 1024 * 1024; // lib/ipfs.ts CHUNK_SIZE_BYTES
const TOTAL_CHUNKS = 5;
const RESUME_KEY = 'promiscope:upload-resume';
const MOCK_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

/** A 5 MB file whose leading bytes are a valid MP4 `ftyp` box. */
function makeMp4(): Buffer {
  const buf = Buffer.alloc(TOTAL_CHUNKS * CHUNK_SIZE);
  for (let i = 0; i < buf.length; i += 4) {
    buf.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, i);
  }
  const ftyp = new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x18,
    0x66,
    0x74,
    0x79,
    0x70, // size + 'ftyp'
    0x69,
    0x73,
    0x6f,
    0x6d,
    0x00,
    0x00,
    0x02,
    0x00, // 'isom', minor version
    0x69,
    0x73,
    0x6f,
    0x6d,
    0x6d,
    0x70,
    0x34,
    0x31, // 'isom', 'mp41'
  ]);
  buf.set(ftyp, 0);
  return buf;
}

/** Stateful stand-in for the chunked-upload API routes. */
function mockChunkedUploadApi(page: Page) {
  const state = {
    received: new Set<number>(),
    chunkRequests: [] as number[],
    failFromChunk: 2 as number | null, // abort chunk 3 (index 2) onward
  };

  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  page.route('**/api/ipfs/upload/init', (route) =>
    json(route, { sessionId: 'e2e-session' }),
  );
  page.route('**/api/ipfs/upload/chunk', (route) => {
    const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
    const index = Number(/name="chunkIndex"\r\n\r\n(\d+)/.exec(body)?.[1]);
    state.chunkRequests.push(index);
    if (state.failFromChunk !== null && index >= state.failFromChunk) {
      return route.abort('failed');
    }
    state.received.add(index);
    return json(route, {
      receivedChunks: state.received.size,
      totalChunks: TOTAL_CHUNKS,
    });
  });
  page.route('**/api/ipfs/upload/status**', (route) =>
    json(route, {
      receivedChunks: [...state.received].sort((a, b) => a - b),
      totalChunks: TOTAL_CHUNKS,
    }),
  );
  page.route('**/api/ipfs/upload/complete', (route) =>
    state.received.size === TOTAL_CHUNKS
      ? json(route, { cid: MOCK_CID })
      : route.fulfill({ status: 400, body: '{"error":"Incomplete upload"}' }),
  );

  return state;
}

test.describe('chunked highlight-reel upload', () => {
  // The interrupted chunk is retried with backoff (~7.5 s) before giving up.
  test.setTimeout(120_000);

  test('resumes from the last acknowledged chunk after a page reload', async ({
    page,
    wallet,
  }) => {
    mockSorobanRpc(page);
    const api = mockChunkedUploadApi(page);
    const video = {
      name: 'highlight.mp4',
      mimeType: 'video/mp4',
      buffer: makeMp4(),
    };

    await page.goto('/en');
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.getByRole('button', { name: /freighter/i }).click();
    await expect(
      page.getByText(
        wallet.publicKey.slice(0, 4) + '…' + wallet.publicKey.slice(-4),
      ),
    ).toBeVisible();

    await page.goto('/en/player');
    await page.getByLabel('Name *').fill('Ada Okafor');
    await page.getByLabel('Age *').fill('19');
    await page.getByLabel('Nationality *').fill('Nigeria');
    await page.getByLabel('Region *').selectOption({ label: 'Nigeria' });
    await page.getByLabel('Position *').selectOption({ label: 'Striker' });
    await page.getByRole('button', { name: 'Continue' }).click();

    // First attempt: chunks 1-2 succeed, chunk 3 fails on every retry.
    await page.locator('#video-upload-input').setInputFiles(video);
    await expect(page.getByText(/upload interrupted/i)).toBeVisible({
      timeout: 60_000,
    });
    expect([...api.received].sort()).toEqual([0, 1]);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), RESUME_KEY),
    ).not.toBeNull();

    // Reload: the wizard stays on the upload step and offers to resume.
    api.failFromChunk = null;
    await page.reload();
    await expect(
      page.getByText(
        `Resume upload (2 of ${TOTAL_CHUNKS} chunks uploaded): select highlight.mp4 again to continue.`,
      ),
    ).toBeVisible();

    // Re-select the same file: only the 3 remaining chunks are sent.
    api.chunkRequests = [];
    await page.locator('#video-upload-input').setInputFiles(video);
    await expect(
      page.getByText(/highlight reel already uploaded/i),
    ).toBeVisible({ timeout: 60_000 });
    expect(api.chunkRequests).toEqual([2, 3, 4]);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), RESUME_KEY),
    ).toBeNull();
  });
});
