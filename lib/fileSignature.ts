/** Convert a Uint8Array to a lowercase hex string for logging. */
export function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface DetectedFileType {
  mime: string;
  family: 'image' | 'video';
}

/**
 * ISO-BMFF major brands (bytes 8-11 of an `ftyp` box) we accept, mapped to
 * the MIME type we store and serve (issue #1329). HEIC/HEIF is accepted for
 * storage even though most browsers can't render it inline.
 */
const ISO_BMFF_BRANDS: Record<string, DetectedFileType> = {
  isom: { mime: 'video/mp4', family: 'video' },
  mp41: { mime: 'video/mp4', family: 'video' },
  mp42: { mime: 'video/mp4', family: 'video' },
  avc1: { mime: 'video/mp4', family: 'video' },
  'qt  ': { mime: 'video/quicktime', family: 'video' },
  'M4V ': { mime: 'video/x-m4v', family: 'video' },
  avif: { mime: 'image/avif', family: 'image' },
  heic: { mime: 'image/heic', family: 'image' },
  heix: { mime: 'image/heic', family: 'image' },
  mif1: { mime: 'image/heif', family: 'image' },
};

function matches(header: Uint8Array, offset: number, bytes: number[]) {
  return bytes.every((b, i) => header[offset + i] === b);
}

/**
 * Detect an image/video type from a file's first 12 bytes. Returns null for
 * unknown signatures and for ISO-BMFF brands outside the allow-list.
 *
 * Shared between the single-shot upload route (app/api/ipfs/upload) and the
 * chunked-upload complete route (app/api/ipfs/upload/complete), which reject
 * files whose detected family doesn't match the declared MIME prefix.
 */
export function detectFileType(header: Uint8Array): DetectedFileType | null {
  if (matches(header, 0, [0xff, 0xd8, 0xff]))
    return { mime: 'image/jpeg', family: 'image' };
  if (matches(header, 0, [0x89, 0x50, 0x4e, 0x47]))
    return { mime: 'image/png', family: 'image' };
  if (matches(header, 0, [0x47, 0x49, 0x46, 0x38]))
    return { mime: 'image/gif', family: 'image' };
  if (matches(header, 0, [0x52, 0x49, 0x46, 0x46])) {
    if (matches(header, 8, [0x57, 0x45, 0x42, 0x50]))
      return { mime: 'image/webp', family: 'image' };
    if (matches(header, 8, [0x41, 0x56, 0x49, 0x20]))
      return { mime: 'video/x-msvideo', family: 'video' };
    return null;
  }
  if (matches(header, 4, [0x66, 0x74, 0x79, 0x70])) {
    if (header.length < 12) return null;
    const brand = String.fromCharCode(...header.subarray(8, 12));
    return ISO_BMFF_BRANDS[brand] ?? null;
  }
  if (matches(header, 0, [0x1a, 0x45, 0xdf, 0xa3]))
    return { mime: 'video/webm', family: 'video' };
  return null;
}

/** True when `header` matches any supported image/video signature. */
export function hasValidMagicBytes(header: Uint8Array): boolean {
  return detectFileType(header) !== null;
}

/** True when the detected family matches the declared MIME prefix. */
export function isDeclaredTypeCompatible(
  declaredMime: string,
  detected: DetectedFileType,
): boolean {
  return declaredMime.toLowerCase().startsWith(`${detected.family}/`);
}
