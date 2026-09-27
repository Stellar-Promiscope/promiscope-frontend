import { privateJson } from '@/lib/httpResponses';
import { ENV_MANIFEST, isRequiredInProduction } from '@/lib/envManifest';

// Driven by lib/envManifest.ts (issue #1327). Only reports presence — never
// return secret values.
export async function GET() {
  const result = ENV_MANIFEST.map((v) => {
    const value = process.env[v.name];
    const present = typeof value === 'string' && value.trim().length > 0;
    return {
      name: v.name,
      required: isRequiredInProduction(v),
      secret: v.secret,
      present,
    };
  });

  return privateJson(result);
}
