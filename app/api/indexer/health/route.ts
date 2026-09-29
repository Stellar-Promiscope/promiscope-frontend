import { NextResponse } from 'next/server';

// Public, read-only freshness probe for indexer-backed views (see #1357).
// Proxies the indexer's own /health server-side (like app/api/admin/health)
// but exposes only the fields DataFreshnessBadge needs.

const FETCH_TIMEOUT_MS = 5000;

export interface IndexerFreshness {
  lastLedger: number | null;
  lastUpdated: number | null;
  ledgerLag: number | null;
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Indexer not configured' },
      { status: 503 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Indexer unavailable' },
        { status: 502 },
      );
    }
    const data = await res.json();
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const body: IndexerFreshness = {
      lastLedger: num(data?.lastLedger),
      lastUpdated: num(data?.lastUpdated),
      ledgerLag: num(data?.ledgerLag),
    };
    const response = NextResponse.json(body);
    if (body.lastLedger !== null) {
      response.headers.set('X-Indexer-Last-Ledger', String(body.lastLedger));
    }
    if (body.lastUpdated !== null) {
      response.headers.set('X-Indexer-Last-Updated', String(body.lastUpdated));
    }
    return response;
  } catch {
    return NextResponse.json({ error: 'Indexer unavailable' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
