import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { parseApiError } from '@/lib/apiErrors';

/**
 * Returns a function mapping an API error response body (see
 * lib/apiErrors.ts) to a localized message from the `apiErrors` namespace,
 * falling back to `apiErrors.UNKNOWN` for unknown codes or uncoded bodies.
 */
export function useApiErrorMessage(): (body: unknown) => string {
  const t = useTranslations('apiErrors');
  return useCallback(
    (body: unknown) => {
      const parsed = parseApiError(body);
      if (parsed && t.has(parsed.code)) {
        return t(parsed.code, parsed.params);
      }
      return t('UNKNOWN');
    },
    [t],
  );
}
