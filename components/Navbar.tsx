'use client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import WalletButton from './WalletButton';
import AccountSwitcher from './AccountSwitcher';
import ThemeToggle from './ui/ThemeToggle';
import { useContractStatus } from '@/hooks/useContractStatus';
import { useWallet } from '@/hooks/useWallet';
import { useCurrencyPreference } from '@/hooks/useCurrencyPreference';
import NotificationBell from './NotificationBell';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/locales';
import SessionMismatchWarning from './SessionMismatchWarning';

const NAV_LINKS = [
  { href: '/scout', labelKey: 'nav.scout_dashboard' },
  { href: '/player', labelKey: 'nav.player_dashboard' },
];

const SPONSORSHIP_LINK = { href: '/sponsorship', labelKey: 'nav.sponsorship' };

export default function Navbar() {
  const { isPaused } = useContractStatus();
  const { xlmBalance, isLoadingBalance, isAuthenticated, sessionMismatch } =
    useWallet();
  const { currency, setCurrency, supported } = useCurrencyPreference();
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [localeOpen, setLocaleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const currentLocale = pathname.split('/')[1] || 'en';
  const locales = [
    { code: 'en', label: t('language.english') },
    { code: 'fr', label: t('language.french') },
    { code: 'sw', label: t('language.swahili') },
  ];

  const handleLanguageChange = (locale: string) => {
    const newPathname = pathname.replace(/^\/[a-z]{2}/, `/${locale}`);
    const target = pathname.startsWith(`/${currentLocale}`)
      ? newPathname
      : `/${locale}${pathname}`;
    router.push(target);
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    setLocaleOpen(false);
    setMenuOpen(false);
  };

  const closeMenu = () => setMenuOpen(false);

  // Return focus to hamburger button when menu closes (not on initial mount)
  const wasMenuOpen = useRef(false);
  useEffect(() => {
    if (wasMenuOpen.current && !menuOpen) {
      hamburgerRef.current?.focus();
    }
    wasMenuOpen.current = menuOpen;
  }, [menuOpen]);

  // Trap focus inside mobile menu and close on Escape
  useEffect(() => {
    if (!menuOpen) return;

    const menu = mobileMenuRef.current;
    if (!menu) return;

    // Move focus to first focusable element
    const focusable = menu.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeMenu();
        return;
      }
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  return (
    <>
      {sessionMismatch && <SessionMismatchWarning />}
      {isPaused && (
        <div className="bg-yellow-500 text-black text-center text-sm font-medium py-2 px-4">
          {t('nav.maintenance_warning')}
        </div>
      )}
      <nav
        aria-label="Main navigation"
        className="border-b border-gray-200 dark:border-gray-800 bg-brand-dark"
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-2">
          {/* Logo */}
          <Link
            href={`/${currentLocale}`}
            className="text-brand-green font-bold text-xl tracking-tight shrink-0"
          >
            {t('app_title')}
          </Link>

          {/* ── Desktop nav (sm and above) ── */}
          <div className="hidden sm:flex items-center gap-6 text-sm text-gray-700 dark:text-gray-300 min-w-0">
            {NAV_LINKS.map(({ href, labelKey }) => (
              <Link
                key={href}
                href={`/${currentLocale}${href}`}
                className="hover:text-gray-900 dark:hover:text-white transition whitespace-nowrap"
              >
                {t(labelKey)}
              </Link>
            ))}

            <Link
              href={`/${currentLocale}${SPONSORSHIP_LINK.href}`}
              className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition whitespace-nowrap"
            >
              {t(SPONSORSHIP_LINK.labelKey)}
              <span className="text-[10px] uppercase tracking-wide border border-gray-300 dark:border-gray-700 rounded-full px-1.5 py-0.5">
                {t('nav.soon')}
              </span>
            </Link>

            {/* Locale switcher */}
            <div className="relative">
              <button
                onClick={() => setLocaleOpen(!localeOpen)}
                className="hover:text-gray-900 dark:hover:text-white transition flex items-center gap-1 whitespace-nowrap"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={localeOpen}
                aria-label={t('language.select_language')}
              >
                {locales.find((l) => l.code === currentLocale)?.label ||
                  t('language.select_language')}
                <span className="text-xs" aria-hidden="true">
                  ▼
                </span>
              </button>
              {localeOpen && (
                <div
                  role="listbox"
                  aria-label={t('language.select_language')}
                  className="absolute right-0 mt-2 w-40 bg-brand-dark border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-50"
                >
                  {locales.map((locale) => (
                    <button
                      key={locale.code}
                      type="button"
                      role="option"
                      aria-selected={currentLocale === locale.code}
                      onClick={() => handleLanguageChange(locale.code)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-brand-green hover:text-black transition ${
                        currentLocale === locale.code
                          ? 'bg-brand-green/20 text-brand-green'
                          : ''
                      }`}
                    >
                      {locale.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Currency selector */}
            <div className="relative">
              <button
                onClick={() => setCurrencyOpen(!currencyOpen)}
                className="hover:text-gray-900 dark:hover:text-white transition flex items-center gap-1 whitespace-nowrap"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={currencyOpen}
                aria-label="Select currency"
                title={`Current currency: ${currency}`}
              >
                {currency}
                <span className="text-xs" aria-hidden="true">
                  ▼
                </span>
              </button>
              {currencyOpen && (
                <div
                  role="listbox"
                  aria-label="Select currency"
                  className="absolute right-0 mt-2 w-52 bg-brand-dark border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto"
                >
                  {supported.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      role="option"
                      aria-selected={currency === c.code}
                      onClick={() => {
                        setCurrency(c.code);
                        setCurrencyOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-brand-green hover:text-black transition ${
                        currency === c.code
                          ? 'bg-brand-green/20 text-brand-green'
                          : ''
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <NotificationBell />

            {/* XLM balance — hidden below md */}
            {isAuthenticated && (
              <span className="hidden md:inline text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                {isLoadingBalance ? (
                  <span
                    className="text-gray-500 dark:text-gray-400"
                    aria-hidden="true"
                  >
                    ⟳
                  </span>
                ) : (
                  <span>{xlmBalance ?? '0.00'} XLM</span>
                )}
              </span>
            )}

            <ThemeToggle />
            <AccountSwitcher />
            <div data-tour="wallet-button">
              <WalletButton />
            </div>
          </div>

          {/* ── Hamburger button (mobile only) ── */}
          <button
            ref={hamburgerRef}
            type="button"
            className="sm:hidden p-2 rounded text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={
              menuOpen
                ? t('common.close') + ' navigation menu'
                : 'Open navigation menu'
            }
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <svg
              aria-hidden="true"
              focusable="false"
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {menuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* ── Mobile menu drawer ── */}
        {menuOpen && (
          <div
            ref={mobileMenuRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="sm:hidden border-t border-gray-200 dark:border-gray-800 bg-brand-dark px-4 py-3 flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300"
          >
            {NAV_LINKS.map(({ href, labelKey }) => (
              <Link
                key={href}
                href={`/${currentLocale}${href}`}
                aria-current={
                  pathname === `/${currentLocale}${href}` ? 'page' : undefined
                }
                className="hover:text-gray-900 dark:hover:text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green rounded py-2 px-1"
                onClick={closeMenu}
              >
                {t(labelKey)}
              </Link>
            ))}

            <Link
              href={`/${currentLocale}${SPONSORSHIP_LINK.href}`}
              aria-current={
                pathname === `/${currentLocale}${SPONSORSHIP_LINK.href}`
                  ? 'page'
                  : undefined
              }
              className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green rounded py-2 px-1"
              onClick={closeMenu}
            >
              {t(SPONSORSHIP_LINK.labelKey)}
              <span className="text-[10px] uppercase tracking-wide border border-gray-300 dark:border-gray-700 rounded-full px-1.5 py-0.5">
                {t('nav.soon')}
              </span>
            </Link>

            {/* Locale switcher in mobile menu */}
            <div className="border-t border-gray-200 dark:border-gray-800 mt-1 pt-3 flex flex-col gap-0.5">
              <p className="text-xs text-gray-500 dark:text-gray-400 px-1 mb-1">
                {t('language.select_language')}
              </p>
              {locales.map((locale) => (
                <button
                  key={locale.code}
                  type="button"
                  aria-pressed={currentLocale === locale.code}
                  onClick={() => handleLanguageChange(locale.code)}
                  className={`w-full text-left px-4 py-2 text-sm rounded hover:bg-brand-green hover:text-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green ${
                    currentLocale === locale.code
                      ? 'bg-brand-green/20 text-brand-green'
                      : ''
                  }`}
                >
                  {locale.label}
                </button>
              ))}
            </div>

            {/* Currency selector in mobile menu */}
            <div className="border-t border-gray-800 mt-1 pt-3 flex flex-col gap-0.5">
              <p className="text-xs text-gray-500 px-1 mb-1">Currency</p>
              {supported.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  aria-pressed={currency === c.code}
                  onClick={() => {
                    setCurrency(c.code);
                    closeMenu();
                  }}
                  className={`w-full text-left px-4 py-2 text-sm rounded hover:bg-brand-green hover:text-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green ${
                    currency === c.code
                      ? 'bg-brand-green/20 text-brand-green'
                      : ''
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Theme toggle in mobile menu */}
            <div className="border-t border-gray-800 mt-1 pt-3 flex items-center gap-2">
              <span className="text-xs text-gray-500 px-1">Theme</span>
              <ThemeToggle />
            </div>

            {/* Wallet — balance hidden on mobile to prevent overflow */}
            <div className="border-t border-gray-800 mt-1 pt-3 flex items-center gap-2">
              <NotificationBell />
              <AccountSwitcher />
              <WalletButton hideBalance />
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
