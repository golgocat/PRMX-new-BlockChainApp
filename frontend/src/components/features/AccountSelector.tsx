'use client';

import { useState } from 'react';
import { 
  ChevronDown, 
  User, 
  Shield, 
  Wallet, 
  UserCog,
  Check,
  RefreshCw
} from 'lucide-react';
import { 
  useWalletStore, 
  useFormattedBalance, 
  useAvailableAccounts,
  TEST_ACCOUNTS,
  AccountKey 
} from '@/stores/walletStore';
import { formatAddress } from '@/lib/utils';
import { cn } from '@/lib/utils';

const roleIcons: Record<string, typeof User> = {
  'DAO Admin': Shield,
  'Customer': User,
  'LP 1': Wallet,
  'LP 2': Wallet,
};

const roleColors: Record<string, string> = {
  'DAO Admin': 'bg-prmx-purple/20 text-prmx-purple-light border-prmx-purple/30',
  'Customer': 'bg-prmx-cyan/20 text-prmx-cyan border-prmx-cyan/30',
  'LP 1': 'bg-success/20 text-success border-success/30',
  'LP 2': 'bg-warning/20 text-warning border-warning/30',
};

export function AccountSelector() {
  const { 
    isConnected, 
    isConnecting, 
    selectedAccount, 
    selectedAccountKey,
    currentBlock,
    isChainConnected,
    connect, 
    selectAccount,
    refreshBalances
  } = useWalletStore();
  
  const { usdtFormatted } = useFormattedBalance();
  const accounts = useAvailableAccounts();
  
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleConnect = async () => {
    try {
      await connect('alice');
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  const handleSelectAccount = async (key: AccountKey) => {
    try {
      await selectAccount(key);
      setIsOpen(false);
    } catch (error) {
      console.error('Account selection failed:', error);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshBalances();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  if (!isConnected) {
    return (
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        className="btn-primary flex items-center gap-2"
      >
        {isConnecting ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Wallet className="w-4 h-4" />
            Connect
          </>
        )}
      </button>
    );
  }

  const RoleIcon = roleIcons[selectedAccount?.role || 'Customer'];

  return (
    <div className="relative">
      {/* Account Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-background-secondary border border-border-primary hover:border-prmx-cyan/30 transition-colors"
      >
        {/* Role Badge */}
        <div className={cn(
          'px-2 py-1 rounded-lg text-xs font-semibold border',
          roleColors[selectedAccount?.role || 'Customer']
        )}>
          <div className="flex items-center gap-1">
            <RoleIcon className="w-3 h-3" />
            {selectedAccount?.role}
          </div>
        </div>
        
        {/* Account Info */}
        <div className="text-left">
          <p className="text-sm font-medium">{selectedAccount?.name}</p>
          <p className="text-xs text-text-secondary">{formatAddress(selectedAccount?.address || '')}</p>
        </div>
        
        <ChevronDown className={cn('w-4 h-4 text-text-tertiary transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 glass-card z-50 overflow-hidden">
            {/* Current Account Header */}
            <div className="p-4 border-b border-border-secondary bg-background-tertiary/50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Current Account</span>
                <div className="flex items-center gap-2">
                  {isChainConnected && (
                    <div className="flex items-center gap-1 text-xs text-success">
                      <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                      Block #{currentBlock}
                    </div>
                  )}
                  <button
                    onClick={handleRefresh}
                    className="p-1 hover:bg-background-secondary rounded transition-colors"
                    title="Refresh balances"
                  >
                    <RefreshCw className={cn('w-4 h-4 text-text-tertiary', isRefreshing && 'animate-spin')} />
                  </button>
                </div>
              </div>
              
              {/* Balance */}
              <div className="p-2 rounded-lg bg-background-secondary">
                <p className="text-xs text-text-tertiary">USDT Balance</p>
                <p className="font-semibold text-prmx-cyan">{usdtFormatted}</p>
              </div>
            </div>

            {/* Account List */}
            <div className="p-2">
              <p className="px-2 py-1 text-xs font-semibold text-text-tertiary uppercase">
                Switch Account
              </p>
              <div className="space-y-1 mt-1">
                {accounts.map((account) => {
                  const Icon = roleIcons[account.role];
                  const isSelected = account.key === selectedAccountKey;
                  
                  return (
                    <button
                      key={account.key}
                      onClick={() => handleSelectAccount(account.key)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all',
                        isSelected 
                          ? 'bg-prmx-cyan/10 border border-prmx-cyan/30' 
                          : 'hover:bg-background-tertiary border border-transparent'
                      )}
                    >
                      <div className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center',
                        roleColors[account.role].replace('text-', 'bg-').split(' ')[0]
                      )}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{account.name}</span>
                          <span className={cn(
                            'text-xs px-1.5 py-0.5 rounded',
                            roleColors[account.role]
                          )}>
                            {account.role}
                          </span>
                        </div>
                        <p className="text-xs text-text-tertiary truncate">
                          {formatAddress(account.address, 8)}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {account.description}
                        </p>
                      </div>
                      {isSelected && (
                        <Check className="w-5 h-5 text-prmx-cyan flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-border-secondary">
              <p className="text-xs text-text-tertiary text-center">
                Using test accounts for development
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
