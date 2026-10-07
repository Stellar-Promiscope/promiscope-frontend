import {
  THEME_STORAGE_KEY,
  buildThemeBootstrapScript,
} from '@/lib/themeBootstrap';

function run(systemDark: boolean) {
  window.matchMedia = jest.fn().mockReturnValue({ matches: systemDark });
  new Function(buildThemeBootstrapScript())();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('buildThemeBootstrapScript', () => {
  it('uses the shared storage key', () => {
    expect(THEME_STORAGE_KEY).toBe('promiscope_theme_preference');
    expect(buildThemeBootstrapScript()).toContain(
      JSON.stringify(THEME_STORAGE_KEY),
    );
  });

  it('applies dark when the stored preference is dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not apply dark when the stored preference is light', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('falls back to the system preference when nothing is stored', () => {
    run(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    document.documentElement.classList.remove('dark');
    run(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
