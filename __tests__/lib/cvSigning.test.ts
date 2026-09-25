import { generateKeyPairSync } from 'node:crypto';
import { createCvToken, verifyCvToken } from '@/lib/cvSigning';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

beforeAll(() => {
  process.env.CV_SIGNING_SECRET = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  process.env.CV_SIGNING_PUBLIC_KEY = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
});

afterAll(() => {
  delete process.env.CV_SIGNING_SECRET;
  delete process.env.CV_SIGNING_PUBLIC_KEY;
});

describe('CV signing tokens', () => {
  it('round-trips a signed payload and rejects tampering', () => {
    const payload = {
      playerId: 'player-1',
      contentHash: 'abc123',
      exportedAt: 1_700_000_000,
      ledger: [{ milestoneId: 'm1', ledger: 42 }],
    };
    const token = createCvToken(payload);

    expect(verifyCvToken(token)).toEqual(payload);
    expect(verifyCvToken(`${token}tampered`)).toBeNull();
  });
});
