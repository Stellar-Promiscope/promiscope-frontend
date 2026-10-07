'use client';
import { useEffect } from 'react';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function reportToSentry(error: Error) {
  try {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    // Dynamic import via variable to avoid TS type error when @sentry/nextjs is not installed
    const pkg = '@sentry/nextjs';
    (import(/* webpackIgnore: true */ pkg) as Promise<any>)
      .then(({ captureException }) => captureException(error))
      .catch(() => {
        /* Sentry unavailable — silent */
      });
  } catch {
    // Never let reporting crash the error UI
  }
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('[Promiscope] Unhandled error:', error);
    reportToSentry(error);
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';
  // Safely extract a message — guard against malformed error objects
  const devMessage =
    isDev && error instanceof Error && typeof error.message === 'string'
      ? error.message
      : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center"
    >
      <div className="flex flex-col items-center gap-3 max-w-md">
        <span className="text-4xl" aria-hidden>
          ⚠️
        </span>
        <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          An unexpected error occurred. Please try again, or return to the home
          page if the problem persists.
        </p>
        {devMessage && (
          <pre className="mt-2 w-full overflow-x-auto rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-left text-xs text-red-400">
            {devMessage}
          </pre>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={reset}
          className="bg-brand-green text-black font-semibold px-6 py-2.5 rounded-xl hover:opacity-90 active:scale-95 transition"
        >
          Try Again
        </button>
        <a
          href="/"
          className="border border-gray-700 text-gray-300 px-6 py-2.5 rounded-xl hover:border-gray-500 transition"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}
