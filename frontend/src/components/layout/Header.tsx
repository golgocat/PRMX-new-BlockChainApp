'use client';

import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Sun, Moon, ExternalLink, Clock, Key } from 'lucide-react';
import { useWalletStore } from '@/stores/walletStore';
import { useThemeStore } from '@/stores/themeStore';
import { AccountSelector } from '@/components/features/AccountSelector';
import { cn } from '@/lib/utils';
import { WS_ENDPOINT } from '@/lib/api';
import * as apiAdmin from '@/lib/api-admin';

/**
 * Generate Polkadot.js Apps URL for a specific block
 */
function getPolkadotJsBlockUrl(blockNumber: number): string {
  // Encode the WebSocket endpoint for URL parameter
  const encodedRpc = encodeURIComponent(WS_ENDPOINT);
  return `https://polkadot.js.org/apps/?rpc=${encodedRpc}#/explorer/query/${blockNumber}`;
}

interface KeyStatus {
  v1AccuweatherKey: boolean;  // V1 oracle AccuWeather key
  v3AccuweatherKey: boolean;  // V3 oracle AccuWeather key (SEPARATE from V1!)
  v3HmacSecret: boolean;      // V3 HMAC secret for Ingest API
  loading: boolean;
}

export function Header() {
  const { isChainConnected, currentBlock } = useWalletStore();
  const { theme, toggleTheme } = useThemeStore();
  const [utcTime, setUtcTime] = useState<string>('');
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({ 
    v1AccuweatherKey: false, 
    v3AccuweatherKey: false, 
    v3HmacSecret: false, 
    loading: true 
  });

  // Update UTC time every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const dateStr = now.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
      });
      setUtcTime(`${dateStr} ${timeStr}`);
    };
    
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Check oracle key status
  // NOTE: V1 and V3 have SEPARATE AccuWeather keys in different offchain storage locations!
  useEffect(() => {
    const checkKeys = async () => {
      try {
        const [v1Status, v3Status] = await Promise.allSettled([
          apiAdmin.checkV1OracleKey(),
          apiAdmin.checkV3OracleSecrets(),
        ]);
        
        setKeyStatus({
          v1AccuweatherKey: v1Status.status === 'fulfilled' ? v1Status.value.accuweatherConfigured : false,
          v3AccuweatherKey: v3Status.status === 'fulfilled' ? v3Status.value.accuweatherKey : false,
          v3HmacSecret: v3Status.status === 'fulfilled' ? v3Status.value.hmacSecret : false,
          loading: false,
        });
      } catch {
        setKeyStatus({ v1AccuweatherKey: false, v3AccuweatherKey: false, v3HmacSecret: false, loading: false });
      }
    };
    
    checkKeys();
    const interval = setInterval(checkKeys, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleBlockClick = () => {
    if (currentBlock > 0) {
      window.open(getPolkadotJsBlockUrl(currentBlock), '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <header className="fixed top-0 right-0 left-64 z-30 bg-background-primary/80 backdrop-blur-xl border-b border-border-secondary">
      <div className="flex items-center justify-end px-8 py-4">
        {/* Right Section */}
        <div className="flex items-center gap-4">
          {/* UTC Time Display */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-secondary/50 border border-border-primary">
            <Clock className="w-4 h-4 text-prmx-cyan dark:text-prmx-cyan text-sky-500" />
            <span className="text-sm font-mono text-text-secondary">
              {utcTime} <span className="text-sky-500 dark:text-prmx-cyan">UTC</span>
            </span>
          </div>

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
                <button
                  onClick={handleBlockClick}
                  className="flex items-center gap-1.5 text-sm text-success hover:text-success/80 transition-colors"
                  title="View block details in Polkadot.js Apps"
                >
                  <span>Block #{currentBlock}</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-error" />
                <span className="text-sm text-error">Disconnected</span>
              </>
            )}
          </div>

          {/* Oracle Keys Status - Minimal with hover expansion */}
          {/* Shows 3 dots: V1 AccuWeather, V3 AccuWeather, V3 HMAC */}
          {!keyStatus.loading && (
            <div className="group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background-secondary/50 border border-border-primary cursor-help">
              <Key className="w-3.5 h-3.5 text-text-tertiary" />
              <div className="flex items-center gap-1">
                <span 
                  className={cn(
                    'w-2 h-2 rounded-full',
                    keyStatus.v1AccuweatherKey ? 'bg-emerald-500' : 'bg-red-500'
                  )}
                  title="V1 AccuWeather"
                />
                <span 
                  className={cn(
                    'w-2 h-2 rounded-full',
                    keyStatus.v3AccuweatherKey ? 'bg-emerald-500' : 'bg-red-500'
                  )}
                  title="V3 AccuWeather"
                />
                <span 
                  className={cn(
                    'w-2 h-2 rounded-full',
                    keyStatus.v3HmacSecret ? 'bg-emerald-500' : 'bg-red-500'
                  )}
                  title="V3 HMAC"
                />
              </div>
              {/* Hover tooltip */}
              <div className="absolute top-full right-0 mt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="bg-background-primary border border-border-secondary rounded-lg shadow-xl p-3 min-w-[220px]">
                  <p className="text-xs font-medium text-text-secondary mb-2">Oracle Keys Status</p>
                  <div className="space-y-1.5">
                    {/* V1 AccuWeather */}
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        keyStatus.v1AccuweatherKey ? 'bg-emerald-500' : 'bg-red-500'
                      )} />
                      <span className="text-xs text-text-primary">V1 AccuWeather</span>
                      <span className={cn(
                        'text-xs ml-auto',
                        keyStatus.v1AccuweatherKey ? 'text-emerald-500' : 'text-red-500'
                      )}>
                        {keyStatus.v1AccuweatherKey ? 'OK' : 'Missing'}
                      </span>
                    </div>
                    {/* V3 AccuWeather */}
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        keyStatus.v3AccuweatherKey ? 'bg-emerald-500' : 'bg-red-500'
                      )} />
                      <span className="text-xs text-text-primary">V3 AccuWeather</span>
                      <span className={cn(
                        'text-xs ml-auto',
                        keyStatus.v3AccuweatherKey ? 'text-emerald-500' : 'text-red-500'
                      )}>
                        {keyStatus.v3AccuweatherKey ? 'OK' : 'Missing'}
                      </span>
                    </div>
                    {/* V3 HMAC Secret */}
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        keyStatus.v3HmacSecret ? 'bg-emerald-500' : 'bg-red-500'
                      )} />
                      <span className="text-xs text-text-primary">V3 HMAC Secret</span>
                      <span className={cn(
                        'text-xs ml-auto',
                        keyStatus.v3HmacSecret ? 'text-emerald-500' : 'text-red-500'
                      )}>
                        {keyStatus.v3HmacSecret ? 'OK' : 'Missing'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-2 pt-2 border-t border-border-secondary">
                    V1 and V3 use separate AccuWeather keys
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-10 h-10 rounded-lg border border-border-primary bg-background-secondary hover:bg-background-tertiary transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5 text-amber-400" />
            ) : (
              <Moon className="w-5 h-5 text-sky-600" />
            )}
          </button>

          {/* Account Selector */}
          <AccountSelector />
        </div>
      </div>
    </header>
  );
}
