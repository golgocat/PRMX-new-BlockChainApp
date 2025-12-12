'use client';

import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// Apply theme to document - exported for use in ThemeProvider
export function applyTheme(theme: Theme) {
  if (typeof window !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    // Also save to localStorage for persistence
    try {
      localStorage.setItem('prmx-theme', JSON.stringify({ state: { theme } }));
    } catch (e) {
      // Ignore localStorage errors
    }
  }
}

// Get initial theme from localStorage or default to dark
function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('prmx-theme');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.state?.theme || 'dark';
      }
    } catch (e) {
      // Ignore
    }
  }
  return 'dark';
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark', // Default, will be updated on client
  setTheme: (theme: Theme) => {
    set({ theme });
    applyTheme(theme);
  },
  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme: newTheme });
    applyTheme(newTheme);
  },
}));

// Initialize theme on client side
if (typeof window !== 'undefined') {
  const initialTheme = getInitialTheme();
  useThemeStore.setState({ theme: initialTheme });
  applyTheme(initialTheme);
}
