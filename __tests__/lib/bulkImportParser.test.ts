import {
  parseBulkImportFile,
  detectFormat,
  MAX_BULK_IMPORT_ROWS,
} from '@/lib/bulkImportParser';

describe('detectFormat', () => {
  it('detects .json by extension', () => {
    expect(detectFormat('players.json', '[]')).toBe('json');
  });

  it('detects .csv by extension', () => {
    expect(detectFormat('players.csv', 'name,age')).toBe('csv');
  });

  it('falls back to content sniffing for an ambiguous extension', () => {
    expect(detectFormat('players.txt', '[{"name":"A"}]')).toBe('json');
    expect(detectFormat('players.txt', 'name,age\nA,20')).toBe('csv');
  });
});

describe('parseBulkImportFile — CSV', () => {
  const validCsv = [
    'name,age,nationality,region,position,bio',
    'John Doe,22,Nigerian,nigeria,ST,Fast striker',
    'Jane Smith,19,Kenyan,kenya,GK,',
  ].join('\n');

  it('parses all valid rows with no errors', () => {
    const result = parseBulkImportFile(validCsv, 'csv');
    expect(result.fileError).toBeNull();
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.isValid)).toBe(true);

    expect(result.rows[0].valid).toEqual({
      name: 'John Doe',
      age: 22,
      nationality: 'Nigerian',
      region: 'nigeria',
      position: 'ST',
      bio: 'Fast striker',
    });
    expect(result.rows[1].rowNumber).toBe(2);
  });

  it('accepts region/position given as their display label, case-insensitively', () => {
    const csv = [
      'name,age,nationality,region,position',
      'Ama Owusu,21,Ghanaian,GHANA,goalkeeper',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].isValid).toBe(true);
    expect(result.rows[0].valid?.region).toBe('ghana');
    expect(result.rows[0].valid?.position).toBe('GK');
  });

  it('handles quoted fields with embedded commas', () => {
    const csv = [
      'name,age,nationality,region,position,bio',
      '"Doe, John",22,Nigerian,nigeria,ST,"Plays well, scores often"',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].isValid).toBe(true);
    expect(result.rows[0].valid?.name).toBe('Doe, John');
    expect(result.rows[0].valid?.bio).toBe('Plays well, scores often');
  });

  it('flags a row missing required fields with per-field errors', () => {
    const csv = [
      'name,age,nationality,region,position',
      ',22,Nigerian,nigeria,ST',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].isValid).toBe(false);
    expect(result.rows[0].errors).toContainEqual({
      field: 'name',
      code: 'REQUIRED',
      row: 1,
    });
  });

  it('flags an invalid position value with a clear per-row message', () => {
    const csv = [
      'name,age,nationality,region,position',
      'John Doe,22,Nigerian,nigeria,QUARTERBACK',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].isValid).toBe(false);
    expect(result.rows[0].errors).toContainEqual({
      field: 'position',
      code: 'INVALID_POSITION',
      row: 1,
      params: { value: 'QUARTERBACK' },
    });
  });

  it('flags an invalid region value', () => {
    const csv = [
      'name,age,nationality,region,position',
      'John Doe,22,Nigerian,narnia,ST',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].isValid).toBe(false);
    expect(result.rows[0].errors).toContainEqual({
      field: 'region',
      code: 'INVALID_REGION',
      row: 1,
      params: { value: 'narnia' },
    });
  });

  it('flags age outside the sane 14–45 range', () => {
    const csv = [
      'name,age,nationality,region,position',
      'John Doe,5,Nigerian,nigeria,ST',
      'Old Timer,90,Nigerian,nigeria,ST',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].errors).toContainEqual({
      field: 'age',
      code: 'INVALID_AGE',
      row: 1,
      params: { value: '5', min: 14, max: 45 },
    });
    expect(result.rows[1].errors).toContainEqual({
      field: 'age',
      code: 'INVALID_AGE',
      row: 2,
      params: { value: '90', min: 14, max: 45 },
    });
  });

  it('flags a non-numeric age', () => {
    const csv = [
      'name,age,nationality,region,position',
      'John Doe,twenty,Nigerian,nigeria,ST',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].isValid).toBe(false);
    expect(result.rows[0].errors.some((e) => e.field === 'age')).toBe(true);
  });

  it('sanitizes HTML out of free-text fields like name and bio', () => {
    const csv = [
      'name,age,nationality,region,position,bio',
      '<b>John</b>,22,Nigerian,nigeria,ST,<script>alert(1)</script>Great player',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].valid?.name).toBe('John');
    expect(result.rows[0].valid?.bio).not.toContain('<script>');
  });

  it('does not fail the whole batch when one row is invalid — collects per-row results', () => {
    const csv = [
      'name,age,nationality,region,position',
      'Valid One,22,Nigerian,nigeria,ST',
      ',22,Nigerian,nigeria,ST',
      'Valid Two,25,Kenyan,kenya,GK',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.fileError).toBeNull();
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].isValid).toBe(true);
    expect(result.rows[1].isValid).toBe(false);
    expect(result.rows[2].isValid).toBe(true);
  });

  it('returns a fileError for a CSV with only a header row', () => {
    const result = parseBulkImportFile(
      'name,age,nationality,region,position',
      'csv',
    );
    expect(result.fileError).toEqual({ code: 'EMPTY_CSV' });
    expect(result.rows).toHaveLength(0);
  });

  it('returns a fileError when the row count exceeds the batch limit', () => {
    const header = 'name,age,nationality,region,position';
    const row = 'John Doe,22,Nigerian,nigeria,ST';
    const csv = [header, ...Array(MAX_BULK_IMPORT_ROWS + 1).fill(row)].join(
      '\n',
    );
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.fileError?.code).toBe('TOO_MANY_ROWS');
    expect(result.rows).toHaveLength(0);
  });

  it('matches columns by header name regardless of column order', () => {
    const csv = [
      'position,name,region,age,nationality',
      'ST,John Doe,nigeria,22,Nigerian',
    ].join('\n');
    const result = parseBulkImportFile(csv, 'csv');
    expect(result.rows[0].isValid).toBe(true);
    expect(result.rows[0].valid?.name).toBe('John Doe');
    expect(result.rows[0].valid?.position).toBe('ST');
  });
});

describe('parseBulkImportFile — JSON', () => {
  it('parses a valid JSON array of players', () => {
    const json = JSON.stringify([
      {
        name: 'John Doe',
        age: 22,
        nationality: 'Nigerian',
        region: 'nigeria',
        position: 'ST',
        bio: 'Fast striker',
      },
      {
        name: 'Jane Smith',
        age: 19,
        nationality: 'Kenyan',
        region: 'kenya',
        position: 'GK',
      },
    ]);
    const result = parseBulkImportFile(json, 'json');
    expect(result.fileError).toBeNull();
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.isValid)).toBe(true);
  });

  it('accepts numeric age values (not just strings)', () => {
    const json = JSON.stringify([
      {
        name: 'John Doe',
        age: 22,
        nationality: 'Nigerian',
        region: 'nigeria',
        position: 'ST',
      },
    ]);
    const result = parseBulkImportFile(json, 'json');
    expect(result.rows[0].valid?.age).toBe(22);
  });

  it('returns a fileError for malformed JSON', () => {
    const result = parseBulkImportFile('{not valid json', 'json');
    expect(result.fileError).toEqual({ code: 'INVALID_JSON' });
    expect(result.rows).toHaveLength(0);
  });

  it('returns a fileError when the JSON root is not an array', () => {
    const result = parseBulkImportFile('{"name":"John"}', 'json');
    expect(result.fileError).toEqual({ code: 'JSON_NOT_ARRAY' });
  });

  it('returns a fileError for an empty JSON array', () => {
    const result = parseBulkImportFile('[]', 'json');
    expect(result.fileError).toEqual({ code: 'EMPTY_JSON' });
  });

  it('flags invalid rows in JSON input just like CSV', () => {
    const json = JSON.stringify([
      {
        name: 'John Doe',
        age: 22,
        nationality: 'Nigerian',
        region: 'nigeria',
        position: 'ST',
      },
      {
        name: '',
        age: 22,
        nationality: 'Nigerian',
        region: 'nigeria',
        position: 'ST',
      },
    ]);
    const result = parseBulkImportFile(json, 'json');
    expect(result.rows[0].isValid).toBe(true);
    expect(result.rows[1].isValid).toBe(false);
    expect(result.rows[1].errors).toContainEqual({
      field: 'name',
      code: 'REQUIRED',
      row: 2,
    });
  });
});
