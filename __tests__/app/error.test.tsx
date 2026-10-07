import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ErrorPage from '@/app/error';

const captureException = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

describe('ErrorPage', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      configurable: true,
    });
    if (originalDsn === undefined) {
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    } else {
      process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
    }
  });

  it('renders the fallback error UI with Try Again and Go Home actions', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const reset = jest.fn();

    render(<ErrorPage error={error} reset={reset} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try Again' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go Home' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('logs the error to the console on mount', () => {
    const error = new Error('logged error');
    render(<ErrorPage error={error} reset={jest.fn()} />);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Promiscope] Unhandled error:',
      error,
    );
  });

  it('calls reset when the Try Again button is clicked', () => {
    const reset = jest.fn();
    render(<ErrorPage error={new Error('boom')} reset={reset} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not show the raw error message outside development mode', () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'test',
      configurable: true,
    });

    render(
      <ErrorPage error={new Error('secret internals')} reset={jest.fn()} />,
    );

    expect(screen.queryByText('secret internals')).not.toBeInTheDocument();
  });

  it('shows the raw error message in development mode', () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      configurable: true,
    });

    render(
      <ErrorPage error={new Error('dev only message')} reset={jest.fn()} />,
    );

    expect(screen.getByText('dev only message')).toBeInTheDocument();
  });

  it('does not attempt Sentry reporting when NEXT_PUBLIC_SENTRY_DSN is unset', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    render(<ErrorPage error={new Error('no dsn')} reset={jest.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports to Sentry when NEXT_PUBLIC_SENTRY_DSN is set', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://example.ingest.sentry.io/1';
    const error = new Error('reported error');

    render(<ErrorPage error={error} reset={jest.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
