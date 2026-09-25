'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/Toast';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { useContractHealth } from '@/hooks/useContractHealth';
import type {
  AggregateHealthResponse,
  SubsystemHealth,
} from '@/app/api/admin/health/route';
import type { DependencyCheck } from '@/lib/healthChecks';

const ADMIN_ADDRESS = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;

// Matches useContractStatus's own poll interval (hooks/useContractStatus.ts)
// so every section of this page refreshes on a consistent cadence.
const REFRESH_INTERVAL_MS = 60_000;

type CheckStatus =
  | 'ok'
  | 'degraded'
  | 'unreachable'
  | 'not_configured'
  | 'loading';

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: 'Healthy',
  degraded: 'Degraded',
  unreachable: 'Unreachable',
  not_configured: 'Not configured',
  loading: 'Checking…',
};

const STATUS_CLASS: Record<CheckStatus, string> = {
  ok: 'text-brand-green',
  degraded: 'text-yellow-400',
  unreachable: 'text-red-400',
  not_configured: 'text-gray-400',
  loading: 'text-gray-400',
};

function StatusBadge({ status }: { status: CheckStatus }) {
  return (
    <span className={`font-medium ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const DEPENDENCY_LABELS: Record<string, string> = {
  redis: 'Redis',
  pinata: 'Pinata',
  sessionStore: 'Session Store',
  sorobanRpc: 'Soroban RPC',
  contract: 'Contract Version',
};

function DependencyChecks({
  checks,
}: {
  checks: Record<string, DependencyCheck>;
}) {
  return (
    <>
      {Object.entries(checks).map(([name, check]) => (
        <HealthSection
          key={name}
          title={DEPENDENCY_LABELS[name] ?? name}
          status={check.status}
        >
          <p className="text-sm text-gray-400">
            Latency: <span className="text-gray-200">{check.latencyMs} ms</span>
          </p>
          {check.error && <p className="text-sm text-red-400">{check.error}</p>}
          {check.status !== 'ok' && check.hint && (
            <p className="text-sm text-gray-400">{check.hint}</p>
          )}
        </HealthSection>
      ))}
    </>
  );
}

function emptySubsystem(error: string): SubsystemHealth {
  return { status: 'unreachable', error };
}

function HealthSection({
  title,
  status,
  children,
}: {
  title: string;
  status: CheckStatus;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-testid={`health-section-${title.toLowerCase().replace(/\s+/g, '-')}`}
      className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <StatusBadge status={status} />
      </div>
      {children}
    </section>
  );
}

function HealthDashboardContent() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const { show } = useToast();

  const {
    healthy: contractHealthy,
    paused: contractPaused,
    loading: contractLoading,
  } = useContractHealth();

  const [remoteHealth, setRemoteHealth] =
    useState<AggregateHealthResponse | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [remoteFetchError, setRemoteFetchError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchRemoteHealth = useCallback(async () => {
    setRemoteLoading(true);
    try {
      const res = await fetch('/api/admin/health', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Health check request failed (HTTP ${res.status})`);
      }
      const data: AggregateHealthResponse = await res.json();
      setRemoteHealth(data);
      setRemoteFetchError(null);
    } catch (err) {
      // The aggregate route itself may be unreachable (e.g. offline, server
      // error) — that must not blank the page. Fall back to explicit
      // "unreachable" states for both remote checks and keep rendering.
      const message = err instanceof Error ? err.message : 'Request failed';
      setRemoteFetchError(message);
      setRemoteHealth({
        indexer: emptySubsystem(message),
        backend: emptySubsystem(message),
        checks: {},
        checkedAt: Date.now(),
      });
    } finally {
      setRemoteLoading(false);
      setLastChecked(new Date());
    }
  }, []);

  // Gate: redirect non-admin wallets, mirroring app/[locale]/admin/page.tsx.
  useEffect(() => {
    if (!publicKey) return;
    if (publicKey !== ADMIN_ADDRESS) {
      show({
        message: 'Unauthorized: admin wallet required.',
        variant: 'error',
      });
      router.replace('/');
    }
  }, [publicKey, router, show]);

  useEffect(() => {
    if (publicKey !== ADMIN_ADDRESS) return;
    fetchRemoteHealth();
    const interval = setInterval(fetchRemoteHealth, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [publicKey, fetchRemoteHealth]);

  if (!publicKey || publicKey !== ADMIN_ADDRESS) return null;

  const contractStatus: CheckStatus = contractLoading
    ? 'loading'
    : !contractHealthy
      ? 'unreachable'
      : contractPaused
        ? 'degraded'
        : 'ok';

  const indexerStatus: CheckStatus = remoteHealth
    ? remoteHealth.indexer.status
    : 'loading';
  const backendStatus: CheckStatus = remoteHealth
    ? remoteHealth.backend.status
    : 'loading';

  const indexerDetail = remoteHealth?.indexer.detail;
  const backendDetail = remoteHealth?.backend.detail;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-white">System Health</h1>
        <button
          onClick={fetchRemoteHealth}
          disabled={remoteLoading}
          className="px-4 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm font-semibold hover:bg-gray-600 transition disabled:opacity-40"
        >
          {remoteLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p className="text-sm text-gray-400" data-testid="health-last-checked">
        Last checked: {lastChecked ? lastChecked.toLocaleTimeString() : 'never'}
      </p>

      <HealthSection title="Contract" status={contractStatus}>
        {contractPaused && (
          <p className="text-sm text-yellow-400">
            The circuit breaker is engaged; on-chain transactions are disabled.
          </p>
        )}
        {!contractLoading && !contractHealthy && (
          <p className="text-sm text-red-400">
            The contract RPC health check is failing. See the Soroban RPC
            endpoint configuration.
          </p>
        )}
      </HealthSection>

      <HealthSection title="Indexer" status={indexerStatus}>
        {remoteHealth?.indexer.error && (
          <p className="text-sm text-red-400">{remoteHealth.indexer.error}</p>
        )}
        {indexerDetail && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-400">
            {typeof indexerDetail.lastLedger !== 'undefined' && (
              <>
                <dt>Last ledger</dt>
                <dd className="text-gray-200">
                  {String(indexerDetail.lastLedger)}
                </dd>
              </>
            )}
            {typeof indexerDetail.uptime !== 'undefined' && (
              <>
                <dt>Uptime</dt>
                <dd className="text-gray-200">
                  {String(indexerDetail.uptime)}s
                </dd>
              </>
            )}
          </dl>
        )}
      </HealthSection>

      <HealthSection title="Backend API" status={backendStatus}>
        {remoteHealth?.backend.error && (
          <p className="text-sm text-red-400">{remoteHealth.backend.error}</p>
        )}
        {backendDetail && Object.keys(backendDetail).length > 0 && (
          <pre className="text-xs text-gray-400 overflow-x-auto">
            {JSON.stringify(backendDetail, null, 2)}
          </pre>
        )}
      </HealthSection>

      {remoteHealth?.checks && (
        <DependencyChecks checks={remoteHealth.checks} />
      )}

      {remoteFetchError && (
        <p className="text-xs text-gray-400">
          Note: the indexer and backend checks above are proxied through{' '}
          <code>/api/admin/health</code>, which last failed with:{' '}
          {remoteFetchError}
        </p>
      )}
    </div>
  );
}

export default function HealthDashboard() {
  return (
    <ErrorBoundary>
      <HealthDashboardContent />
    </ErrorBoundary>
  );
}
