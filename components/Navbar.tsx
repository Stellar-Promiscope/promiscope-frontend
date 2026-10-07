'use client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import WalletButton from './WalletButton';
import ThemeToggle from './ui/ThemeToggle';
import { useContractStatus } from '@/hooks/useContractStatus';
import { useWallet } from '@/hooks/useWallet';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/locales';
import SessionMismatchWarning from './SessionMismatchWarning';

const NAV_LINKS = [
  { href: '/projects', labelKey: 'nav.projects' },
  { href: '/#how-it-works', labelKey: 'nav.how_it_works' },
];

export default function Navbar() {
  const { isPaused } = useContractStatus();
  const { sessionMismatch } = useWallet();
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [localeOpen, setLocaleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
        className="border-b border-[#e3e7df] bg-[#f6f5ef]"
      >
        <div className="max-w-6xl mx-auto px-4 h-[4.5rem] flex items-center justify-between gap-2">
          {/* Logo */}
          <Link
            href={`/${currentLocale}`}
            className="flex items-center gap-2.5 text-[#245d49] font-semibold text-xl tracking-tight shrink-0"
          >
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#245d49] text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M3.5 12c2.1-3.4 4.9-5.1 8.5-5.1s6.4 1.7 8.5 5.1c-2.1 3.4-4.9 5.1-8.5 5.1S5.6 15.4 3.5 12Z" />
                <circle cx="12" cy="12" r="2.2" />
              </svg>
            </span>
            {t('app_title')}
          </Link>

          {/* ── Desktop nav (sm and above) ── */}
          <div className="hidden sm:flex items-center gap-6 text-sm text-[#526259] min-w-0">
            {NAV_LINKS.map(({ href, labelKey }) => (
              <Link
                key={href}
                href={`/${currentLocale}${href}`}
                className="hover:text-[#204e3d] transition whitespace-nowrap"
              >
                {t(labelKey)}
              </Link>
            ))}

            <Link
              href={`/${currentLocale}/organizations`}
              className="hover:text-[#204e3d] transition whitespace-nowrap"
            >
              {t('nav.for_organizations')}
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
                  className="absolute right-0 mt-2 w-40 rounded-xl border border-[#e3e7df] bg-white shadow-lg z-50"
                >
                  {locales.map((locale) => (
                    <button
                      key={locale.code}
                      type="button"
                      role="option"
                      aria-selected={currentLocale === locale.code}
                      onClick={() => handleLanguageChange(locale.code)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-[#e9f1e8] hover:text-[#204e3d] transition ${
                        currentLocale === locale.code
                          ? 'bg-[#e9f1e8] text-[#245d49]'
                          : ''
                      }`}
                    >
                      {locale.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ThemeToggle />
            <div data-tour="wallet-button">
              <WalletButton />
            </div>
          </div>

          {/* ── Hamburger button (mobile only) ── */}
          <button
            ref={hamburgerRef}
            type="button"
            className="sm:hidden rounded p-2 text-[#526259] hover:text-[#204e3d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#245d49]"
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
            className="sm:hidden flex flex-col gap-1 border-t border-[#e3e7df] bg-white px-4 py-3 text-sm text-[#526259]"
          >
            {NAV_LINKS.map(({ href, labelKey }) => (
              <Link
                key={href}
                href={`/${currentLocale}${href}`}
                aria-current={
                  pathname === `/${currentLocale}${href}` ? 'page' : undefined
                }
                className="rounded px-1 py-2 transition hover:text-[#204e3d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#245d49]"
                onClick={closeMenu}
              >
                {t(labelKey)}
              </Link>
            ))}

            <Link
              href={`/${currentLocale}/organizations`}
              aria-current={pathname === `/${currentLocale}/organizations` ? 'page' : undefined}
              className="rounded px-1 py-2 transition hover:text-[#204e3d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#245d49]"
              onClick={closeMenu}
            >
              {t('nav.for_organizations')}
            </Link>

            {/* Locale switcher in mobile menu */}
            <div className="mt-1 flex flex-col gap-0.5 border-t border-[#e3e7df] pt-3">
              <p className="mb-1 px-1 text-xs text-[#849087]">
                {t('language.select_language')}
              </p>
              {locales.map((locale) => (
                <button
                  key={locale.code}
                  type="button"
                  aria-pressed={currentLocale === locale.code}
                  onClick={() => handleLanguageChange(locale.code)}
                  className={`w-full rounded px-4 py-2 text-left text-sm transition hover:bg-[#e9f1e8] hover:text-[#204e3d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#245d49] ${
                    currentLocale === locale.code
                      ? 'bg-[#e9f1e8] text-[#245d49]'
                      : ''
                  }`}
                >
                  {locale.label}
                </button>
              ))}
            </div>

            {/* Theme toggle in mobile menu */}
            <div className="mt-1 flex items-center gap-2 border-t border-[#e3e7df] pt-3">
              <span className="px-1 text-xs text-[#849087]">Theme</span>
              <ThemeToggle />
            </div>

            {/* Wallet connection remains available for future Stellar-backed workflows. */}
            <div className="mt-1 flex items-center gap-2 border-t border-[#e3e7df] pt-3">
              <WalletButton hideBalance />
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
