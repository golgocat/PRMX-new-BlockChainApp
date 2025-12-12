import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KeyringPair } from '@polkadot/keyring/types';
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types';
import { 
  TEST_ACCOUNTS, 
  AccountKey, 
  getApi, 
  getKeypair, 
  getPrmxBalance, 
  getUsdtBalance,
  disconnect as disconnectApi
} from '@/lib/api';

export type { AccountKey };
export { TEST_ACCOUNTS };

export type WalletMode = 'polkadotjs' | 'dev' | null;

interface AccountInfo {
  key?: AccountKey;
  name: string;
  role: string;
  address: string;
  description: string;
  source?: string;
}

interface WalletState {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  walletMode: WalletMode;
  // Dev mode state
  selectedAccountKey: AccountKey | null;
  selectedAccount: AccountInfo | null;
  keypair: KeyringPair | null;
  // Polkadot.js state
  extensionAccounts: InjectedAccountWithMeta[];
  selectedExtensionAccount: InjectedAccountWithMeta | null;
  // Common state
  prmxBalance: bigint;
  usdtBalance: bigint;
  currentBlock: number;
  isChainConnected: boolean;
}

interface WalletActions {
  connectDevMode: (accountKey?: AccountKey) => Promise<void>;
  connectPolkadotJs: () => Promise<void>;
  selectExtensionAccount: (account: InjectedAccountWithMeta) => Promise<void>;
  disconnect: () => void;
  selectAccount: (accountKey: AccountKey) => Promise<void>;
  refreshBalances: () => Promise<void>;
  setCurrentBlock: (block: number) => void;
  setChainConnected: (connected: boolean) => void;
  getKeypair: () => KeyringPair | null;
}

type WalletStore = WalletState & WalletActions;

function getAccountInfo(key: AccountKey): AccountInfo {
  const account = TEST_ACCOUNTS[key];
  return {
    key,
    name: account.name,
    role: account.role,
    address: account.address,
    description: account.description,
  };
}

export const useWalletStore = create<WalletStore>()(
  persist(
    (set, get) => ({
      isConnected: false,
      isConnecting: false,
      connectionError: null,
      walletMode: null,
      selectedAccountKey: null,
      selectedAccount: null,
      keypair: null,
      extensionAccounts: [],
      selectedExtensionAccount: null,
      prmxBalance: BigInt(0),
      usdtBalance: BigInt(0),
      currentBlock: 0,
      isChainConnected: false,

      connectDevMode: async (accountKey: AccountKey = 'alice') => {
        set({ isConnecting: true, connectionError: null });

        try {
          await getApi();
          const keypair = getKeypair(accountKey);
          const accountInfo = getAccountInfo(accountKey);
          
          const [prmxBalance, usdtBalance] = await Promise.all([
            getPrmxBalance(accountInfo.address),
            getUsdtBalance(accountInfo.address),
          ]);

          set({
            isConnected: true,
            isConnecting: false,
            isChainConnected: true,
            walletMode: 'dev',
            selectedAccountKey: accountKey,
            selectedAccount: accountInfo,
            keypair,
            prmxBalance,
            usdtBalance,
          });

        } catch (error) {
          console.error('Failed to connect:', error);
          set({
            isConnecting: false,
            connectionError: error instanceof Error ? error.message : 'Failed to connect',
            isChainConnected: false,
          });
          throw error;
        }
      },

      connectPolkadotJs: async () => {
        set({ isConnecting: true, connectionError: null });

        try {
          // Dynamically import to avoid SSR issues
          const { web3Enable, web3Accounts } = await import('@polkadot/extension-dapp');
          
          // Enable extension
          const extensions = await web3Enable('PRMX Insurance');
          
          if (extensions.length === 0) {
            throw new Error('No Polkadot.js extension found. Please install it from polkadot.js.org/extension');
          }

          // Get accounts
          const accounts = await web3Accounts();
          
          if (accounts.length === 0) {
            throw new Error('No accounts found. Please create an account in your Polkadot.js extension.');
          }

          // Connect to chain
          await getApi();

          // Select first account by default
          const firstAccount = accounts[0];
          const [prmxBalance, usdtBalance] = await Promise.all([
            getPrmxBalance(firstAccount.address),
            getUsdtBalance(firstAccount.address),
          ]);

          set({
            isConnected: true,
            isConnecting: false,
            isChainConnected: true,
            walletMode: 'polkadotjs',
            extensionAccounts: accounts,
            selectedExtensionAccount: firstAccount,
            selectedAccount: {
              name: firstAccount.meta.name || 'Unknown',
              role: 'Polkadot.js',
              address: firstAccount.address,
              description: `Source: ${firstAccount.meta.source}`,
              source: firstAccount.meta.source,
            },
            prmxBalance,
            usdtBalance,
          });

        } catch (error) {
          console.error('Failed to connect Polkadot.js:', error);
          set({
            isConnecting: false,
            connectionError: error instanceof Error ? error.message : 'Failed to connect to Polkadot.js',
          });
          throw error;
        }
      },

      selectExtensionAccount: async (account: InjectedAccountWithMeta) => {
        try {
          const [prmxBalance, usdtBalance] = await Promise.all([
            getPrmxBalance(account.address),
            getUsdtBalance(account.address),
          ]);

          set({
            selectedExtensionAccount: account,
            selectedAccount: {
              name: account.meta.name || 'Unknown',
              role: 'Polkadot.js',
              address: account.address,
              description: `Source: ${account.meta.source}`,
              source: account.meta.source,
            },
            prmxBalance,
            usdtBalance,
          });
        } catch (error) {
          console.error('Failed to select extension account:', error);
          throw error;
        }
      },

      disconnect: () => {
        disconnectApi();
        set({
          isConnected: false,
          walletMode: null,
          selectedAccountKey: null,
          selectedAccount: null,
          keypair: null,
          extensionAccounts: [],
          selectedExtensionAccount: null,
          prmxBalance: BigInt(0),
          usdtBalance: BigInt(0),
          isChainConnected: false,
          connectionError: null,
        });
      },

      selectAccount: async (accountKey: AccountKey) => {
        const { isConnected, walletMode } = get();
        
        if (!isConnected || walletMode !== 'dev') {
          await get().connectDevMode(accountKey);
          return;
        }

        try {
          const keypair = getKeypair(accountKey);
          const accountInfo = getAccountInfo(accountKey);
          
          const [prmxBalance, usdtBalance] = await Promise.all([
            getPrmxBalance(accountInfo.address),
            getUsdtBalance(accountInfo.address),
          ]);

          set({
            selectedAccountKey: accountKey,
            selectedAccount: accountInfo,
            keypair,
            prmxBalance,
            usdtBalance,
          });
        } catch (error) {
          console.error('Failed to select account:', error);
          throw error;
        }
      },

      refreshBalances: async () => {
        const { selectedAccount } = get();
        if (!selectedAccount) return;

        try {
          const [prmxBalance, usdtBalance] = await Promise.all([
            getPrmxBalance(selectedAccount.address),
            getUsdtBalance(selectedAccount.address),
          ]);

          set({ prmxBalance, usdtBalance });
        } catch (error) {
          console.error('Failed to refresh balances:', error);
        }
      },

      setCurrentBlock: (block: number) => {
        set({ currentBlock: block });
      },

      setChainConnected: (connected: boolean) => {
        set({ isChainConnected: connected });
      },

      getKeypair: () => {
        return get().keypair;
      },
    }),
    {
      name: 'prmx-wallet-storage',
      partialize: (state) => ({
        selectedAccountKey: state.selectedAccountKey,
        walletMode: state.walletMode,
      }),
    }
  )
);

export function useFormattedBalance() {
  const { prmxBalance, usdtBalance } = useWalletStore();

  const prmxFormatted = `${(Number(prmxBalance) / 1e12).toLocaleString(undefined, { maximumFractionDigits: 4 })} PRMX`;
  const usdtFormatted = `$${(Number(usdtBalance) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return {
    prmx: Number(prmxBalance) / 1e12,
    usdt: Number(usdtBalance) / 1e6,
    prmxFormatted,
    usdtFormatted,
  };
}

export type UserRole = 'dao' | 'customer' | 'lp' | 'user';

export function useUserRole(): UserRole {
  const { selectedAccountKey, walletMode } = useWalletStore();
  
  // For Polkadot.js users, return generic 'user' role
  if (walletMode === 'polkadotjs') return 'user';
  
  // For dev mode, use role-based accounts
  if (selectedAccountKey === 'alice') return 'dao';
  if (selectedAccountKey === 'bob') return 'customer';
  return 'lp'; // charlie, dave
}

export function useIsDao() {
  return useUserRole() === 'dao';
}

export function useIsCustomer() {
  return useUserRole() === 'customer';
}

export function useIsLP() {
  return useUserRole() === 'lp';
}

export function useAvailableAccounts(): AccountInfo[] {
  return Object.keys(TEST_ACCOUNTS).map((key) => getAccountInfo(key as AccountKey));
}
