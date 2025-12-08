import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KeyringPair } from '@polkadot/keyring/types';
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

interface AccountInfo {
  key: AccountKey;
  name: string;
  role: string;
  address: string;
  description: string;
}

interface WalletState {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  selectedAccountKey: AccountKey | null;
  selectedAccount: AccountInfo | null;
  keypair: KeyringPair | null;
  prmxBalance: bigint;
  usdtBalance: bigint;
  currentBlock: number;
  isChainConnected: boolean;
}

interface WalletActions {
  connect: (accountKey?: AccountKey) => Promise<void>;
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
      selectedAccountKey: null,
      selectedAccount: null,
      keypair: null,
      prmxBalance: BigInt(0),
      usdtBalance: BigInt(0),
      currentBlock: 0,
      isChainConnected: false,

      connect: async (accountKey: AccountKey = 'alice') => {
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

      disconnect: () => {
        disconnectApi();
        set({
          isConnected: false,
          selectedAccountKey: null,
          selectedAccount: null,
          keypair: null,
          prmxBalance: BigInt(0),
          usdtBalance: BigInt(0),
          isChainConnected: false,
          connectionError: null,
        });
      },

      selectAccount: async (accountKey: AccountKey) => {
        const { isConnected } = get();
        
        if (!isConnected) {
          await get().connect(accountKey);
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

export type UserRole = 'dao' | 'customer' | 'lp';

export function useUserRole(): UserRole {
  const { selectedAccountKey } = useWalletStore();
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
