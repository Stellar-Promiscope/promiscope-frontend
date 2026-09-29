import {
  buildScoutContactsCsv,
  SCOUT_CONTACTS_CSV_HEADERS,
} from '@/lib/scoutContactsCsv';

const header = SCOUT_CONTACTS_CSV_HEADERS.join(',');

describe('buildScoutContactsCsv', () => {
  it('returns only the header row for zero contacts', () => {
    expect(buildScoutContactsCsv([])).toBe(header);
  });

  it('builds a single row', () => {
    const csv = buildScoutContactsCsv([
      {
        playerId: 'p1',
        name: 'Amara Diallo',
        position: 'Forward',
        region: 'Dakar',
        progressLevel: 2,
        unlockedAt: 1_700_000_000,
      },
    ]);
    expect(csv).toBe(
      `${header}\r\nAmara Diallo,Forward,Dakar,Performance Milestones,2023-11-14`,
    );
  });

  it('builds many rows and escapes commas and quotes', () => {
    const csv = buildScoutContactsCsv([
      { playerId: 'p1', name: 'Doe, "JJ"', unlockedAt: 1_700_000_000_000 },
      { playerId: 'p2' },
      { playerId: 'p3', name: 'C', progressLevel: 0 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('"Doe, ""JJ""",,,,2023-11-14');
    expect(lines[2]).toBe('p2,,,,');
    expect(lines[3]).toBe('C,,,Unverified,');
  });
});
