# Player media moderation

Issue #1320. Covers reports on player profile media (images and video pinned to IPFS), the admin review queue, and the CID denylist.

## Scope

The denylist applies to **ScoutOff surfaces only**: the `/api/media/[cid]` proxy and the profile gallery. IPFS is content-addressed and public, so a denylisted CID can still be fetched from any public gateway, or from any node that pins it independently. The report dialog and the admin page both say this.

The player Open Graph image (`app/[locale]/player/[id]/opengraph-image.tsx`) renders only text, never profile media, so there's nothing there to filter.

## Flow

1. **Report.** Each gallery item on a player profile has a **Report** button. Reports go to `POST /api/media/report` with `{ cid, playerId, reason, details?, turnstileToken? }`, where `reason` is one of `nudity | violence | impersonation | copyright | other`.
   - Turnstile is verified when `TURNSTILE_SECRET_KEY` is set.
   - Rate limit: 5 reports per IP per 10 minutes (`lib/rateLimit.ts`).
   - Reporters are identified by a salted SHA-256 hash of their session wallet, or of their IP when signed out. Repeat reports from the same reporter for the same CID return `202 { duplicate: true }` and are not stored twice. Reports from different reporters are aggregated per CID.
2. **Review.** Admins open `/admin/media-moderation`, which reads `GET /api/admin/media-moderation`. The queue lists each CID once, with its report count, a breakdown by reason, reporter details, and a link to the player. Previews are blurred until the moderator clicks **Reveal**.
3. **Decide.** `POST /api/admin/media-moderation` with `{ cid, decision, reason?, playerId?, unpin? }`:
   - `approve`: resolves the open reports and keeps the media.
   - `deny` (requires `reason`): resolves the reports and adds the CID to `media_denylist`. From then on:
     - `/api/media/[cid]` returns **451** with `Cache-Control: no-store`, without contacting any gateway.
     - The gallery shows a "removed" placeholder, using `GET /api/media/denylist?cids=…`.
   - `reinstate`: removes a CID from the denylist.
4. **Audit.** Every decision is written to the admin audit log as `media_approve`, `media_deny` or `media_reinstate`, with the CID as `target`.

## Unpinning

`deny` with `unpin: true` does not unpin right away. It records the CID in the superseded-media store (`lib/supersededMediaStore.ts`), so it goes through the same safety as superseded uploads: the 72-hour grace period, then an admin-triggered `POST /api/admin/ipfs-cleanup` run with its current-CID guard. To unpin media that is still some player's live profile CID, run the cleanup without that CID in `currentCids`.

## CDN caches

Media that was served _before_ it was denylisted may still be in the CDN edge cache, because successful responses are `immutable` for a year. After denying urgent content (for example, illegal material), purge `/api/media/<cid>` in the CDN (Vercel: purge the path from the project's cache settings).

## Takedown requests

Rights holders and affected people can also ask for removal outside the in-app report button, as described in the Terms ("Reporting and removal of media") and the Privacy Policy ("Media reports"). An admin handles these requests the same way, by denying the CID from the admin page.

## Storage

The stores are SQLite (`lib/mediaModerationStore.ts`, migrations in `lib/migrations/mediaModerationMigrations.ts`), at `MEDIA_MODERATION_DB_PATH` (default `./data/media-moderation.db`). Like the other SQLite stores, a multi-instance deployment needs shared storage.
