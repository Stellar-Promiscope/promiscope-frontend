import { redactTelemetryValue } from '@/lib/telemetry';

describe('telemetry redaction', () => {
  it('truncates Stellar wallet addresses in span values', () => {
    const wallet = `G${'A'.repeat(55)}`;

    expect(redactTelemetryValue('resource', `wallet=${wallet}`)).toBe(
      'wallet=GAAA...AAAA',
    );
  });

  it.each(['wallet_address', 'email', 'authorization', 'contact_phone'])(
    'redacts sensitive %s attributes entirely',
    (key) => {
      expect(redactTelemetryValue(key, 'private-value')).toBe('[REDACTED]');
    },
  );
});
