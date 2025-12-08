'use client';

import { useState, useEffect } from 'react';
import { Bell, Search, Wifi, WifiOff } from 'lucide-react';
import { useWalletStore } from '@/stores/walletStore';
import { AccountSelector } from '@/components/features/AccountSelector';
import { cn } from '@/lib/utils';

export function Header() {
  const { isChainConnected, currentBlock } = useWalletStore();
  const [showNotifications, setShowNotifications] = useState(false);

  const notifications = [
    { id: 1, title: 'Policy Settled', message: 'Your Manila policy has been settled', time: '5m ago', unread: true },
    { id: 2, title: 'Quote Ready', message: 'Your quote for Cebu coverage is ready', time: '1h ago', unread: true },
    { id: 3, title: 'LP Tokens Sold', message: '10 LP tokens sold for 500 USDT', time: '2h ago', unread: false },
  ];

  const unreadCount = notifications.filter(n => n.unread).length;

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

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2.5 rounded-xl bg-background-secondary border border-border-primary hover:border-prmx-cyan/30 transition-colors"
            >
              <Bell className="w-5 h-5 text-text-secondary" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-xs font-bold text-white bg-prmx-purple rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                <div className="absolute right-0 mt-2 w-80 glass-card p-2 z-50">
                  <div className="px-3 py-2 border-b border-border-secondary">
                    <h3 className="font-semibold">Notifications</h3>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={cn(
                          'px-3 py-3 hover:bg-background-tertiary rounded-lg cursor-pointer transition-colors',
                          notification.unread && 'bg-prmx-cyan/5'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {notification.unread && (
                            <div className="w-2 h-2 mt-2 rounded-full bg-prmx-cyan flex-shrink-0" />
                          )}
                          <div className={cn(!notification.unread && 'ml-5')}>
                            <p className="font-medium text-sm">{notification.title}</p>
                            <p className="text-xs text-text-secondary mt-0.5">{notification.message}</p>
                            <p className="text-xs text-text-tertiary mt-1">{notification.time}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-3 py-2 border-t border-border-secondary">
                    <button className="text-sm text-prmx-cyan hover:text-prmx-cyan-light transition-colors">
                      View all notifications
                    </button>
                  </div>
                </div>
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
