import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  locales,
  defaultLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from '@/lib/locales';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { buildCsp } from '@/lib/csp';

function getLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && locales.includes(cookieLocale)) {
    return cookieLocale;
  }

  const acceptLanguage = request.headers.get('accept-language');
  if (acceptLanguage) {
    const preferredLocale = acceptLanguage
      .split(',')[0]
      .split('-')[0]
      .toLowerCase();
    if (locales.includes(preferredLocale)) {
      return preferredLocale;
    }
  }

  return defaultLocale;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Generate a per-request nonce for CSP. crypto.randomUUID() is available
  // in the Edge runtime used by Next.js middleware.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({ nonce });

  if (pathname.startsWith('/api/admin/')) {
    const isReconciliation = pathname === '/api/admin/audit-log/reconcile';
    const isFraudEvaluation = pathname === '/api/admin/fraud-flags';
    const limit = isReconciliation || isFraudEvaluation ? 3 : 30;
    const windowMs = isReconciliation ? 5 * 60 * 1000 : 60 * 1000;
    const result = await checkRateLimit(
      `admin-api:${pathname}:${getClientIp(request)}`,
      { limit, windowMs },
    );

    if (result.limited) {
      return NextResponse.json(
        {
          error: 'Admin request rate limit exceeded. Please try again shortly.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(result.retryAfterSec ?? 60),
          },
        },
      );
    }
  }

  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  // Shared header mutations: stamp the nonce so app/layout.tsx can read it
  // via headers() and apply it to the no-flash theme script.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-pathname', pathname);

  if (pathnameHasLocale) {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  const locale = getLocale(request);
  const response = NextResponse.redirect(
    new URL(`/${locale}${pathname}`, request.url),
  );

  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    '/api/admin/:path*',
    '/((?!api|_next/static|_next/image|favicon.ico|icons).*)',
  ],
};
