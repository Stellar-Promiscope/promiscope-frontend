/**
 * @jest-environment jsdom
 */
import { defaultContactVaultClient } from '@/lib/contactVaultClient';

const PLAYER = 'GPLAYERWALLETADDRESSHERE0000000000000000000000000';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('defaultContactVaultClient.getMetadata', () => {
  it('scopes the read to the playerId in the query string', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hasContactDetails: true, updatedAt: 123 }),
    );
    await defaultContactVaultClient.getMetadata(PLAYER);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/contact/vault?playerId=${PLAYER}`,
    );
  });

  it('url-encodes the player id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hasContactDetails: false, updatedAt: null }),
    );
    await defaultContactVaultClient.getMetadata('G/../evil');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/contact/vault?playerId=${encodeURIComponent('G/../evil')}`,
    );
  });

  it('returns the metadata as-is', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hasContactDetails: true, updatedAt: 42 }),
    );
    await expect(
      defaultContactVaultClient.getMetadata(PLAYER),
    ).resolves.toEqual({ hasContactDetails: true, updatedAt: 42 });
  });

  it('surfaces the server’s error text on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'You can only manage your own contact details' },
        { status: 403 },
      ),
    );
    await expect(defaultContactVaultClient.getMetadata(PLAYER)).rejects.toThrow(
      'You can only manage your own contact details',
    );
  });

  it('falls back to a readable message when the body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(defaultContactVaultClient.getMetadata(PLAYER)).rejects.toThrow(
      'Failed to load contact details status',
    );
  });
});

describe('defaultContactVaultClient.save', () => {
  it('POSTs the playerId alongside the details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true }, { status: 201 }),
    );
    await defaultContactVaultClient.save(PLAYER, {
      email: 'a@b.co',
      phone: '',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/contact/vault', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: PLAYER,
        email: 'a@b.co',
        phone: '',
      }),
    });
  });

  it('propagates the not-configured error so the UI can show it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'Contact vault is not configured' },
        { status: 500 },
      ),
    );
    await expect(
      defaultContactVaultClient.save(PLAYER, { email: 'a@b.co' }),
    ).rejects.toThrow('Contact vault is not configured');
  });
});

describe('defaultContactVaultClient.remove', () => {
  it('sends DELETE scoped to the playerId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await defaultContactVaultClient.remove(PLAYER);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/contact/vault?playerId=${PLAYER}`,
      { method: 'DELETE' },
    );
  });

  it('throws with a readable message on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'No contact details stored' }, { status: 404 }),
    );
    await expect(defaultContactVaultClient.remove(PLAYER)).rejects.toThrow(
      'No contact details stored',
    );
  });
});
