import '@testing-library/jest-dom';

// jsdom doesn't implement matchMedia. ThemeContext (Issue #545) reads it to
// detect the OS color-scheme preference, so any component tree that renders
// ThemeProvider/ThemeToggle needs this stub to avoid "matchMedia is not a
// function" during render. A plain function (not jest.fn()) so it survives
// test files that call jest.resetAllMocks() in beforeEach.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

/**
 * Clear localStorage before each test so WalletProvider's session-restore
 * useEffect does not trip on a stale session left over from a prior test.
 * jsdom shares Storage across tests in the same file by default.
 */
beforeEach(() => {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
});

process.env.NEXT_PUBLIC_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
process.env.NEXT_PUBLIC_NETWORK = 'testnet';
process.env.NEXT_PUBLIC_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.NEXT_PUBLIC_IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
// Client-trusted SEP-10 expectations (mirrors .env.example). Unit tests that
// build real challenges override these; WalletContext tests mock the validator.
process.env.NEXT_PUBLIC_SEP10_SERVER_ACCOUNT =
  process.env.NEXT_PUBLIC_SEP10_SERVER_ACCOUNT ??
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
process.env.NEXT_PUBLIC_SEP10_HOME_DOMAIN =
  process.env.NEXT_PUBLIC_SEP10_HOME_DOMAIN ?? 'localhost:3000';
// Signs the `session`/`session_refresh` cookies (see lib/session.ts). A
// fixed test value so any test constructing a signed cookie by hand (via
// createSessionToken) verifies against the same secret the route handlers
// read.
process.env.SESSION_SECRET = 'test-session-secret-do-not-use-in-production';

const mockTranslatedNamespaces = [
  'common',
  'account',
  'notifications',
  'scout',
  'stats',
];

// Namespaces translated after the flat stub below was written (#1340-#1342)
// resolve against the real English messages, ICU plurals and rich text
// included; anything else falls back to the stub / the raw key.
function mockEnglishTranslator(namespace?: string) {
  const root = namespace?.split('.')[0];
  if (!root || !mockTranslatedNamespaces.includes(root)) return null;
  const { createTranslator } = jest.requireActual('use-intl');
  return createTranslator({
    locale: 'en',
    messages: jest.requireActual('./messages/en.json'),
    namespace,
    onError: () => {},
    getMessageFallback: ({ key }: { key: string }) => key,
  });
}

jest.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const english = mockEnglishTranslator(namespace);
    const t = (key: string, values?: Record<string, unknown>) => {
      const stub: Record<string, string> = {
        app_title: 'ScoutOff',
        'nav.scout_dashboard': 'Scout Dashboard',
        'nav.player_dashboard': 'Player Dashboard',
        'common.loading': 'Loading...',
        // wallet namespace
        connect: 'Connect Wallet',
        connecting: 'Connecting…',
        disconnect: 'Disconnect Wallet',
        selectProvider: 'Select Wallet',
        selectProviderHint: 'Choose a Stellar wallet to connect with ScoutOff.',
        install: 'Browser extension',
        installMobile: 'Browser extension / mobile',
        cancel: 'Cancel',
        noWalletDetected:
          'No wallet detected. Please install a Stellar wallet extension.',
      };
      if (stub[key]) return stub[key];
      return english ? english(key, values) : key;
    };
    t.rich = (key: string, values?: Record<string, unknown>) =>
      english ? english.rich(key, values) : key;
    return t;
  },
  useLocale: () => 'en',
  useMessages: () => ({}),
  useNow: () => new Date(),
  useTimeZone: () => 'UTC',
  useFormatter: () => ({}),
}));

// The real package's default export is the albedo intent instance itself
// (with .publicKey()/.tx() directly on it, not nested under an `albedo`
// key) — see node_modules/@albedo-link/intent/src/index.js.
jest.mock('@albedo-link/intent', () => ({
  __esModule: true,
  default: {
    publicKey: jest.fn(),
    tx: jest.fn(),
  },
}));

jest.mock('@lobstrco/signer-extension-api', () => ({
  isConnected: jest.fn(),
  getPublicKey: jest.fn(),
  signTransaction: jest.fn(),
}));

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk') as any;
  return {
    ...original,
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(),
    })),
  };
});
