'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface TruncatedAddressProps {
  address: string;
  copyable?: boolean;
  className?: string;
}

export default function TruncatedAddress({
  address,
  copyable = true,
  className = '',
}: TruncatedAddressProps) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  // Only truncate when there is something to gain — a string of 12 chars or
  // fewer is shown as-is rather than mangled into `G123….abc`.
  const truncated =
    address.length <= 12
      ? address
      : `${address.slice(0, 4)}…${address.slice(-4)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  if (!copyable) {
    return <span className={className}>{truncated}</span>;
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 ${className}`}
      title={copied ? t('address_copied') : t('copy_address')}
    >
      <span className="font-mono">{truncated}</span>
      {copied ? (
        <svg
          className="w-4 h-4 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ) : (
        <svg
          className="w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  );
}
