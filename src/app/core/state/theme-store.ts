import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'modexa3d-theme';

@Injectable({ providedIn: 'root' })
export class ThemeStore {
  readonly theme = signal<Theme>(this.initialTheme());

  constructor() {
    // Apply right away so the page doesn't flash the wrong colors
    document.documentElement.dataset['theme'] = this.theme();

    effect(() => {
      const theme = this.theme();
      document.documentElement.dataset['theme'] = theme;
      document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute('content', theme === 'dark' ? '#0e0c0b' : '#f6f1ea');
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // storage can be blocked (private mode), the theme still works
      }
    });
  }

  toggle(): void {
    this.theme.update((theme) => (theme === 'dark' ? 'light' : 'dark'));
  }

  private initialTheme(): Theme {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
}