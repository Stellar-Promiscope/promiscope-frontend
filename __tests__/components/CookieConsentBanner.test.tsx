import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookieConsentBanner, {
  hasConsent,
  reopenConsentBanner,
} from '@/components/ui/CookieConsentBanner';

const STORAGE_KEY = 'promiscope:cookie-consent';

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('does not render immediately on mount', () => {
    render(<CookieConsentBanner />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('slides in after the initial delay when no consent is stored', () => {
    render(<CookieConsentBanner />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(
      screen.getByRole('dialog', { name: 'Cookie consent' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cookie & Tracking Consent')).toBeInTheDocument();
  });

  it('does not render when a consent choice was already stored (accepted)', () => {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    render(<CookieConsentBanner />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render when a consent choice was already stored (declined)', () => {
    localStorage.setItem(STORAGE_KEY, 'declined');
    render(<CookieConsentBanner />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('accepting stores the choice, notifies the caller, and hides the banner', () => {
    const onConsentChange = jest.fn();
    render(<CookieConsentBanner onConsentChange={onConsentChange} />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    act(() => {
      screen.getByRole('button', { name: 'Accept' }).click();
    });

    // onConsentChange fires only after the exit animation delay.
    expect(onConsentChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('accepted');
    expect(onConsentChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('declining stores the choice and notifies the caller with false', () => {
    const onConsentChange = jest.fn();
    render(<CookieConsentBanner onConsentChange={onConsentChange} />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    act(() => {
      screen.getByRole('button', { name: 'Decline' }).click();
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('declined');
    expect(onConsentChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the close icon button behaves like decline', () => {
    const onConsentChange = jest.fn();
    render(<CookieConsentBanner onConsentChange={onConsentChange} />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    act(() => {
      screen.getByRole('button', { name: 'Close consent banner' }).click();
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('declined');
    expect(onConsentChange).toHaveBeenCalledWith(false);
  });

  it('works without an onConsentChange callback', () => {
    render(<CookieConsentBanner />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    act(() => {
      screen.getByRole('button', { name: 'Accept' }).click();
      jest.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('accepted');
  });

  it('links to the privacy policy', () => {
    render(<CookieConsentBanner />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(
      screen.getByRole('link', { name: 'Privacy Policy' }),
    ).toHaveAttribute('href', '/privacy');
  });

  it('exposes reopen on window and reopenConsentBanner triggers it, clearing the stored choice', () => {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    render(<CookieConsentBanner />);

    // No pending-consent banner should appear after the mount effect since a
    // choice is already stored.
    act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => {
      reopenConsentBanner();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(
      screen.getByRole('dialog', { name: 'Cookie consent' }),
    ).toBeInTheDocument();
  });

  it('reopenConsentBanner is a no-op when no banner instance is mounted', () => {
    expect(() => reopenConsentBanner()).not.toThrow();
  });

  it('removes the window hook on unmount', () => {
    const { unmount } = render(<CookieConsentBanner />);
    expect(
      (window as unknown as Record<string, unknown>).__promiscopeReopenConsent,
    ).toBeInstanceOf(Function);

    unmount();

    expect(
      (window as unknown as Record<string, unknown>).__promiscopeReopenConsent,
    ).toBeUndefined();
  });

  describe('hasConsent', () => {
    it('returns true only when the stored choice is "accepted"', () => {
      expect(hasConsent()).toBe(false);

      localStorage.setItem(STORAGE_KEY, 'declined');
      expect(hasConsent()).toBe(false);

      localStorage.setItem(STORAGE_KEY, 'accepted');
      expect(hasConsent()).toBe(true);
    });

    it('returns false and does not throw when localStorage access fails', () => {
      const getItemSpy = jest
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });

      expect(hasConsent()).toBe(false);

      getItemSpy.mockRestore();
    });
  });

  it('does not throw when storing the consent choice fails', () => {
    const setItemSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });

    render(<CookieConsentBanner />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(() => {
      act(() => {
        screen.getByRole('button', { name: 'Accept' }).click();
      });
    }).not.toThrow();

    setItemSpy.mockRestore();
  });
});
