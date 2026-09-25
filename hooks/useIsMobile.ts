'use client';

import { useEffect, useState } from 'react';

/** Matches Tailwind's `sm` breakpoint, below which the Navbar collapses. */
const MOBILE_QUERY = '(max-width: 639px)';

/** True when the viewport is narrower than the `sm` breakpoint. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return isMobile;
}
