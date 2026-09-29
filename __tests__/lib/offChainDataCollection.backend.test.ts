/** @jest-environment node */
import { collectUserData, deleteUserData } from '@/lib/offChainDataCollection';
import {
  deleteBackendUserData,
  fetchBackendUserData,
  isBackendUserDataConfigured,
} from '@/lib/backendUserData';

jest.mock('@/lib/backendUserData', () => ({
  isBackendUserDataConfigured: jest.fn(),
  fetchBackendUserData: jest.fn(),
  deleteBackendUserData: jest.fn(),
}));

const WALLET = 'GBACKEND000000000000000000000000000000000000000000000000000000';

const configured = isBackendUserDataConfigured as jest.Mock;
const fetchBackend = fetchBackendUserData as jest.Mock;
const deleteBackend = deleteBackendUserData as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  configured.mockReturnValue(true);
});

describe('backend sections (#1352)', () => {
  it('merges backend records into the export', async () => {
    const backend = { referralCodes: [{ code: 'ABC' }] };
    fetchBackend.mockResolvedValue(backend);

    const data = await collectUserData(WALLET);

    expect(fetchBackend).toHaveBeenCalledWith(WALLET);
    expect(data.sections.backend).toEqual(backend);
    expect(data.excluded.map((e) => e.name)).not.toContain('collectionErrors');
  });

  it('surfaces a backend export failure as a collection error', async () => {
    fetchBackend.mockRejectedValue(new Error('timeout of 5000ms exceeded'));

    const data = await collectUserData(WALLET);

    expect(data.sections.backend).toBeNull();
    const errors = data.excluded.find((e) => e.name === 'collectionErrors');
    expect(errors?.reason).toContain('backend: timeout of 5000ms exceeded');
  });

  it('merges backend deletion counts', async () => {
    deleteBackend.mockResolvedValue({
      removed: { referralCodes: 2 },
      anonymized: { referralRedemptions: 1 },
    });

    const { removed, anonymized, failed } = await deleteUserData(WALLET);

    expect(removed['backend.referralCodes']).toBe(2);
    expect(anonymized['backend.referralRedemptions']).toBe(1);
    expect(failed).toEqual({});
  });

  it('reports a backend deletion failure instead of throwing', async () => {
    deleteBackend.mockRejectedValue(new Error('Request failed with 500'));

    const { failed } = await deleteUserData(WALLET);

    expect(failed).toEqual({ backend: 'Request failed with 500' });
  });
});
