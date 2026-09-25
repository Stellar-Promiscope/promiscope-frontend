import { NextRequest, NextResponse } from 'next/server';
import { getXlmRate, isSupportedVsCurrency } from '@/lib/xlmRate';

/**
 * GET /api/rates/xlm?vs=usd
 *
 * Server-side proxy for the XLM exchange rate so clients never contact
 * CoinGecko directly. Cached for 60 s at the edge and in memory.
 */
export async function GET(request: NextRequest) {
  const vs = (request.nextUrl.searchParams.get('vs') ?? 'usd').toLowerCase();
  if (!isSupportedVsCurrency(vs)) {
    return NextResponse.json(
      { error: 'Unsupported currency' },
      { status: 400 },
    );
  }

  try {
    const body = await getXlmRate(vs);
    return NextResponse.json(body, {
      headers: {
        'Cache-Control': body.stale
          ? 'public, s-maxage=10, stale-while-revalidate=60'
          : 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Rate unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
