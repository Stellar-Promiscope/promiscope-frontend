import {
  formatNumber,
  formatXlmAmount,
  formatDate,
  formatDateTime,
  formatRelativeTime,
} from '@/lib/localeFormat';

describe('formatNumber', () => {
  it('formats a number using the given locale', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });

  it('applies custom Intl.NumberFormatOptions', () => {
    expect(
      formatNumber(1234.5, 'en', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe('1,234.50');
  });

  it('falls back to en-US for an unrecognised locale', () => {
    expect(formatNumber(1000, 'xx' as any)).toBe('1,000');
  });
});

describe('formatXlmAmount', () => {
  it('formats with up to 7 fraction digits and no trailing zeros', () => {
    expect(formatXlmAmount(10, 'en')).toBe('10');
    expect(formatXlmAmount(10.1234567, 'en')).toBe('10.1234567');
  });
});

describe('formatDate', () => {
  it('formats a date using a medium date style by default', () => {
    const result = formatDate(new Date('2024-03-15T00:00:00Z'), 'en');
    expect(result).toContain('2024');
  });

  it('accepts a numeric timestamp and custom options', () => {
    const result = formatDate(
      new Date('2024-03-15T00:00:00Z').getTime(),
      'fr',
      { dateStyle: 'short' },
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatDateTime', () => {
  it('formats a date with both date and time components', () => {
    const result = formatDateTime(new Date('2024-03-15T14:30:00Z'), 'sw');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  it('picks the largest fitting unit, per locale', () => {
    expect(formatRelativeTime(now - 5 * 60_000, 'en', now)).toBe(
      '5 minutes ago',
    );
    expect(formatRelativeTime(now - 2 * 86_400_000, 'fr', now)).toBe(
      'avant-hier',
    );
    expect(formatRelativeTime(now - 3 * 3_600_000, 'en', now)).toBe(
      '3 hours ago',
    );
  });
});
