/**
 * Server-side runtime configuration validation.
 *
 * These checks run at request time (not build time), so they catch
 * misconfigurations that slip past the build-time `scripts/validate-env.js`
 * check — for example when an env var is set in `.env.local` but not in the
 * production hosting platform.
 */

import { ENV_MANIFEST, isRequiredInProduction } from './envManifest';

export interface ConfigWarning {
  key: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Checks all critical environment variables and returns any warnings.
 *
 * Intended to be called once per request in the root layout and the result
 * passed down to a client-side banner component.
 */
export function validateConfig(): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  // Entries flagged showInAppBanner in lib/envManifest.ts (issue #1327).
  for (const spec of ENV_MANIFEST) {
    if (!spec.showInAppBanner) continue;
    const value = process.env[spec.name];
    if (!value || value.trim() === '') {
      warnings.push({
        key: spec.name,
        message: spec.description,
        severity: isRequiredInProduction(spec) ? 'error' : 'warning',
      });
    }
  }

  return warnings;
}

/**
 * Returns true when all critical configuration values are present and valid.
 */
export function isConfigValid(): boolean {
  return validateConfig().length === 0;
}
