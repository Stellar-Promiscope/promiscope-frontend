import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConfigWarningBanner from '@/components/ConfigWarningBanner';
import type { ConfigWarning } from '@/lib/config';

const SESSION_KEY = 'promiscope:configWarningDismissed';

const errorWarning: ConfigWarning = {
  key: 'NEXT_PUBLIC_CONTRACT_ID',
  message: 'NEXT_PUBLIC_CONTRACT_ID is not set.',
  severity: 'error',
};

const softWarning: ConfigWarning = {
  key: 'NEXT_PUBLIC_IPFS_GATEWAY',
  message: 'NEXT_PUBLIC_IPFS_GATEWAY looks misconfigured.',
  severity: 'warning',
};

describe('ConfigWarningBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders nothing when there are no warnings', () => {
    const { container } = render(<ConfigWarningBanner warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the error styling and heading when any warning has severity "error"', () => {
    render(<ConfigWarningBanner warnings={[errorWarning]} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('⚠️ Configuration Error');
    expect(alert).toHaveClass('bg-red-600');
  });

  it('shows the warning styling and heading when all warnings are severity "warning"', () => {
    render(<ConfigWarningBanner warnings={[softWarning]} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('⚠️ Configuration Warning');
    expect(alert).toHaveClass('bg-yellow-300');
  });

  it('lists each warning key and message', () => {
    render(<ConfigWarningBanner warnings={[errorWarning, softWarning]} />);

    expect(screen.getByText('NEXT_PUBLIC_CONTRACT_ID')).toBeInTheDocument();
    expect(
      screen.getByText(/NEXT_PUBLIC_CONTRACT_ID is not set\./),
    ).toBeInTheDocument();
    expect(screen.getByText('NEXT_PUBLIC_IPFS_GATEWAY')).toBeInTheDocument();
    expect(
      screen.getByText(/NEXT_PUBLIC_IPFS_GATEWAY looks misconfigured\./),
    ).toBeInTheDocument();
  });

  it('dismisses the banner and persists the dismissal in sessionStorage', () => {
    render(<ConfigWarningBanner warnings={[errorWarning]} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('1');
  });

  it('stays dismissed across remounts while the same warnings persist in sessionStorage', () => {
    sessionStorage.setItem(SESSION_KEY, '1');

    render(<ConfigWarningBanner warnings={[errorWarning]} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resets the dismissal once warnings clear, so a fresh warning set is shown again', () => {
    sessionStorage.setItem(SESSION_KEY, '1');

    const { rerender } = render(<ConfigWarningBanner warnings={[]} />);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();

    rerender(<ConfigWarningBanner warnings={[errorWarning]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('falls back gracefully when sessionStorage access throws', () => {
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });

    render(<ConfigWarningBanner warnings={[errorWarning]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: original,
    });
  });
});
