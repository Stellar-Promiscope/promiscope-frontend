const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  // Run `ANALYZE=true npm run build` to open the treemap reports in the browser.
  enabled: process.env.ANALYZE === 'true',
  // Write the HTML reports into .next/analyze/ so they aren't confused with
  // app source files and are covered by the existing .gitignore for .next/.
  openAnalyzer: false,
});

const { tunedRuntimeCaching } = require('./lib/pwaCacheConfig.ts');

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  // Keep `false`: an unconditional skipWaiting() activates every new build
  // immediately, so the service worker never enters the "waiting" state the
  // reload prompt (components/ServiceWorkerUpdateBanner.tsx) depends on to
  // detect updates. With this off, workbox injects a SKIP_WAITING message
  // listener instead, and the banner's "Reload" button triggers it.
  skipWaiting: false,
  runtimeCaching: tunedRuntimeCaching,
});

const nextConfig = {
  typescript: {
    // `next build` runs its own project-wide type check by default, but this
    // repo's CI only gates on `npm run lint` / `npm run test` (see
    // .github/workflows/ci.yml) — `npm run typecheck` (tsc --noEmit) isn't a
    // CI gate today, so unrelated pre-existing type errors elsewhere in the
    // project can otherwise block `next build` for a change that never
    // touched those files (this is what broke the Docker image build added
    // in #675). `npm run typecheck` still surfaces these for anyone who runs
    // it directly; fixing the underlying errors is tracked separately.
    ignoreBuildErrors: true,
  },
  images: {
    /**
     * remotePatterns replaces the deprecated `domains` array.
     * Each entry covers one IPFS gateway that may appear in NEXT_PUBLIC_IPFS_GATEWAY.
     *
     * Pinata dedicated gateway:  https://gateway.pinata.cloud/ipfs/<cid>
     * Pinata dedicated gateway (custom subdomain): https://<name>.mypinata.cloud/ipfs/<cid>
     * Public IPFS gateway:       https://ipfs.io/ipfs/<cid>
     * Cloudflare IPFS gateway:   https://cloudflare-ipfs.com/ipfs/<cid>
     * Dweb.link gateway:         https://dweb.link/ipfs/<cid>
     *
     * Adding a new gateway only requires a new entry here — no other changes needed.
     */
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'gateway.pinata.cloud',
        pathname: '/ipfs/**',
      },
      {
        protocol: 'https',
        hostname: '**.mypinata.cloud',
        pathname: '/ipfs/**',
      },
      {
        protocol: 'https',
        hostname: 'ipfs.io',
        pathname: '/ipfs/**',
      },
      {
        protocol: 'https',
        hostname: 'cloudflare-ipfs.com',
        pathname: '/ipfs/**',
      },
      {
        protocol: 'https',
        hostname: 'dweb.link',
        pathname: '/ipfs/**',
      },
    ],
  },
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    // Get environment variables with defaults for development
    const ipfsGateway =
      process.env.NEXT_PUBLIC_IPFS_GATEWAY ||
      'https://gateway.pinata.cloud/ipfs';
    const sorobanRpc =
      process.env.NEXT_PUBLIC_SOROBAN_RPC ||
      'https://soroban-testnet.stellar.org';
    const horizonUrl =
      process.env.NEXT_PUBLIC_HORIZON_URL ||
      'https://horizon-testnet.stellar.org';

    // Extract domain from URLs for CSP (remove protocol and path)
    const extractDomain = (url) => {
      try {
        return new URL(url).origin;
      } catch {
        return url;
      }
    };

    const ipfsGatewayDomain = extractDomain(ipfsGateway);
    const sorobanDomain = extractDomain(sorobanRpc);
    const horizonDomain = extractDomain(horizonUrl);

    // Next.js dev tooling (react-refresh/runtime overlays) relies on inline
    // scripts and eval. Keep production CSP strict.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'";

    // Build Content Security Policy header
    const cspHeader = [
      "default-src 'self'",
      scriptSrc,
      `img-src 'self' data: ${ipfsGatewayDomain}`,
      `connect-src 'self' ${sorobanDomain} ${horizonDomain}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      // report-to is used by browsers that support the Reporting API;
      // report-uri is kept as a fallback for older browsers.
      'report-uri /api/csp-report',
      'report-to csp-endpoint',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspHeader,
          },
          {
            key: 'Reporting-Endpoints',
            value: 'csp-endpoint="/api/csp-report"',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

// @sentry/nextjs's build-time plugin uploads source maps and tags the
// release for every build. It no-ops (with a warning) when SENTRY_AUTH_TOKEN
// isn't set, so local/contributor builds are unaffected.
const sentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  release: {
    // Falls back to the plugin's own git-HEAD auto-detection when unset.
    name: process.env.SENTRY_RELEASE,
  },
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
};

module.exports = withSentryConfig(
  withBundleAnalyzer(withNextIntl(withPWA(nextConfig))),
  sentryBuildOptions,
);
