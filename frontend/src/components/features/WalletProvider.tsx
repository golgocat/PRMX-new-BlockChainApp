'use client';

import { useEffect, useState } from 'react';
import { useWalletStore, AccountKey } from '@/stores/walletStore';
import { getApi, subscribeToBlocks } from '@/lib/api';
import { LogoAnimated } from '@/components/ui/Logo';

interface WalletProviderProps {
  children: React.ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const { 
    selectedAccountKey, 
    isConnected, 
    connect, 
    setChainConnected,
    setCurrentBlock 
  } = useWalletStore();
  
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initialize = async () => {
      try {
        const api = await getApi();
        setChainConnected(true);
        
        unsubscribe = await subscribeToBlocks((block) => {
          setCurrentBlock(block);
        });

        const savedState = localStorage.getItem('prmx-wallet-storage');
        if (savedState) {
          try {
            const parsed = JSON.parse(savedState);
            if (parsed?.state?.selectedAccountKey) {
              await connect(parsed.state.selectedAccountKey as AccountKey);
            }
          } catch {}
        }

        setIsInitializing(false);

      } catch (error) {
        console.error('Failed to initialize:', error);
        setInitError(error instanceof Error ? error.message : 'Failed to connect to blockchain');
        setChainConnected(false);
        setIsInitializing(false);
      }
    };

    initialize();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      useWalletStore.getState().refreshBalances();
    }, 10000);
    return () => clearInterval(interval);
  }, [isConnected]);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-background-primary flex items-center justify-center">
        <div className="text-center">
          <LogoAnimated size="xl" className="mx-auto mb-6" />
          <h2 className="text-xl font-semibold mb-2">Connecting to PRMX Chain</h2>
          <p className="text-text-secondary">Please wait...</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="min-h-screen bg-background-primary flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-error/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Connection Failed</h2>
          <p className="text-text-secondary mb-4">{initError}</p>
          <div className="p-4 rounded-xl bg-background-secondary text-left mb-6">
            <p className="text-sm text-text-secondary mb-2">Make sure the PRMX node is running:</p>
            <code className="text-xs text-prmx-cyan block">
              cd PRMX-new-BlockChainApp<br />
              ./target/release/prmx-node --dev --tmp
            </code>
          </div>
          <button onClick={() => window.location.reload()} className="btn-primary">
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
