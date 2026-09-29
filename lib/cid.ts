/**
 * Strict IPFS CID format check, used before a CID is interpolated into an
 * upstream gateway URL (see app/api/media/[cid]/route.ts).
 *
 * Accepts CIDv0 (base58btc, `Qm` + 44 chars) and CIDv1 in the common
 * multibase encodings: base32 lower-case (`b...`) and base58btc (`z...`).
 * Anything containing `/`, `?`, `#`, `%` or `.` is rejected by the alphabets.
 */
const MAX_CID_LENGTH = 100;
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_BASE32 = /^b[a-z2-7]{58,}$/;
const CID_V1_BASE58 = /^z[1-9A-HJ-NP-Za-km-z]{46,}$/;

export function isValidCid(cid: unknown): cid is string {
  if (typeof cid !== 'string' || cid.length > MAX_CID_LENGTH) return false;
  return CID_V0.test(cid) || CID_V1_BASE32.test(cid) || CID_V1_BASE58.test(cid);
}
