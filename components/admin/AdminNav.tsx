'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const ADMIN_SECTIONS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/validators', label: 'Validators' },
  { href: '/admin/fees', label: 'Fees' },
  { href: '/admin/academies', label: 'Academies' },
  { href: '/admin/referrals', label: 'Referrals' },
  { href: '/admin/audit', label: 'Audit Log' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/fraud', label: 'Fraud Flags' },
  { href: '/admin/disputes', label: 'Disputes' },
  { href: '/admin/health', label: 'Health' },
] as const;

/** Strips an optional locale prefix (`/en/admin/fees` → `/admin/fees`). */
function toAdminPath(pathname: string): string {
  const i = pathname.indexOf('/admin');
  return i === -1 ? pathname : pathname.slice(i).replace(/\/$/, '');
}

export default function AdminNav() {
  const current = toAdminPath(usePathname() ?? '');

  return (
    <nav aria-label="Admin sections" className="md:w-48 shrink-0">
      <ul className="flex md:flex-col gap-1 overflow-x-auto">
        {ADMIN_SECTIONS.map(({ href, label }) => {
          const active = current === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-gray-800 text-brand-green font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
