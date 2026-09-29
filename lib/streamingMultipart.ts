import { Readable } from 'stream';

/**
 * Streaming multipart body builder (issue #1295).
 *
 * Pinata's `pinFileToIPFS` takes one complete file in a single multipart
 * POST — no chunked/resumable API of its own — so /complete must still send
 * exactly one file part. This builds that body as a lazily-pulled Node
 * `Readable`: boundary preamble, then each file chunk in order, then the
 * closing boundary. Peak residency is one chunk (~1 MB), never the file.
 *
 * `chunks()` is called lazily on first read so validation gates (MIME,
 * magic bytes) can reject before any byte flows.
 */
export function buildStreamingMultipartBody(
  boundary: string,
  filename: string,
  fileType: string,
  fileSize: number,
  chunks: () => Generator<Buffer, void, void>,
): { stream: Readable; contentLength: number; contentType: string } {
  const safeFilename = filename.replace(/"/g, '_');
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
      `Content-Type: ${fileType}\r\n\r\n`,
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
  const contentLength = preamble.length + fileSize + epilogue.length;

  let phase: 'pre' | 'chunks' | 'post' | 'done' = 'pre';
  let iterator: Generator<Buffer, void, void> | null = null;
  const stream = new Readable({
    read() {
      try {
        if (phase === 'pre') {
          phase = 'chunks';
          this.push(preamble);
          return;
        }
        if (phase === 'chunks') {
          if (!iterator) iterator = chunks();
          const next = iterator.next();
          if (!next.done) {
            // Copy to a plain-ArrayBuffer view for the DOM-lib tsconfig.
            this.push(new Uint8Array(next.value));
            return;
          }
          phase = 'post';
          this.push(epilogue);
          return;
        }
        phase = 'done';
        this.push(null);
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });

  return {
    stream,
    contentLength,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Async byte pieces of streamed file content (no multipart framing). */
export async function* streamFileBytes(
  chunks: () => Generator<Buffer, void, void>,
): AsyncGenerator<Uint8Array, void, void> {
  for (const piece of chunks()) {
    yield new Uint8Array(piece);
  }
}
