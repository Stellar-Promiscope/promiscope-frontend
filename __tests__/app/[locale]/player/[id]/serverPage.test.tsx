/** @jest-environment node */
import { renderToString } from 'react-dom/server';

const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
jest.mock('next/navigation', () => ({ notFound: () => mockNotFound() }));

const mockGetPlayer = jest.fn();
jest.mock('@/lib/contract', () => ({
  getPlayer: (id: string) => mockGetPlayer(id),
}));

jest.mock('@/app/[locale]/player/[id]/PlayerProfileClient', () => ({
  __esModule: true,
  default: ({
    initialPlayer,
  }: {
    initialPlayer: { vitals: { name: string } } | null;
  }) => (initialPlayer ? <h1>{initialPlayer.vitals.name}</h1> : null),
}));

import PlayerProfilePage from '@/app/[locale]/player/[id]/page';

const params = { locale: 'en', id: 'player-1' };

beforeEach(() => jest.clearAllMocks());

describe('player profile server page (#1349)', () => {
  it('passes the server-fetched player to the client so it is in the initial HTML', async () => {
    mockGetPlayer.mockResolvedValue({
      id: 'player-1',
      vitals: { name: 'Jane Doe' },
    });
    const html = renderToString(await PlayerProfilePage({ params }));
    expect(mockGetPlayer).toHaveBeenCalledWith('player-1');
    expect(html).toContain('Jane Doe');
  });

  it('returns a real 404 for an unknown player (contract error 3)', async () => {
    mockGetPlayer.mockRejectedValue(new Error('Player not found'));
    await expect(PlayerProfilePage({ params })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('falls back to the client fetch on a transient RPC error', async () => {
    mockGetPlayer.mockRejectedValue(new Error('network down'));
    const el = await PlayerProfilePage({ params });
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(el.props.initialPlayer).toBeNull();
  });
});
