'use client';

import { useState } from 'react';
import { 
  ChevronDown, 
  User, 
  Shield, 
  Wallet, 
  Check,
  RefreshCw,
  LogOut
} from 'lucide-react';
import { 
  useWalletStore, 
  useFormattedBalance, 
  useAvailableAccounts,
  AccountKey 
} from '@/stores/walletStore';
import { formatAddress } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { WalletConnectionModal } from './WalletConnectionModal';

const roleIcons: Record<string, typeof User> = {
  'DAO Admin': Shield,
  'Customer': User,
  'LP 1': Wallet,
  'LP 2': Wallet,
  'Polkadot.js': Wallet,
};

const roleColors: Record<string, string> = {
  'DAO Admin': 'bg-prmx-purple/20 text-prmx-purple-light border-prmx-purple/30',
  'Customer': 'bg-prmx-cyan/20 text-prmx-cyan border-prmx-cyan/30',
  'LP 1': 'bg-success/20 text-success border-success/30',
  'LP 2': 'bg-warning/20 text-warning border-warning/30',
  'Polkadot.js': 'bg-prmx-magenta/20 text-prmx-magenta border-prmx-magenta/30',
};

export function AccountSelector() {
  const { 
    isConnected, 
    isConnecting, 
    selectedAccount, 
    selectedAccountKey,
    walletMode,
    extensionAccounts,
    selectedExtensionAccount,
    currentBlock,
    isChainConnected,
    selectAccount,
    selectExtensionAccount,
    disconnect,
    refreshBalances
  } = useWalletStore();
  
  const { usdtFormatted } = useFormattedBalance();
  const accounts = useAvailableAccounts();
  
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleSelectAccount = async (key: AccountKey) => {
    try {
      await selectAccount(key);
      setIsOpen(false);
    } catch (error) {
      console.error('Account selection failed:', error);
    }
  };

  const handleSelectExtensionAccount = async (account: typeof extensionAccounts[0]) => {
    try {
      await selectExtensionAccount(account);
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

  const handleDisconnect = () => {
    disconnect();
    setIsOpen(false);
  };

  // Not connected - show connect button
  if (!isConnected) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
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
        <WalletConnectionModal 
          isOpen={showModal} 
          onClose={() => setShowModal(false)} 
        />
      </>
    );
  }

  const RoleIcon = roleIcons[selectedAccount?.role || 'Customer'] || User;

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
          roleColors[selectedAccount?.role || 'Customer'] || roleColors['Customer']
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
          <div className="absolute top-full right-0 mt-2 w-80 glass-card z-50 shadow-xl max-h-[calc(100vh-120px)] flex flex-col">
            {/* Current Account Header - Fixed */}
            <div className="p-4 border-b border-border-secondary bg-background-tertiary/50 flex-shrink-0">
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

            {/* Scrollable Account List */}
            <div className="flex-1 overflow-y-auto">
              {/* Dev Mode - Account List */}
              {walletMode === 'dev' && (
                <div className="p-2">
                  <p className="px-2 py-1 text-xs font-semibold text-text-tertiary uppercase">
                    Switch Account
                  </p>
                  <div className="space-y-1 mt-1">
                    {accounts.map((account) => {
                      const Icon = roleIcons[account.role] || User;
                      const isSelected = account.key === selectedAccountKey;
                      
                      return (
                        <button
                          key={account.key}
                          onClick={() => handleSelectAccount(account.key!)}
                          className={cn(
                            'w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all',
                            isSelected 
                              ? 'bg-prmx-cyan/10 border border-prmx-cyan/30' 
                              : 'hover:bg-background-tertiary border border-transparent'
                          )}
                        >
                          <div className={cn(
                            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                            (roleColors[account.role] || roleColors['Customer']).split(' ')[0]
                          )}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{account.name}</span>
                              <span className={cn(
                                'text-xs px-1.5 py-0.5 rounded',
                                roleColors[account.role] || roleColors['Customer']
                              )}>
                                {account.role}
                              </span>
                            </div>
                            <p className="text-xs text-text-tertiary truncate">
                              {formatAddress(account.address, 8)}
                            </p>
                          </div>
                          {isSelected && (
                            <Check className="w-4 h-4 text-prmx-cyan flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Polkadot.js Mode - Extension Account List */}
              {walletMode === 'polkadotjs' && extensionAccounts.length > 1 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-xs font-semibold text-text-tertiary uppercase">
                    Switch Account
                  </p>
                  <div className="space-y-1 mt-1">
                    {extensionAccounts.map((account, index) => {
                      const isSelected = account.address === selectedExtensionAccount?.address;
                      
                      return (
                        <button
                          key={account.address}
                          onClick={() => handleSelectExtensionAccount(account)}
                          className={cn(
                            'w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all',
                            isSelected 
                              ? 'bg-prmx-cyan/10 border border-prmx-cyan/30' 
                              : 'hover:bg-background-tertiary border border-transparent'
                          )}
                        >
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-prmx-magenta/20 flex-shrink-0">
                            <Wallet className="w-4 h-4 text-prmx-magenta" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm block">{account.meta.name || `Account ${index + 1}`}</span>
                            <p className="text-xs text-text-tertiary truncate">
                              {formatAddress(account.address, 8)}
                            </p>
                          </div>
                          {isSelected && (
                            <Check className="w-4 h-4 text-prmx-cyan flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer with Disconnect - Fixed */}
            <div className="p-3 border-t border-border-secondary flex-shrink-0 bg-background-card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-tertiary">
                  {walletMode === 'dev' ? 'Dev Mode' : 'Polkadot.js'}
                </p>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-error hover:bg-error/10 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
