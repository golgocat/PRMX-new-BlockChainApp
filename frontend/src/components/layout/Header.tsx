'use client';

import { Search, Wifi, WifiOff } from 'lucide-react';
import { useWalletStore } from '@/stores/walletStore';
import { AccountSelector } from '@/components/features/AccountSelector';
import { cn } from '@/lib/utils';

export function Header() {
  const { isChainConnected, currentBlock } = useWalletStore();

  return (
    <header className="fixed top-0 right-0 left-64 z-30 bg-background-primary/80 backdrop-blur-xl border-b border-border-secondary">
      <div className="flex items-center justify-between px-8 py-4">
        {/* Search */}
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search markets, policies, transactions..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-background-secondary border border-border-primary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-prmx-cyan/50 focus:ring-2 focus:ring-prmx-cyan/20 transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs text-text-tertiary bg-background-tertiary rounded">
            ⌘K
          </kbd>
        </div>

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

          {/* Account Selector */}
          <AccountSelector />
        </div>
      </div>
    </header>
  );
}
