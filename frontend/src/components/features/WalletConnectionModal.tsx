'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Wallet, Code, ExternalLink, AlertCircle, User, Shield } from 'lucide-react';
import { useWalletStore, TEST_ACCOUNTS, AccountKey } from '@/stores/walletStore';
import { cn, formatAddress } from '@/lib/utils';

interface WalletConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'choose' | 'dev-accounts' | 'polkadotjs-loading' | 'polkadotjs-error';

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

export function WalletConnectionModal({ isOpen, onClose }: WalletConnectionModalProps) {
  const { connectDevMode, connectPolkadotJs, isConnecting } = useWalletStore();
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll to top when step changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [step]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('choose');
      setError(null);
    }
  }, [isOpen]);

  // Don't render on server or if not open
  if (!isOpen || typeof document === 'undefined') return null;

  const handlePolkadotJs = async () => {
    setStep('polkadotjs-loading');
    setError(null);
    
    try {
      await connectPolkadotJs();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setStep('polkadotjs-error');
    }
  };

  const handleDevMode = () => {
    setStep('dev-accounts');
  };

  const handleSelectDevAccount = async (key: AccountKey) => {
    try {
      await connectDevMode(key);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  const handleBack = () => {
    setStep('choose');
    setError(null);
  };

  const handleClose = () => {
    setStep('choose');
    setError(null);
    onClose();
  };

  const modalContent = (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-[100] overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-4">
          <div 
            className="glass-card w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border-secondary">
              <h2 className="text-lg font-semibold">
                {step === 'choose' && 'Connect Wallet'}
                {step === 'dev-accounts' && 'Select Dev Account'}
                {step === 'polkadotjs-loading' && 'Connecting...'}
                {step === 'polkadotjs-error' && 'Connection Failed'}
              </h2>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-background-tertiary rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div ref={contentRef} className="p-4">
              {/* Step: Choose Connection Type */}
              {step === 'choose' && (
                <div className="space-y-3">
                  <p className="text-sm text-text-secondary mb-4">
                    Choose how you want to connect to PRMX
                  </p>
                  
                  {/* Polkadot.js Button */}
                  <button
                    onClick={handlePolkadotJs}
                    disabled={isConnecting}
                    className="w-full p-4 rounded-xl border-2 border-border-primary hover:border-prmx-cyan/50 bg-background-secondary hover:bg-background-tertiary transition-all text-left group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-prmx-cyan/20 flex items-center justify-center group-hover:bg-prmx-cyan/30 transition-colors">
                        <Wallet className="w-6 h-6 text-prmx-cyan" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">Polkadot.js Extension</p>
                        <p className="text-sm text-text-secondary">
                          Connect with your browser wallet
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Dev Mode Button */}
                  <button
                    onClick={handleDevMode}
                    disabled={isConnecting}
                    className="w-full p-4 rounded-xl border-2 border-border-primary hover:border-warning/50 bg-background-secondary hover:bg-background-tertiary transition-all text-left group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-warning/20 flex items-center justify-center group-hover:bg-warning/30 transition-colors">
                        <Code className="w-6 h-6 text-warning" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">Dev Mode</p>
                        <p className="text-sm text-text-secondary">
                          Use test accounts for development
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {/* Step: Select Dev Account */}
              {step === 'dev-accounts' && (
                <div className="space-y-3">
                  <button
                    onClick={handleBack}
                    className="text-sm text-text-secondary hover:text-text-primary"
                  >
                    ← Back to options
                  </button>
                  
                  <div className="space-y-2 mt-2">
                    {(Object.keys(TEST_ACCOUNTS) as AccountKey[]).map((key) => {
                      const account = TEST_ACCOUNTS[key];
                      const Icon = roleIcons[account.role];
                      
                      return (
                        <button
                          key={key}
                          onClick={() => handleSelectDevAccount(key)}
                          disabled={isConnecting}
                          className="w-full flex items-center gap-3 p-3 rounded-xl bg-background-secondary hover:bg-background-tertiary border border-border-primary hover:border-prmx-cyan/30 transition-all text-left"
                        >
                          <div className={cn(
                            'w-10 h-10 rounded-lg flex items-center justify-center',
                            roleColors[account.role].split(' ')[0]
                          )}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{account.name}</span>
                              <span className={cn(
                                'text-xs px-1.5 py-0.5 rounded border',
                                roleColors[account.role]
                              )}>
                                {account.role}
                              </span>
                            </div>
                            <p className="text-xs text-text-tertiary truncate">
                              {formatAddress(account.address, 8)}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm mt-3">
                      {error}
                    </div>
                  )}
                </div>
              )}

              {/* Step: Polkadot.js Loading */}
              {step === 'polkadotjs-loading' && (
                <div className="py-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-prmx-cyan/20 flex items-center justify-center animate-pulse">
                    <Wallet className="w-8 h-8 text-prmx-cyan" />
                  </div>
                  <p className="text-text-secondary">
                    Connecting to Polkadot.js extension...
                  </p>
                  <p className="text-sm text-text-tertiary mt-2">
                    Please approve the connection in your wallet
                  </p>
                </div>
              )}

              {/* Step: Polkadot.js Error */}
              {step === 'polkadotjs-error' && (
                <div className="py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-error/20 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-error" />
                  </div>
                  
                  <p className="text-center text-error font-medium mb-2">
                    Connection Failed
                  </p>
                  <p className="text-center text-sm text-text-secondary mb-4">
                    {error}
                  </p>

                  {error?.includes('No Polkadot.js extension') && (
                    <a
                      href="https://polkadot.js.org/extension/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full p-3 rounded-xl bg-prmx-cyan/10 border border-prmx-cyan/30 text-prmx-cyan hover:bg-prmx-cyan/20 transition-colors mb-4"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Install Polkadot.js Extension
                    </a>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleBack}
                      className="flex-1 p-3 rounded-xl bg-background-secondary border border-border-primary hover:bg-background-tertiary transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handlePolkadotJs}
                      className="flex-1 p-3 rounded-xl bg-prmx-cyan text-white hover:bg-prmx-cyan/90 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  // Use portal to render modal outside of parent DOM hierarchy
  return createPortal(modalContent, document.body);
}
