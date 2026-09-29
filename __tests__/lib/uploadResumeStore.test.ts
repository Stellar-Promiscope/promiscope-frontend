import {
  UPLOAD_RESUME_KEY,
  SESSION_TTL_MS,
  saveResumeState,
  loadResumeState,
  clearResumeState,
  type PersistedUploadState,
} from '@/lib/uploadResumeStore';

const NOW = new Date('2026-01-01T12:00:00Z').getTime();

function makeState(
  overrides: Partial<PersistedUploadState> = {},
): PersistedUploadState {
  return {
    sessionId: 'session-1',
    filename: 'highlights.mp4',
    fileSize: 1024,
    fileType: 'video/mp4',
    totalChunks: 4,
    savedAt: NOW,
    ...overrides,
  };
}

describe('uploadResumeStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('round-trips saved state', () => {
    const state = makeState();
    saveResumeState(state);
    expect(loadResumeState()).toEqual(state);
  });

  it('returns null when nothing is stored', () => {
    expect(loadResumeState()).toBeNull();
  });

  it('returns null without throwing for corrupted JSON', () => {
    localStorage.setItem(UPLOAD_RESUME_KEY, '{not json');
    expect(() => loadResumeState()).not.toThrow();
    expect(loadResumeState()).toBeNull();
    expect(localStorage.getItem(UPLOAD_RESUME_KEY)).toBeNull();
  });

  it('clear removes the entry', () => {
    saveResumeState(makeState());
    clearResumeState();
    expect(localStorage.getItem(UPLOAD_RESUME_KEY)).toBeNull();
    expect(loadResumeState()).toBeNull();
  });

  it('ignores and removes entries older than the TTL', () => {
    saveResumeState(makeState({ savedAt: NOW - SESSION_TTL_MS - 1 }));
    expect(loadResumeState()).toBeNull();
    expect(localStorage.getItem(UPLOAD_RESUME_KEY)).toBeNull();
  });

  it('keeps entries exactly at the TTL boundary', () => {
    const state = makeState({ savedAt: NOW - SESSION_TTL_MS });
    saveResumeState(state);
    expect(loadResumeState()).toEqual(state);
  });

  it('handles localStorage throwing (quota / private mode)', () => {
    const err = new Error('QuotaExceededError');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw err;
    });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw err;
    });
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw err;
    });

    expect(() => saveResumeState(makeState())).not.toThrow();
    expect(loadResumeState()).toBeNull();
    expect(() => clearResumeState()).not.toThrow();
  });
});
