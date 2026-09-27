import manifest from './envManifest.json';

/**
 * Typed view of lib/envManifest.json — the single source of truth for every
 * environment variable the app, server/, packages/ and scripts/ read
 * (issue #1327). Kept as plain JSON so scripts/validate-env.js can load it
 * without compiling. It drives /api/admin/config-status, validateConfig()
 * in lib/config.ts, and the .env.example check in scripts/validate-env.js.
 */
export type EnvName = 'production';

export interface EnvVarSpec {
  name: string;
  /** Environments in which the app is broken without this variable. */
  requiredIn: EnvName[];
  /** Never return the value — only whether it is present. */
  secret: boolean;
  usedBy: string[];
  description: string;
  /** Example file that documents it; defaults to the root .env.example. */
  envFile?: string;
  /** Surface a missing value in the in-app config banner (validateConfig). */
  showInAppBanner?: boolean;
}

export const ENV_MANIFEST: EnvVarSpec[] = manifest.vars as EnvVarSpec[];

/** Platform-provided variables that intentionally have no manifest entry. */
export const ENV_IGNORE: string[] = manifest.ignore;

export function isRequiredInProduction(spec: EnvVarSpec): boolean {
  return spec.requiredIn.includes('production');
}
