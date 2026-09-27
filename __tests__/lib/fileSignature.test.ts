/**
 * Unit tests for lib/fileSignature.ts
 *
 * Covers:
 * - hasValidMagicBytes for every supported image/video format
 * - Rejection of buffers with non-matching magic bytes (mismatched extension scenario)
 * - Graceful rejection of truncated and empty buffers (no unhandled exceptions)
 * - bufToHex helper
 */

import {
  hasValidMagicBytes,
  detectFileType,
  isDeclaredTypeCompatible,
  bufToHex,
} from '@/lib/fileSignature';

// ---------------------------------------------------------------------------
// Helpers to build minimal magic-byte headers
// ---------------------------------------------------------------------------

function jpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
}

function png(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
}

function gif(): Uint8Array {
  // GIF89a
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
  ]);
}

function webp(): Uint8Array {
  // RIFF????WEBP
  const buf = new Uint8Array(12);
  buf[0] = 0x52;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x46; // RIFF
  buf[4] = 0x00;
  buf[5] = 0x00;
  buf[6] = 0x00;
  buf[7] = 0x00; // file size (irrelevant)
  buf[8] = 0x57;
  buf[9] = 0x45;
  buf[10] = 0x42;
  buf[11] = 0x50; // WEBP
  return buf;
}

function mp4(): Uint8Array {
  // bytes 4-7 = 'ftyp'
  const buf = new Uint8Array(12);
  buf[4] = 0x66;
  buf[5] = 0x74;
  buf[6] = 0x79;
  buf[7] = 0x70; // ftyp
  buf.set([0x69, 0x73, 0x6f, 0x6d], 8); // 'isom' major brand
  return buf;
}

function webm(): Uint8Array {
  return new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

function avi(): Uint8Array {
  // RIFF????AVI
  const buf = new Uint8Array(12);
  buf[0] = 0x52;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x46; // RIFF
  buf[4] = 0x00;
  buf[5] = 0x00;
  buf[6] = 0x00;
  buf[7] = 0x00; // file size
  buf[8] = 0x41;
  buf[9] = 0x56;
  buf[10] = 0x49;
  buf[11] = 0x20; // AVI<space>
  return buf;
}

// ---------------------------------------------------------------------------

describe('hasValidMagicBytes', () => {
  describe('valid image signatures', () => {
    it('accepts a JPEG header (FF D8 FF)', () => {
      expect(hasValidMagicBytes(jpeg())).toBe(true);
    });

    it('accepts a PNG header (89 50 4E 47)', () => {
      expect(hasValidMagicBytes(png())).toBe(true);
    });

    it('accepts a GIF header (47 49 46 38)', () => {
      expect(hasValidMagicBytes(gif())).toBe(true);
    });

    it('accepts a WebP header (RIFF....WEBP)', () => {
      expect(hasValidMagicBytes(webp())).toBe(true);
    });
  });

  describe('valid video signatures', () => {
    it('accepts an MP4/MOV header (ftyp box at bytes 4-7)', () => {
      expect(hasValidMagicBytes(mp4())).toBe(true);
    });

    it('accepts a WebM/MKV header (1A 45 DF A3)', () => {
      expect(hasValidMagicBytes(webm())).toBe(true);
    });

    it('accepts an AVI header (RIFF....AVI)', () => {
      expect(hasValidMagicBytes(avi())).toBe(true);
    });
  });

  describe('mismatched / invalid signatures', () => {
    it('rejects a buffer of all zeros (no valid signature)', () => {
      expect(hasValidMagicBytes(new Uint8Array(12))).toBe(false);
    });

    it('rejects a PDF header (25 50 44 46) — renamed-file scenario', () => {
      // A .mp4 file that is actually a PDF
      const fakeMp4 = new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
      ]);
      expect(hasValidMagicBytes(fakeMp4)).toBe(false);
    });

    it('rejects a ZIP/DOCX header (50 4B 03 04)', () => {
      const fakeImg = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(hasValidMagicBytes(fakeImg)).toBe(false);
    });

    it('rejects an EXE header (4D 5A)', () => {
      const fakeImg = new Uint8Array([
        0x4d, 0x5a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(hasValidMagicBytes(fakeImg)).toBe(false);
    });

    it('rejects a JPEG header with one byte corrupted', () => {
      const bad = jpeg();
      bad[2] = 0x00; // corrupt the third byte
      expect(hasValidMagicBytes(bad)).toBe(false);
    });
  });

  describe('truncated and empty buffers', () => {
    it('returns false for an empty buffer without throwing', () => {
      expect(() => hasValidMagicBytes(new Uint8Array(0))).not.toThrow();
      expect(hasValidMagicBytes(new Uint8Array(0))).toBe(false);
    });

    it('returns false for a 1-byte buffer without throwing', () => {
      expect(() => hasValidMagicBytes(new Uint8Array([0xff]))).not.toThrow();
      expect(hasValidMagicBytes(new Uint8Array([0xff]))).toBe(false);
    });

    it('returns false for a 3-byte buffer (too short for PNG/GIF/WebP/MP4)', () => {
      // Only the first 3 bytes of JPEG are enough — everything else needs more
      expect(hasValidMagicBytes(new Uint8Array([0x89, 0x50, 0x4e]))).toBe(
        false,
      );
    });

    it('accepts a minimal 3-byte JPEG buffer (FF D8 FF is fully checkable)', () => {
      expect(hasValidMagicBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    });
  });
});

describe('bufToHex', () => {
  it('converts a single byte to two lowercase hex digits', () => {
    expect(bufToHex(new Uint8Array([0x0f]))).toBe('0f');
    expect(bufToHex(new Uint8Array([0xff]))).toBe('ff');
  });

  it('converts multi-byte buffers to a concatenated hex string', () => {
    expect(bufToHex(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('ffd8ff');
    expect(bufToHex(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('89504e47');
  });

  it('returns an empty string for an empty buffer', () => {
    expect(bufToHex(new Uint8Array([]))).toBe('');
  });

  it('zero-pads single-digit hex values', () => {
    expect(bufToHex(new Uint8Array([0x00, 0x01, 0x0a]))).toBe('00010a');
  });
});

function ftyp(brand: string): Uint8Array {
  const buf = new Uint8Array(12);
  buf.set([0x66, 0x74, 0x79, 0x70], 4);
  buf.set(
    Array.from(brand, (c) => c.charCodeAt(0)),
    8,
  );
  return buf;
}

function riff(tag: string): Uint8Array {
  const buf = new Uint8Array(12);
  buf.set([0x52, 0x49, 0x46, 0x46], 0);
  buf.set(
    Array.from(tag, (c) => c.charCodeAt(0)),
    8,
  );
  return buf;
}

describe('detectFileType (issue #1329)', () => {
  it.each([
    ['JPEG', jpeg(), 'image/jpeg', 'image'],
    ['PNG', png(), 'image/png', 'image'],
    ['GIF', gif(), 'image/gif', 'image'],
    ['WebP', riff('WEBP'), 'image/webp', 'image'],
    ['AVI', riff('AVI '), 'video/x-msvideo', 'video'],
    [
      'WebM/MKV',
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]),
      'video/webm',
      'video',
    ],
    ['MP4 isom', ftyp('isom'), 'video/mp4', 'video'],
    ['MP4 mp42', ftyp('mp42'), 'video/mp4', 'video'],
    ['MOV', ftyp('qt  '), 'video/quicktime', 'video'],
    ['M4V', ftyp('M4V '), 'video/x-m4v', 'video'],
    ['AVIF', ftyp('avif'), 'image/avif', 'image'],
    ['HEIC', ftyp('heic'), 'image/heic', 'image'],
  ])('detects %s', (_name, header, mime, family) => {
    expect(detectFileType(header)).toEqual({ mime, family });
  });

  it('rejects ISO-BMFF brands outside the allow-list', () => {
    expect(detectFileType(ftyp('crx '))).toBeNull();
    expect(detectFileType(ftyp('3gp4'))).toBeNull();
  });

  it('rejects AVI-like RIFF headers whose byte 11 is not 0x20', () => {
    expect(detectFileType(riff('AVIX'))).toBeNull();
  });

  it('rejects unknown signatures', () => {
    expect(detectFileType(new Uint8Array(12))).toBeNull();
  });
});

describe('isDeclaredTypeCompatible (issue #1329)', () => {
  it('accepts a matching family', () => {
    expect(isDeclaredTypeCompatible('image/png', detectFileType(png())!)).toBe(
      true,
    );
    expect(
      isDeclaredTypeCompatible('video/mp4', detectFileType(ftyp('isom'))!),
    ).toBe(true);
  });

  it('rejects a PNG declared as video/mp4 and an MP4 declared as image/jpeg', () => {
    expect(isDeclaredTypeCompatible('video/mp4', detectFileType(png())!)).toBe(
      false,
    );
    expect(
      isDeclaredTypeCompatible('image/jpeg', detectFileType(ftyp('isom'))!),
    ).toBe(false);
  });
});
