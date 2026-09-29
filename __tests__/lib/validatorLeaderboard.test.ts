import {
  VALID_VALIDATOR_LEADERBOARD_RANGES,
  getValidatorLeaderboardRange,
  parseValidatorLeaderboardRange,
} from '@/lib/validatorLeaderboard';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-01-31T00:00:00Z').getTime();

describe('validatorLeaderboard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => jest.useRealTimers());

  describe('parseValidatorLeaderboardRange', () => {
    it.each(VALID_VALIDATOR_LEADERBOARD_RANGES)('accepts %s', (range) => {
      expect(parseValidatorLeaderboardRange(range)).toBe(range);
    });

    it.each([null, undefined, '', 'year', 'WEEK'])(
      'falls back to all-time for %p',
      (value) => {
        expect(parseValidatorLeaderboardRange(value)).toBe('all-time');
      },
    );
  });

  describe('getValidatorLeaderboardRange', () => {
    it('covers the last 7 days for week', () => {
      expect(getValidatorLeaderboardRange('week')).toEqual({
        start: NOW - 7 * DAY_MS,
        end: NOW,
      });
    });

    it('covers the last 30 days for month', () => {
      expect(getValidatorLeaderboardRange('month')).toEqual({
        start: NOW - 30 * DAY_MS,
        end: NOW,
      });
    });

    it('starts at the epoch for all-time', () => {
      expect(getValidatorLeaderboardRange('all-time')).toEqual({
        start: 0,
        end: NOW,
      });
    });

    it('returns a stable window for repeated calls at the same instant', () => {
      expect(getValidatorLeaderboardRange('week')).toEqual(
        getValidatorLeaderboardRange('week'),
      );
    });
  });
});
