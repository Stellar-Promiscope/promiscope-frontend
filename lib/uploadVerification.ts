import crypto from 'crypto';
import axios from 'axios';

/**
 * Post-upload integrity verification for IPFS uploads (issue #699).
 *
 * Server-only: uses Node's `crypto` module. Never import this from a client
 * component.
 *
 * Why server-side rather than client-side: the alternative design is having
 * the browser hash the file before upload, then re-fetch the CID from the
 * gateway itself and compare. That doubles the client's bandwidth for every
 * upload (re-downloading a file that can be up to 100MB, over the same
 * low-bandwidth mobile connections app/api/ipfs/upload/complete's chunking
 * exists to be gentle with — see docs/chunked-video-upload.md), and adds
 * client-side crypto plumbing for no real benefit: this app's server already
 * holds the exact bytes it just handed to Pinata, so it can hash and re-fetch
 * without any extra load on the user's connection. The tradeoff is that this
 * verification's network hop (datacenter -> gateway) runs before the route
 * responds, adding to the request's latency — acceptable here since it's a
 * single small request to a gateway that's typically the same provider that
 * just pinned the content (fast, no public-DHT propagation wait), not
 * multiplied by the file's full size the way a client-side re-download would
 * be.
 *
 * This intentionally does NOT attempt to recompute the CID itself and
 * compare it to Pinata's response: a CIDv0 (the default `pinFileToIPFS`
 * returns) is a hash of a UnixFS DAG-PB-wrapped structure, not a plain
 * sha256 of the raw file bytes, so reproducing it exactly would mean
 * reimplementing IPFS's chunking/DAG format here just to match Pinata's
 * implementation. Instead, this re-fetches the CID from the gateway and
 * hashes *that* against a hash of the bytes we uploaded — which directly
 * checks the thing that actually matters: "is what's retrievable via this
 * CID identical to what we sent," regardless of CID format.
 */

const GATEWAY =
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs';

/** Generous but bounded — a hung gateway shouldn't hang the whole upload request. */
const VERIFY_TIMEOUT_MS = 15_000;

export class UploadVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadVerificationError';
  }
}

// The `new Uint8Array(bytes)` copy (rather than hashing `bytes` directly)
// sidesteps a @types/node-vs-DOM-lib generic mismatch — under this project's
// `lib: ["dom", ...]` tsconfig, `Buffer` (backed by `ArrayBufferLike`, which
// includes `SharedArrayBuffer`) doesn't structurally satisfy the
// `Uint8Array<ArrayBuffer>` that `crypto.BinaryLike` expects. Same fix
// app/api/ipfs/upload/complete/route.ts already uses when constructing a
// `File` from a `Buffer`.
export function sha256Hex(bytes: Buffer): string {
  return crypto
    .createHash('sha256')
    .update(new Uint8Array(bytes))
    .digest('hex');
}

/**
 * Incremental sha256 over an async byte stream — the constant-memory half
 * of issue #1295's pipeline. No chunk is retained after it is hashed: peak
 * residency is one yielded piece, not the file.
 */
export async function sha256HexOfStream(
  stream: AsyncIterable<Uint8Array | Buffer>,
): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const piece of stream) {
    // Copy into a plain-ArrayBuffer-backed view so @types/node's
    // Buffer-over-ArrayBufferLike generic satisfies BinaryLike — same
    // mismatch sha256Hex() documents above.
    hash.update(
      piece instanceof Uint8Array && !(piece instanceof Buffer)
        ? piece
        : new Uint8Array(piece),
    );
  }
  return hash.digest('hex');
}

/**
 * Re-fetches `cid` from the configured IPFS gateway and confirms the bytes
 * served back are byte-identical (by sha256) to `uploadedBytes` — the bytes
 * this server actually sent to Pinata. Throws {@link UploadVerificationError}
 * (with a message safe to surface to the end user) when the gateway can't be
 * reached or the content doesn't match, so a caller can treat the upload as
 * failed-but-retryable instead of returning a CID that may not resolve to
 * the right content.
 */
export async function verifyUploadedContent(
  cid: string,
  uploadedBytes: Buffer,
): Promise<void> {
  const expectedHash = sha256Hex(uploadedBytes);

  let fetchedBytes: Buffer;
  try {
    const response = await axios.get<ArrayBuffer>(`${GATEWAY}/${cid}`, {
      responseType: 'arraybuffer',
      timeout: VERIFY_TIMEOUT_MS,
    });
    fetchedBytes = Buffer.from(response.data);
  } catch {
    throw new UploadVerificationError(
      'Could not verify the upload against the IPFS gateway. Please try again.',
    );
  }

  const actualHash = sha256Hex(fetchedBytes);
  if (actualHash !== expectedHash) {
    throw new UploadVerificationError(
      'Uploaded file failed integrity verification. Please try again.',
    );
  }
}

/**
 * Digest-based verification (issue #1295): confirms the bytes served back
 * for `cid` hash to `expectedDigest` — the sha256 the server computed while
 * *streaming* the file to Pinata, without ever holding the file itself.
 * Throws the same {@link UploadVerificationError}s as
 * {@link verifyUploadedContent}, so callers treat mismatches identically.
 *
 * `fetchGatewayBytes` is injectable so tests can feed a byte stream without
 * touching the network; production passes a fetch-backed stream.
 */
export async function verifyUploadedDigest(
  cid: string,
  expectedDigest: string,
  fetchGatewayBytes?: () =>
    | AsyncIterable<Uint8Array | Buffer>
    | Promise<AsyncIterable<Uint8Array | Buffer>>,
): Promise<void> {
  let stream: AsyncIterable<Uint8Array | Buffer>;
  try {
    stream = fetchGatewayBytes
      ? await fetchGatewayBytes()
      : await fetchGatewayStream(cid);
  } catch {
    throw new UploadVerificationError(
      'Could not verify the upload against the IPFS gateway. Please try again.',
    );
  }

  let actualHash: string;
  try {
    actualHash = await sha256HexOfStream(stream);
  } catch {
    throw new UploadVerificationError(
      'Could not verify the upload against the IPFS gateway. Please try again.',
    );
  }

  if (actualHash !== expectedDigest) {
    throw new UploadVerificationError(
      'Uploaded file failed integrity verification. Please try again.',
    );
  }
}

/**
 * Streams the gateway response for `cid` as async byte pieces — no
 * buffering of the whole file. Falls back across fetch implementations:
 * undici/Node-18+ `Response.body` (WHATWG stream) first, then Node
 * `IncomingMessage` async iteration for axios-style streams.
 */
export async function fetchGatewayStream(
  cid: string,
): Promise<AsyncIterable<Uint8Array | Buffer>> {
  const url = `${GATEWAY}/${cid}`;
  // Prefer global fetch (undici on Node 18+) with a timeout race — keeps
  // the same bounded-wait contract as VERIFY_TIMEOUT_MS above.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new UploadVerificationError(
        'Could not verify the upload against the IPFS gateway. Please try again.',
      );
    }
    return streamFromWebReadable(res.body as ReadableStream<Uint8Array>);
  } catch (err) {
    if (err instanceof UploadVerificationError) throw err;
    throw new UploadVerificationError(
      'Could not verify the upload against the IPFS gateway. Please try again.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function* streamFromWebReadable(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array, void, void> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.length > 0) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
