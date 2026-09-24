const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockGet = jest.fn();

jest.mock('@/lib/messaging/chatApi', () => ({
  __esModule: true,
  default: {
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import {
  reportUser,
  blockUser,
  unblockUser,
  fetchBlockedUsers,
  getBlockedUsers,
  isUserBlocked,
  isBlockedByCounterpart,
  type BlockedUser,
} from '@/lib/messaging/moderation';
import { setActiveWallet } from '@/lib/activeWallet';

const WALLET_A = 'GWALLETA';
const WALLET_B = 'GWALLETB';
const BLOCKED_USERS_KEY = `scoutoff_blocked_users:${WALLET_A}`;

beforeEach(() => {
  mockPost.mockReset();
  mockDelete.mockReset();
  mockGet.mockReset();
  mockPost.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  window.localStorage.clear();
  setActiveWallet(WALLET_A);
});

describe('reportUser', () => {
  it('posts a moderation report with threadId, counterpartId, and reason', async () => {
    await reportUser('thread-1', 'user-2', 'spam');

    expect(mockPost).toHaveBeenCalledWith('/moderation/reports', {
      threadId: 'thread-1',
      counterpartId: 'user-2',
      reason: 'spam',
    });
  });
});

describe('blockUser', () => {
  it('posts a block request and persists the blocked user locally', async () => {
    await blockUser('user-2');

    expect(mockPost).toHaveBeenCalledWith('/moderation/blocks', {
      counterpartId: 'user-2',
    });
    const stored: BlockedUser[] = JSON.parse(
      window.localStorage.getItem(BLOCKED_USERS_KEY) ?? '[]',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].userId).toBe('user-2');
    expect(typeof stored[0].blockedAt).toBe('string');
  });

  it('does not duplicate an already-blocked user', async () => {
    await blockUser('user-2');
    await blockUser('user-2');

    const stored = getBlockedUsers();
    expect(stored).toHaveLength(1);
  });

  it('can accumulate multiple distinct blocked users', async () => {
    await blockUser('user-2');
    await blockUser('user-3');

    const stored = getBlockedUsers();
    expect(stored.map((b) => b.userId).sort()).toEqual(['user-2', 'user-3']);
  });
});

describe('unblockUser', () => {
  it('deletes the block server-side and removes it from local storage', async () => {
    await blockUser('user-2');
    await blockUser('user-3');

    await unblockUser('user-2');

    expect(mockDelete).toHaveBeenCalledWith('/moderation/blocks/user-2');
    const stored = getBlockedUsers();
    expect(stored.map((b) => b.userId)).toEqual(['user-3']);
  });

  it('is a no-op locally when unblocking a user that was never blocked', async () => {
    await unblockUser('ghost-user');

    expect(mockDelete).toHaveBeenCalledWith('/moderation/blocks/ghost-user');
    expect(getBlockedUsers()).toEqual([]);
  });
});

describe('getBlockedUsers', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(getBlockedUsers()).toEqual([]);
  });

  it('returns an empty array when localStorage contains invalid JSON', () => {
    window.localStorage.setItem(BLOCKED_USERS_KEY, 'not-json{{{');
    expect(getBlockedUsers()).toEqual([]);
  });
});

describe('fetchBlockedUsers', () => {
  it('fetches the authoritative block list from the server', async () => {
    const serverList: BlockedUser[] = [
      { userId: 'user-9', blockedAt: '2026-01-01T00:00:00.000Z' },
    ];
    mockGet.mockResolvedValue({ data: serverList });

    const result = await fetchBlockedUsers();

    expect(mockGet).toHaveBeenCalledWith('/moderation/blocks');
    expect(result).toEqual(serverList);
  });

  it('persists the server response locally, overwriting whatever was cached', async () => {
    window.localStorage.setItem(
      BLOCKED_USERS_KEY,
      JSON.stringify([{ userId: 'stale-user', blockedAt: 'x' }]),
    );
    const serverList: BlockedUser[] = [
      { userId: 'user-9', blockedAt: '2026-01-01T00:00:00.000Z' },
    ];
    mockGet.mockResolvedValue({ data: serverList });

    await fetchBlockedUsers();

    expect(getBlockedUsers()).toEqual(serverList);
  });

  it('overwrites a corrupted local cache with the server response', async () => {
    window.localStorage.setItem(BLOCKED_USERS_KEY, 'not-json{{{');
    const serverList: BlockedUser[] = [
      { userId: 'user-9', blockedAt: '2026-01-01T00:00:00.000Z' },
    ];
    mockGet.mockResolvedValue({ data: serverList });

    await fetchBlockedUsers();

    expect(getBlockedUsers()).toEqual(serverList);
  });
});

describe('isUserBlocked', () => {
  it('returns true for a blocked user', async () => {
    await blockUser('user-2');
    expect(isUserBlocked('user-2')).toBe(true);
  });

  it('returns false for a user that is not blocked', async () => {
    await blockUser('user-2');
    expect(isUserBlocked('user-3')).toBe(false);
  });
});

describe('isBlockedByCounterpart', () => {
  it('returns true when the server reports the counterpart has blocked the current wallet', async () => {
    mockGet.mockResolvedValue({ data: { blocked: true } });

    const result = await isBlockedByCounterpart('user-2');

    expect(mockGet).toHaveBeenCalledWith('/moderation/blocks/user-2/status');
    expect(result).toBe(true);
  });

  it('returns false when the counterpart has not blocked the current wallet', async () => {
    mockGet.mockResolvedValue({ data: { blocked: false } });

    const result = await isBlockedByCounterpart('user-2');

    expect(result).toBe(false);
  });
});

describe('wallet scoping', () => {
  it("never exposes one wallet's block list to another wallet", async () => {
    setActiveWallet(WALLET_A);
    await blockUser('user-2');
    expect(isUserBlocked('user-2')).toBe(true);

    setActiveWallet(WALLET_B);
    expect(getBlockedUsers()).toEqual([]);
    expect(isUserBlocked('user-2')).toBe(false);

    await blockUser('user-3');
    expect(getBlockedUsers().map((b) => b.userId)).toEqual(['user-3']);

    setActiveWallet(WALLET_A);
    expect(getBlockedUsers().map((b) => b.userId)).toEqual(['user-2']);
  });

  it('reads and writes nothing when no wallet is connected', async () => {
    setActiveWallet(null);
    await blockUser('user-2');
    expect(getBlockedUsers()).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });
});
