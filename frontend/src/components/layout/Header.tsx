'use client';

import { Wifi, WifiOff, Sun, Moon } from 'lucide-react';
import { useWalletStore } from '@/stores/walletStore';
import { useThemeStore } from '@/stores/themeStore';
import { AccountSelector } from '@/components/features/AccountSelector';
import { cn } from '@/lib/utils';

export function Header() {
  const { isChainConnected, currentBlock } = useWalletStore();
  const { theme, toggleTheme } = useThemeStore();

  return (
    <header className="fixed top-0 right-0 left-64 z-30 bg-background-primary/80 backdrop-blur-xl border-b border-border-secondary">
      <div className="flex items-center justify-end px-8 py-4">
        {/* Right Section */}
        <div className="flex items-center gap-4">
          {/* Chain Status Indicator */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg border',
            isChainConnected 
              ? 'bg-success/10 border-success/30' 
              : 'bg-error/10 border-error/30'
          )}>
            {isChainConnected ? (
              <>
                <Wifi className="w-4 h-4 text-success" />
                <span className="text-sm text-success">Block #{currentBlock}</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-error" />
                <span className="text-sm text-error">Disconnected</span>
              </>
            )}
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-10 h-10 rounded-lg border border-border-primary bg-background-secondary hover:bg-background-tertiary transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5 text-prmx-gold" />
            ) : (
              <Moon className="w-5 h-5 text-prmx-purple" />
            )}
          </button>

          {/* Account Selector */}
          <AccountSelector />
        </div>
      </div>
    </header>
  );
}
