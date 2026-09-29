import { NextRequest, NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/adminAuth';
import { getSessionWallet } from '@/lib/session';
import { privateJson } from '@/lib/httpResponses';

// Define the list of environment variables we care about
type ConfigVar = {
  name: string;
  required: boolean;
};

const CONFIG_VARS: ConfigVar[] = [
  // Required vars (based on .env.example comments)
  { name: 'NEXT_PUBLIC_CONTRACT_ID', required: true },
  { name: 'NEXT_PUBLIC_NETWORK', required: true },
  { name: 'NEXT_PUBLIC_HORIZON_URL', required: true },
  { name: 'NEXT_PUBLIC_SOROBAN_RPC', required: true },
  { name: 'NEXT_PUBLIC_IPFS_GATEWAY', required: true },
  { name: 'NEXT_PUBLIC_API_URL', required: true },
  { name: 'STELLAR_SECRET_KEY', required: true },
  { name: 'NEXT_PUBLIC_DOMAIN', required: true },
  { name: 'NEXT_PUBLIC_ADMIN_ADDRESS', required: true },
  // Optional vars
  { name: 'PINATA_API_KEY', required: false },
  { name: 'PINATA_SECRET', required: false },
  { name: 'NEXT_PUBLIC_SENTRY_DSN', required: false },
  { name: 'SENTRY_ORG', required: false },
  { name: 'SENTRY_PROJECT', required: false },
  { name: 'SENTRY_AUTH_TOKEN', required: false },
  { name: 'SENTRY_RELEASE', required: false },
  { name: 'PLATFORM_CONTACT_FEE_XLM', required: false },
  { name: 'NEXT_PUBLIC_STATUS_PAGE_URL', required: false },
  { name: 'NEXT_PUBLIC_APP_URL', required: false },
  { name: 'SEP10_SERVER_KEY', required: false },
  { name: 'SEP10_HOME_DOMAIN', required: false },
];

export async function GET(req: NextRequest) {
  if (!requireAdminWallet(req)) {
    return getSessionWallet(req)
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = CONFIG_VARS.map((v) => {
    const value = process.env[v.name];
    const present = typeof value === 'string' && value.trim().length > 0;
    return { name: v.name, required: v.required, present };
  });

  return privateJson(result);
}
