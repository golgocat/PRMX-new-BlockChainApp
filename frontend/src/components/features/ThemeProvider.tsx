'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useThemeStore, applyTheme } from '@/stores/themeStore';

// Use useLayoutEffect on client, useEffect on server
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((state) => state.theme);

  // Apply theme immediately on mount and when theme changes
  useIsomorphicLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <>{children}</>;
}
