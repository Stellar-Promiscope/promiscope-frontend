# ADR 0002: IPFS Gateway and Upload Provider (Pinata)

- **Date:** 2024-08-10
- **Status:** Accepted
- **Deciders:** ScoutOff engineering team
- **Last revised:** 2024-08-10

## Context

Player profile images and highlight-reel videos are stored on IPFS, providing
content-addressed, tamper-evident storage that aligns with the project's
decentralized ethos. The app needs:

1. **Upload** — A server-side API to pin files to IPFS and return a CID.
2. **Serving** — A way to serve those files to browsers with reasonable
   performance, caching, and hotlinking protection.

Alternatives considered:

- **ipfs.io / dweb.link** — Public gateways only; no upload API.
  Files would need to be pinned via a separate service or local IPFS node.
- **Infura IPFS** — Offers both upload and gateway but is Ethereum-ecosystem
  aligned; the project has no existing Infura dependency.
- **web3.storage** — Decentralized upload + gateway, but adds an additional
  service dependency with a different API shape.
- **Self-hosted IPFS node** — Operational overhead of running, monitoring,
  and scaling an IPFS node.

## Decision

Use **Pinata** for both uploading and primary gateway serving:

- **Upload:** Server-side calls to `api.pinata.cloud/pinning/pinFileToIPFS`
  via the `PINATA_API_KEY` and `PINATA_SECRET` environment variables.
- **Serving:** Primary read gateway at `gateway.pinata.cloud/ipfs`, with
  fallbacks to `ipfs.io/ipfs` and `dweb.link/ipfs`.

All media is served through a self-hosted **proxy route** (`/api/media/[cid]`)
rather than exposing the raw gateway URL in HTML. This proxy:

- Sets `Cache-Control: public, max-age=31536000, immutable` — since CIDs are
  content-addressed, the same CID always returns the same bytes.
- Optionally supports HMAC-SHA256 signed, time-limited URLs for gated content
  (`MEDIA_URL_SIGNING_SECRET` environment variable).
- Enforces Referer-based anti-hotlinking (block cross-site embeds).
- Applies per-IP rate limiting as a best-effort anti-scraping measure.

The client helper `getMediaProxyUrl(cid)` from `lib/mediaUrl.ts` returns the
same-origin `/api/media/<cid>` path so components never construct raw gateway
URLs.

Key implementation files:

- `app/api/media/[cid]/route.ts` — Proxy with caching, signing, hotlink gating
- `lib/mediaUrl.ts` — Client-safe `getMediaProxyUrl()` helper
- `lib/mediaUrlSigning.ts` — Server-only HMAC signing/verification
- `app/api/ipfs/upload/route.ts` — Pinata upload endpoint with validation
- `lib/ipfs.ts` — Client-side upload (single and chunked) + gateway URL helper

## Consequences

**Positive:**

- Single provider for upload + read simplifies the architecture.
- The proxy layer provides CDN caching, signed URLs, and hotlink protection
  that raw gateway URLs cannot offer.
- Fallback gateways (`ipfs.io`, `dweb.link`) provide resilience if
  Pinata's gateway is unreachable.

**Negative:**

- Vendor lock-in on Pinata for uploads — switching providers requires changing
  the upload endpoint and re-pinning all files.
- Pinata has no native chunked-upload API; client-side chunking in
  `lib/ipfs.ts` re-assembles files server-side before the single Pinata call
  (see `docs/chunked-video-upload.md`).

**Neutral:**

- Pinata's free tier was sufficient during development; bandwidth costs will
  be evaluated post-deployment (noted in `DEVELOPMENT.md`).
- Post-upload integrity verification re-fetches from the gateway and compares
  hashes rather than recomputing the CID locally — this avoids reimplementing
  the UnixFS DAG-PB wrapping that Pinata applies internally.
