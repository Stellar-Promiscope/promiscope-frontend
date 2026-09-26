import { negotiateLocale } from '@/lib/negotiateLocale';

const SUPPORTED = ['en', 'fr', 'sw'];

describe('negotiateLocale', () => {
  it.each<[string, string | null | undefined, string]>([
    ['empty header', '', 'en'],
    ['null header', null, 'en'],
    ['undefined header', undefined, 'en'],
    ['simple exact match', 'fr', 'fr'],
    ['simple region match', 'fr-FR', 'fr'],
    ['uppercase tag', 'SW-KE', 'sw'],
    ['first supported entry wins', 'de-DE,de;q=0.9,fr;q=0.8,en;q=0.7', 'fr'],
    ['higher q wins over header order', 'en;q=0.5,sw;q=0.9', 'sw'],
    ['ties keep header order', 'sw;q=0.8,fr;q=0.8', 'sw'],
    ['en-KE then sw-KE picks en', 'en-KE,sw-KE;q=0.9', 'en'],
    ['sw-KE preferred over en-KE', 'en-KE;q=0.5,sw-KE', 'sw'],
    ['q=0 entries are dropped', 'fr;q=0,sw', 'sw'],
    ['wildcard falls back', '*', 'en'],
    ['low-q wildcard first does not win', '*;q=0.1,fr', 'fr'],
    ['q above 1 is clamped', 'sw;q=5,fr', 'sw'],
    ['malformed q is dropped', 'fr;q=abc,sw', 'sw'],
    ['malformed garbage falls back', ';;,,', 'en'],
    ['unsupported only falls back', 'de,ja;q=0.8', 'en'],
    ['whitespace is tolerated', '  de ; q=0.9 ,  fr ; q=0.8 ', 'fr'],
  ])('%s', (_name, header, expected) => {
    expect(negotiateLocale(header, SUPPORTED, 'en')).toBe(expected);
  });
});
