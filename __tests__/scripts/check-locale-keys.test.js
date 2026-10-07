/**
 * Unit tests for scripts/check-locale-keys.js
 *
 * Exercises flattenKeys in isolation and the overall mismatch-detection logic
 * against small fixture objects, so CI failure paths can be asserted without
 * touching the real messages/*.json files.
 *
 * The script's CLI entry-point is guarded by `require.main === module`, so
 * requiring the module here only exposes the exported function without
 * triggering any filesystem reads or process.exit calls.
 */

const { flattenKeys } = require('../../scripts/check-locale-keys');

// ── Helper: run the comparison logic extracted from the script ────────────────
// Mirrors the keysByLocale / allKeys / hasMismatch block from the CLI entry
// point so we can test mismatch detection without importing side-effecting code.

/**
 * Given a plain object whose values are locale JSON objects, returns the array
 * of console.error strings that the script would print (without calling
 * process.exit). An empty array means all locales are in sync.
 *
 * @param {Record<string, Record<string, unknown>>} locales
 * @returns {string[]} Error messages for any mismatched keys.
 */
function detectMismatches(locales) {
  const keysByLocale = {};
  for (const [locale, content] of Object.entries(locales)) {
    keysByLocale[locale] = new Set(flattenKeys(content));
  }

  const allKeys = new Set(
    Object.values(keysByLocale).flatMap((set) => [...set]),
  );

  const errors = [];
  for (const key of allKeys) {
    const missingIn = Object.entries(keysByLocale)
      .filter(([, keys]) => !keys.has(key))
      .map(([locale]) => locale);

    if (missingIn.length > 0) {
      errors.push(`Missing key "${key}" in locale(s): ${missingIn.join(', ')}`);
    }
  }
  return errors;
}

// ── flattenKeys ───────────────────────────────────────────────────────────────

describe('flattenKeys', () => {
  it('returns a single key for a flat object', () => {
    const result = flattenKeys({ title: 'Promiscope' });
    expect(result).toEqual(['title']);
  });

  it('joins nested keys with dots', () => {
    const result = flattenKeys({ nav: { home: 'Home', about: 'About' } });
    expect(result).toEqual(['nav.home', 'nav.about']);
  });

  it('flattens deeply nested objects', () => {
    const result = flattenKeys({
      a: { b: { c: 'deep' } },
    });
    expect(result).toEqual(['a.b.c']);
  });

  it('handles mixed shallow and deep keys in the same object', () => {
    const result = flattenKeys({
      title: 'App',
      nav: { home: 'Home' },
      footer: { links: { privacy: 'Privacy', terms: 'Terms' } },
    });
    expect(result).toEqual([
      'title',
      'nav.home',
      'footer.links.privacy',
      'footer.links.terms',
    ]);
  });

  it('treats array-valued leaves as leaf nodes and does NOT recurse into them', () => {
    // Arrays should produce a single path entry — the array itself is the
    // "value", not its elements, so ["a", "b"] is not recursed into.
    const result = flattenKeys({ items: ['a', 'b', 'c'] });
    expect(result).toEqual(['items']);
  });

  it('does not recurse into arrays even when they contain objects', () => {
    const result = flattenKeys({
      list: [{ key: 'value' }, { key: 'other' }],
    });
    // The whole array is a leaf — its inner object keys are not walked.
    expect(result).toEqual(['list']);
  });

  it('treats null as a leaf (does not throw or recurse)', () => {
    // null passes `typeof value === 'object'` but fails the truthiness check,
    // so it should be emitted as a leaf path.
    const result = flattenKeys({ missing: null });
    expect(result).toEqual(['missing']);
  });

  it('treats numeric values as leaf nodes', () => {
    const result = flattenKeys({ count: 42 });
    expect(result).toEqual(['count']);
  });

  it('treats boolean values as leaf nodes', () => {
    const result = flattenKeys({ enabled: true });
    expect(result).toEqual(['enabled']);
  });

  it('returns an empty array for an empty object', () => {
    expect(flattenKeys({})).toEqual([]);
  });

  it('uses the prefix argument to prepend a parent key path', () => {
    // The prefix parameter is used during recursion — calling it directly
    // with a prefix mirrors how the recursive call works internally.
    const result = flattenKeys({ home: 'Home' }, 'nav');
    expect(result).toEqual(['nav.home']);
  });
});

// ── Mismatch detection ────────────────────────────────────────────────────────

describe('mismatch detection', () => {
  it('reports no errors when all locales have identical key sets', () => {
    const locales = {
      en: { title: 'Promiscope', nav: { home: 'Home' } },
      fr: { title: 'Promiscope FR', nav: { home: 'Accueil' } },
      sw: { title: 'Promiscope SW', nav: { home: 'Nyumbani' } },
    };
    expect(detectMismatches(locales)).toEqual([]);
  });

  it('reports a missing top-level key when one locale is missing it', () => {
    const locales = {
      en: { title: 'Promiscope', footer: 'Footer text' },
      fr: { title: 'Promiscope FR' }, // missing 'footer'
    };
    const errors = detectMismatches(locales);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"footer"');
    expect(errors[0]).toContain('fr');
  });

  it('reports a missing nested key when one locale lacks a deeper path', () => {
    const locales = {
      en: { nav: { home: 'Home', about: 'About' } },
      fr: { nav: { home: 'Accueil' } }, // missing 'nav.about'
    };
    const errors = detectMismatches(locales);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"nav.about"');
    expect(errors[0]).toContain('fr');
  });

  it('reports multiple missing keys across multiple locales independently', () => {
    const locales = {
      en: { a: '1', b: '2', c: '3' },
      fr: { a: '1' }, // missing b, c
      sw: { a: '1', b: '2' }, // missing c
    };
    const errors = detectMismatches(locales);
    // Should have an error for 'b' (missing in fr) and 'c' (missing in fr + sw).
    expect(errors.length).toBeGreaterThanOrEqual(2);

    const bError = errors.find((e) => e.includes('"b"'));
    expect(bError).toBeDefined();
    expect(bError).toContain('fr');

    const cError = errors.find((e) => e.includes('"c"'));
    expect(cError).toBeDefined();
    expect(cError).toMatch(/fr|sw/);
  });

  it('does not report an error for array-valued keys when all locales have the same array key', () => {
    // Arrays are leaf nodes — as long as all locales define the key, no
    // mismatch is reported regardless of the array's contents.
    const locales = {
      en: { items: ['one', 'two'] },
      fr: { items: ['un', 'deux'] },
    };
    expect(detectMismatches(locales)).toEqual([]);
  });

  it('reports an error when an array-valued key is missing from one locale', () => {
    const locales = {
      en: { title: 'App', items: ['a', 'b'] },
      fr: { title: 'App FR' }, // missing 'items' entirely
    };
    const errors = detectMismatches(locales);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"items"');
    expect(errors[0]).toContain('fr');
  });

  it('passes with a single locale (nothing to compare against)', () => {
    // A single locale can never have a mismatch with itself.
    const locales = { en: { title: 'Promiscope' } };
    expect(detectMismatches(locales)).toEqual([]);
  });

  it('handles deeply nested missing keys', () => {
    const locales = {
      en: { errors: { network: { timeout: 'Timed out' } } },
      fr: { errors: { network: {} } }, // missing errors.network.timeout
    };
    const errors = detectMismatches(locales);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"errors.network.timeout"');
    expect(errors[0]).toContain('fr');
  });
});
