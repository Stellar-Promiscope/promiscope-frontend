import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import fixtures from '../__fixtures__/v1-events.json';
import { decodeSorobanEvent } from '..';

describe('v1 contract event golden fixtures', () => {
  it.each(fixtures.events)('decodes %s', (fixture) => {
    const decoded = decodeSorobanEvent({
      topic: [xdr.ScVal.fromXDR(fixture.topicXdr, 'base64')],
      value: xdr.ScVal.fromXDR(fixture.valueXdr, 'base64'),
      contractVersion: 1,
    });

    expect(decoded.type).toBe(fixture.type);
    expect(decoded.version).toBe(1);
    expect(decoded.data).toMatchObject({ fixture: true, event: fixture.type });
  });

  it('returns an unknown event without throwing', () => {
    const unknown = decodeSorobanEvent({
      topic: [nativeToScVal('future_event', { type: 'symbol' })],
      value: xdr.ScVal.fromXDR(fixtures.events[0].valueXdr, 'base64'),
      contractVersion: 1,
    });

    expect(unknown.type).toBe('unknown');
    expect(unknown.data.rawTopicXdr).toBeDefined();
  });
});
