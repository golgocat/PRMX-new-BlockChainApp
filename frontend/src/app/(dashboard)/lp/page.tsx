'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Wallet, 
  Plus, 
  Minus, 
  TrendingUp, 
  Shield,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ChevronRight,
  MapPin,
  Calendar,
  Droplets,
  AlertTriangle,
  Clock,
  DollarSign,
  Info,
  Filter,
  X,
  SlidersHorizontal,
  History,
  CheckCircle2,
  XCircle,
  TrendingDown,
  Trash2,
  Users
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Modal } from '@/components/ui/Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { formatUSDT, formatAddress, formatDateTimeUTC } from '@/lib/utils';
import { useWalletStore, useFormattedBalance, useIsDao } from '@/stores/walletStore';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { useLpOrders, useMyLpHoldings, usePolicies, useMarkets, useTradeHistory, useLpPositionOutcomes, addTradeToHistory } from '@/hooks/useChainData';
import { useV3Policies } from '@/hooks/useV3ChainData';
import * as api from '@/lib/api';
import { formatId } from '@/lib/api-v3';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import type { LpAskOrder, Policy, DaoSolvencyInfo, PolicyDefiInfo, LpTradeRecord, LpPositionOutcome } from '@/types';
import { encodeAddress, decodeAddress } from '@polkadot/util-crypto';

// Helper to compare addresses (handles different encodings)
function isSameAddress(addr1: string | undefined, addr2: string | undefined): boolean {
  if (!addr1 || !addr2) return false;
  try {
    // Decode both addresses to raw bytes and compare
    const decoded1 = decodeAddress(addr1);
    const decoded2 = decodeAddress(addr2);
    return decoded1.toString() === decoded2.toString();
  } catch {
    // Fallback to direct string comparison
    return addr1.toLowerCase() === addr2.toLowerCase();
  }
}

export default function LpTradingPage() {
  const { isConnected, selectedAccount } = useWalletStore();
  const { usdtBalance } = useWalletStore();
  const { usdtFormatted } = useFormattedBalance();
  const isDao = useIsDao();
  
  const { orders, loading: ordersLoading, refresh: refreshOrders } = useLpOrders();
  const { holdings: rawHoldings, loading: holdingsLoading, refresh: refreshHoldings } = useMyLpHoldings();
  const { policies } = usePolicies();
  const { policies: v3Policies } = useV3Policies();
  const { markets } = useMarkets();
  
  // Process holdings - with H128 hash-based IDs, no collision possible
  // Just determine if it's a V1/V2 or V3 policy by looking up the ID
  const holdings = useMemo(() => {
    return rawHoldings.map(holding => {
      const v1v2Policy = policies.find(p => p.id === holding.policyId);
      const v3Policy = v3Policies.find(p => p.id === holding.policyId);
      
      if (v3Policy) {
        return { ...holding, _policyVersion: 'V3' as const };
      } else if (v1v2Policy) {
        return { ...holding, _policyVersion: 'V1V2' as const };
      }
      
      return holding;
    });
  }, [rawHoldings, policies, v3Policies]);
  const { trades, loading: tradesLoading, refresh: refreshTrades, addTrade, clearHistory } = useTradeHistory();
  const { outcomes, loading: outcomesLoading, refresh: refreshOutcomes } = useLpPositionOutcomes();
  const [showWalletModal, setShowWalletModal] = useState(false);
  
  // Active tab state - Portfolio is default
  const [activeTab, setActiveTab] = useState<'portfolio' | 'orderbook' | 'history'>('portfolio');

  // Format V3 policy to compatible structure
  const formatV3Policy = (v3Policy: typeof v3Policies[0]) => ({
    id: v3Policy.id,
    label: `Policy #${v3Policy.id}`,
    marketId: -1, // V3 doesn't use markets
    policyVersion: 'V3' as const,
    coverageStart: v3Policy.coverageStart,
    coverageEnd: v3Policy.coverageEnd,
    status: v3Policy.status, // Include status for sell button visibility
    capitalPool: {
      totalShares: v3Policy.totalShares,
      totalCapital: BigInt(v3Policy.totalShares) * BigInt(100_000_000), // $100 per share in USDT decimals
    },
    // V3-specific: store location name for display
    locationName: v3Policy.location?.name,
  });

  // Helper to get policy by ID (hash-based IDs are unique, no collision possible)
  const getPolicyById = (policyId: string) => {
    const v1v2Policy = policies.find(p => p.id === policyId);
    if (v1v2Policy) return v1v2Policy;
    
    const v3Policy = v3Policies.find(p => p.id === policyId);
    if (v3Policy) return formatV3Policy(v3Policy);
    
    return undefined;
  };
  
  // Helper to get the correct policy for an LP holding
  // With hash-based IDs, there's no collision - just look up by ID
  const getPolicyForHolding = (policyId: string, _holdingShares?: bigint, _holderAddress?: string, _policyVersionHint?: 'V1V2' | 'V3') => {
    return getPolicyById(policyId);
  };
  
  // Helper to get market by ID
  const getMarketById = (marketId: number) => markets.find(m => m.id === marketId);

  // Helper to calculate days until coverage ends
  const getDaysRemaining = (coverageEnd: number) => {
    const now = Math.floor(Date.now() / 1000);
    const remaining = coverageEnd - now;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / 86400);
  };

  // Helper to calculate potential return
  const calculatePotentialReturn = (pricePerShare: bigint, payoutPerShare: bigint) => {
    const price = Number(pricePerShare);
    const payout = Number(payoutPerShare);
    if (price === 0) return 0;
    return ((payout - price) / price) * 100;
  };
  
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSellModal, setShowSellModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [showTradeDetailModal, setShowTradeDetailModal] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<LpTradeRecord | null>(null);
  const [showOutcomeDetailModal, setShowOutcomeDetailModal] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<LpPositionOutcome | null>(null);
  const [showOrderDetailModal, setShowOrderDetailModal] = useState(false);
  const [selectedOrderForDetail, setSelectedOrderForDetail] = useState<LpAskOrder | null>(null);
  
  // DeFi solvency state
  const [solvencyInfo, setSolvencyInfo] = useState<DaoSolvencyInfo | null>(null);
  const [policyDefiInfoMap, setPolicyDefiInfoMap] = useState<Map<number, PolicyDefiInfo>>(new Map());
  
  // Load DAO solvency info on mount
  useEffect(() => {
    const loadSolvencyInfo = async () => {
      try {
        const info = await api.getDaoSolvencyInfo();
        setSolvencyInfo(info);
      } catch (err) {
        console.error('Failed to load solvency info:', err);
      }
    };
    loadSolvencyInfo();
  }, []);
  
  // Load DeFi info for holdings
  useEffect(() => {
    const loadDefiInfo = async () => {
      const newMap = new Map<number, PolicyDefiInfo>();
      for (const holding of holdings) {
        try {
          const defiInfo = await api.getPolicyDefiInfo(holding.policyId);
          newMap.set(holding.policyId, defiInfo);
        } catch (err) {
          console.error(`Failed to load DeFi info for policy ${holding.policyId}:`, err);
        }
      }
      setPolicyDefiInfoMap(newMap);
    };
    if (holdings.length > 0) {
      loadDefiInfo();
    }
  }, [holdings]);
  const [selectedOrder, setSelectedOrder] = useState<LpAskOrder | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [sellQuantity, setSellQuantity] = useState('1');
  const [sellPrice, setSellPrice] = useState('');
  const [buyQuantity, setBuyQuantity] = useState('1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [showHoldingModal, setShowHoldingModal] = useState(false);
  const [selectedHoldingPolicyId, setSelectedHoldingPolicyId] = useState<number | null>(null);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterMarket, setFilterMarket] = useState<string>('all');
  const [filterMinReturn, setFilterMinReturn] = useState<string>('');
  const [filterMaxPrice, setFilterMaxPrice] = useState<string>('');
  const [filterMinDays, setFilterMinDays] = useState<string>('');
  const [sortBy, setSortBy] = useState<'price' | 'return' | 'time'>('price');

  // Get unique markets from orders for filter dropdown
  const marketsInOrders = Array.from(new Set(orders.map(order => {
    const policy = getPolicyById(order.policyId);
    return policy?.marketId;
  }).filter((id): id is number => id !== undefined)));

  // Filter and sort orders
  const filteredOrders = orders.filter(order => {
    const policy = getPolicyById(order.policyId);
    const market = policy ? getMarketById(policy.marketId) : null;
    const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
    const potentialReturn = market ? calculatePotentialReturn(order.priceUsdt, market.payoutPerShare) : 0;
    const priceUsd = Number(order.priceUsdt) / 1_000_000;

    // Filter by market
    if (filterMarket !== 'all' && policy?.marketId !== parseInt(filterMarket)) {
      return false;
    }

    // Filter by minimum return
    if (filterMinReturn && potentialReturn < parseFloat(filterMinReturn)) {
      return false;
    }

    // Filter by max price
    if (filterMaxPrice && priceUsd > parseFloat(filterMaxPrice)) {
      return false;
    }

    // Filter by minimum days remaining
    if (filterMinDays && daysRemaining < parseInt(filterMinDays)) {
      return false;
    }

    return true;
  }).sort((a, b) => {
    const policyA = getPolicyById(a.policyId);
    const policyB = getPolicyById(b.policyId);
    const marketA = policyA ? getMarketById(policyA.marketId) : null;
    const marketB = policyB ? getMarketById(policyB.marketId) : null;

    switch (sortBy) {
      case 'return':
        const returnA = marketA ? calculatePotentialReturn(a.priceUsdt, marketA.payoutPerShare) : 0;
        const returnB = marketB ? calculatePotentialReturn(b.priceUsdt, marketB.payoutPerShare) : 0;
        return returnB - returnA; // Higher return first
      case 'time':
        const daysA = policyA ? getDaysRemaining(policyA.coverageEnd) : 0;
        const daysB = policyB ? getDaysRemaining(policyB.coverageEnd) : 0;
        return daysB - daysA; // More time first
      case 'price':
      default:
        return Number(a.priceUsdt) - Number(b.priceUsdt); // Lower price first
    }
  });

  // Check if any filters are active
  const hasActiveFilters = filterMarket !== 'all' || filterMinReturn || filterMaxPrice || filterMinDays;

  // Clear all filters
  const clearFilters = () => {
    setFilterMarket('all');
    setFilterMinReturn('');
    setFilterMaxPrice('');
    setFilterMinDays('');
    setSortBy('price');
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refreshOrders(), refreshHoldings(), refreshTrades(), refreshOutcomes()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleOpenSellModal = (policy: Policy) => {
    setSelectedPolicy(policy);
    setSellQuantity('1');
    // Default price: fair value based on shares
    const fairValue = (Number(policy.capitalPool.totalCapital) / policy.capitalPool.totalShares) / 1_000_000;
    setSellPrice(fairValue.toFixed(2));
    setShowSellModal(true);
  };

  const handleOpenBuyModal = (order: LpAskOrder) => {
    setSelectedOrder(order);
    setBuyQuantity(order.remaining.toString());
    setShowBuyModal(true);
  };

  const handleOpenHoldingModal = (policyId: number) => {
    setSelectedHoldingPolicyId(policyId);
    setShowHoldingModal(true);
  };

  const handlePlaceSellOrder = async () => {
    if (!selectedPolicy || !isConnected) return;
    
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    const quantity = parseInt(sellQuantity);
    const priceUsdt = Math.round(parseFloat(sellPrice) * 1_000_000); // Convert to USDT decimals

    if (quantity <= 0) {
      toast.error('Invalid quantity');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.placeLpAsk(keypair, selectedPolicy.id, BigInt(quantity), BigInt(priceUsdt));
      
      // Note: We don't add to trade history here because placing an order is not a trade.
      // Trade history only records actual trades (when orders are filled).
      // The order will appear in the orderbook until someone fills it.
      
      toast.success('Sell order listed on orderbook!');
      setShowSellModal(false);
      handleRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to place order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFillBuyOrder = async () => {
    if (!selectedOrder || !isConnected) return;
    
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    const quantity = parseInt(buyQuantity);
    const totalCost = BigInt(quantity) * selectedOrder.priceUsdt;

    if (usdtBalance < totalCost) {
      toast.error(`Insufficient balance. Need ${formatUSDT(totalCost)}, have ${usdtFormatted}`);
      return;
    }

    setIsSubmitting(true);
    try {
      // Pass policyId and price directly to avoid extra chain query
      await api.fillLpAsk(
        keypair, 
        selectedOrder.orderId, 
        BigInt(quantity),
        selectedOrder.policyId,
        selectedOrder.priceUsdt
      );
      
      // Record buy trade in history
      const policy = getPolicyById(selectedOrder.policyId);
      const market = policy ? getMarketById(policy.marketId) : null;
      const pricePerShare = Number(selectedOrder.priceUsdt) / 1_000_000;
      
      addTrade({
        type: 'buy',
        policyId: selectedOrder.policyId,
        marketName: market?.name || `Market ${policy?.marketId || 'Unknown'}`,
        shares: quantity,
        pricePerShare,
        totalAmount: quantity * pricePerShare,
        timestamp: Date.now(),
        counterparty: formatAddress(selectedOrder.seller),
      });
      
      toast.success('Order filled successfully!');
      setShowBuyModal(false);
      handleRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fill order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    setCancellingOrderId(orderId);
    try {
      await api.cancelLpAsk(keypair, orderId);
      toast.success('Order cancelled successfully');
      handleRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel order');
    } finally {
      setCancellingOrderId(null);
    }
  };

  // Calculate stats
  const totalOrderValue = orders.reduce((sum, o) => sum + o.remaining * o.priceUsdt, BigInt(0));
  const myOrders = orders.filter(o => isSameAddress(o.seller, selectedAccount?.address));

  if (!isConnected) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">LP Trading</h1>
          <p className="text-text-secondary mt-1">Trade LP tokens on the orderbook</p>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <Wallet className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to trade LP tokens
            </p>
            <Button onClick={() => setShowWalletModal(true)}>
              Connect Wallet
            </Button>
            <WalletConnectionModal 
              isOpen={showWalletModal} 
              onClose={() => setShowWalletModal(false)} 
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">LP Trading</h1>
          <p className="text-text-secondary mt-1">Trade LP tokens and earn from policy premiums</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw className={cn('w-4 h-4 transition-transform', isRefreshing && 'animate-spin')} />}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          title="Active Orders"
          value={ordersLoading ? '...' : orders.length}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <StatCard
          title="Total Order Value"
          value={ordersLoading ? '...' : formatUSDT(totalOrderValue)}
          icon={<Wallet className="w-5 h-5" />}
          iconColor="bg-success/10 text-success"
        />
        <StatCard
          title="My Holdings"
          value={holdingsLoading ? '...' : holdings.filter(h => h.shares > 0).length}
          icon={<Shield className="w-5 h-5" />}
          iconColor="bg-prmx-purple/10 text-prmx-purple-light"
        />
        <StatCard
          title="Trade History"
          value={tradesLoading ? '...' : trades.length}
          icon={<History className="w-5 h-5" />}
          iconColor="bg-prmx-cyan/10 text-prmx-cyan"
        />
      </div>

      {/* Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'portfolio' | 'orderbook' | 'history')}>
        <TabsList className="mb-6">
          <TabsTrigger value="portfolio">
            <Wallet className="w-4 h-4 mr-2" />
            My Portfolio
            <Badge variant="purple" className="ml-2">{holdings.filter(h => h.shares > 0).length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="orderbook">
            <TrendingUp className="w-4 h-4 mr-2" />
            Orderbook
            <Badge variant="cyan" className="ml-2">{orders.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="w-4 h-4 mr-2" />
            History
            <Badge variant={trades.length > 0 ? "default" : "default"} className="ml-2">{trades.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* Portfolio Tab (Default) */}
        <TabsContent value="portfolio">
          <div className="space-y-6">
            {/* Portfolio Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 dark:from-emerald-500/20 dark:to-cyan-500/20 flex items-center justify-center backdrop-blur-sm border border-emerald-500/30 dark:border-emerald-500/20">
                  <Wallet className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-text-primary">My LP Holdings</h2>
                  <p className="text-sm text-text-secondary">
                    {holdings.filter(h => h.shares > 0).length} position{holdings.filter(h => h.shares > 0).length !== 1 ? 's' : ''} in your portfolio
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-text-tertiary uppercase tracking-wider">USDT Balance</p>
                <p className="text-2xl font-bold bg-gradient-to-r from-emerald-600 to-cyan-600 dark:from-emerald-400 dark:to-cyan-400 bg-clip-text text-transparent">
                  {usdtFormatted}
                </p>
              </div>
            </div>

            {/* Solvency Warning */}
            {solvencyInfo && !solvencyInfo.isSolvent && holdings.filter(h => h.shares > 0).length > 0 && (
              <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <p className="text-sm text-amber-800 dark:text-amber-200/80">
                    <span className="font-medium text-amber-700 dark:text-amber-300">Solvency alert:</span> DAO coverage may be limited. Consider reducing exposure.
                  </p>
                </div>
              </div>
            )}

            {/* Holdings Grid */}
            {holdingsLoading ? (
              <div className="flex items-center justify-center py-24">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-3 border-emerald-200 dark:border-emerald-500/20 border-t-emerald-500 dark:border-t-emerald-400 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/20 animate-pulse" />
                  </div>
                </div>
              </div>
            ) : holdings.filter(h => h.shares > 0).length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="text-center py-16">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center border border-slate-200 dark:border-white/5">
                    <Wallet className="w-10 h-10 text-slate-400 dark:text-slate-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">No LP Holdings Yet</h3>
                  <p className="text-text-secondary mb-6 max-w-md mx-auto">
                    Start earning from policy premiums by purchasing LP tokens from the orderbook.
                  </p>
                  <Button onClick={() => setActiveTab('orderbook')}>
                    <TrendingUp className="w-4 h-4 mr-2" />
                    Browse Orderbook
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-xl border border-border-secondary bg-background-secondary dark:bg-background-tertiary/30 overflow-hidden">
                {/* List Header */}
                <div className="hidden lg:flex items-center gap-4 px-4 py-3 bg-background-tertiary/50 dark:bg-background-tertiary/20 border-b border-border-secondary text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  <div className="w-[200px] flex-shrink-0">Policy</div>
                  <div className="w-[80px] text-center flex-shrink-0">Shares</div>
                  <div className="w-[100px] text-center flex-shrink-0">Max Payout</div>
                  <div className="w-[100px] text-center flex-shrink-0">Start</div>
                  <div className="w-[100px] text-center flex-shrink-0">End</div>
                  <div className="w-[100px] text-center flex-shrink-0">DeFi</div>
                  <div className="flex-1 text-center">Status</div>
                </div>
                
                {/* List Items */}
                <div className="divide-y divide-border-secondary">
                  {holdings.filter(h => h.shares > 0).map((holding, index) => {
                    const policyVersionHint = (holding as any)._policyVersion as 'V1V2' | 'V3' | undefined;
                    const policy = getPolicyForHolding(holding.policyId, holding.shares, selectedAccount?.address, policyVersionHint);
                    const market = policy ? getMarketById(policy.marketId) : null;
                    const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
                    const potentialPayout = holding.shares * (market?.payoutPerShare || BigInt(100_000_000));
                    const defiInfo = policyDefiInfoMap.get(holding.policyId);
                    const isExpiringSoon = daysRemaining <= 3 && daysRemaining > 0;
                    const isEnded = daysRemaining <= 0;
                    const totalShares = policy?.capitalPool?.totalShares || Number(holding.shares);
                    const ownershipPct = (Number(holding.shares) / totalShares * 100).toFixed(1);
                    
                    // Format short policy ID
                    const shortId = typeof holding.policyId === 'string' && holding.policyId.startsWith('0x') 
                      ? holding.policyId.slice(2, 10) 
                      : String(holding.policyId).slice(0, 8);
                    
                    return (
                      <div
                        key={index}
                        onClick={() => handleOpenHoldingModal(holding.policyId)}
                        className="group cursor-pointer transition-all duration-200 hover:bg-slate-50 dark:hover:bg-white/[0.02] px-4 py-4"
                      >
                        {/* Desktop Layout */}
                        <div className="hidden lg:flex items-center gap-4">
                          {/* Policy Info */}
                          <div className="w-[200px] flex-shrink-0 flex items-center gap-3">
                            <div className="relative">
                              <div 
                                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-mono text-xs font-bold shadow-sm"
                                style={{
                                  background: `linear-gradient(135deg, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 160}, 70%, 45%) 0%, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 200}, 80%, 35%) 100%)`
                                }}
                              >
                                {shortId.slice(0, 4)}
                              </div>
                              {defiInfo?.isAllocatedToDefi && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-background-secondary flex items-center justify-center">
                                  <TrendingUp className="w-2 h-2 text-white" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-medium text-text-primary">{shortId}...</span>
                                <span className={cn(
                                  "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                                  policy?.policyVersion === 'V3' 
                                    ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" 
                                    : policy?.policyVersion === 'V2' 
                                      ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300" 
                                      : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                                )}>
                                  {policy?.policyVersion || 'V1'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3 text-text-tertiary flex-shrink-0" />
                                <span className="text-xs text-text-tertiary truncate">{market?.name || policy?.locationName || 'Unknown'}</span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Shares */}
                          <div className="w-[80px] flex-shrink-0 text-center">
                            <p className="text-base font-bold text-text-primary">{holding.shares.toString()}</p>
                            <p className="text-xs text-text-tertiary">{ownershipPct}%</p>
                          </div>
                          
                          {/* Max Payout */}
                          <div className="w-[100px] flex-shrink-0 text-center">
                            <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{formatUSDT(potentialPayout)}</p>
                            <p className="text-xs text-text-tertiary">if no event</p>
                          </div>
                          
                          {/* Coverage Start */}
                          <div className="w-[100px] flex-shrink-0 text-center">
                            <p className="text-sm font-medium text-text-primary">
                              {policy?.coverageStart ? new Date(policy.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                            </p>
                            <p className="text-xs text-text-tertiary">
                              {policy?.coverageStart ? new Date(policy.coverageStart * 1000).getFullYear() : ''}
                            </p>
                          </div>
                          
                          {/* Coverage End */}
                          <div className="w-[100px] flex-shrink-0 text-center">
                            <p className="text-sm font-medium text-text-primary">
                              {policy?.coverageEnd ? new Date(policy.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                            </p>
                            <p className="text-xs text-text-tertiary">
                              {policy?.coverageEnd ? new Date(policy.coverageEnd * 1000).getFullYear() : ''}
                            </p>
                          </div>
                          
                          {/* DeFi */}
                          <div className="w-[100px] flex-shrink-0 text-center">
                            {defiInfo?.isAllocatedToDefi && defiInfo.position ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-medium">
                                <span>✨</span> Earning
                              </span>
                            ) : (
                              <span className="text-sm text-text-tertiary">—</span>
                            )}
                          </div>
                          
                          {/* Status */}
                          <div className="flex-1 flex items-center justify-center gap-2">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-xs font-medium",
                              isEnded 
                                ? "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400" 
                                : isExpiringSoon 
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" 
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                            )}>
                              {isEnded ? 'Ended' : `${daysRemaining}d left`}
                            </span>
                            <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-cyan group-hover:translate-x-0.5 transition-all" />
                          </div>
                        </div>
                        
                        {/* Mobile/Tablet Layout */}
                        <div className="lg:hidden">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-mono text-xs font-bold"
                                style={{
                                  background: `linear-gradient(135deg, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 160}, 70%, 45%) 0%, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 200}, 80%, 35%) 100%)`
                                }}
                              >
                                {shortId.slice(0, 4)}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-medium">{shortId}...</span>
                                  <span className={cn(
                                    "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                                    policy?.policyVersion === 'V3' 
                                      ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" 
                                      : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                                  )}>
                                    {policy?.policyVersion || 'V1'}
                                  </span>
                                </div>
                                <p className="text-xs text-text-tertiary">{market?.name || policy?.locationName || 'Unknown'}</p>
                              </div>
                            </div>
                            <span className={cn(
                              "px-2 py-1 rounded-full text-xs font-medium",
                              isEnded 
                                ? "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400" 
                                : isExpiringSoon 
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" 
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                            )}>
                              {isEnded ? 'Ended' : `${daysRemaining}d`}
                            </span>
                          </div>
                          {/* Coverage dates row */}
                          <div className="flex items-center gap-4 mb-3 text-xs text-text-secondary">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-text-tertiary" />
                              <span>
                                {policy?.coverageStart ? new Date(policy.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                {' → '}
                                {policy?.coverageEnd ? new Date(policy.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-xs text-text-tertiary">Shares</p>
                              <p className="font-bold">{holding.shares.toString()}</p>
                            </div>
                            <div>
                              <p className="text-xs text-text-tertiary">Payout</p>
                              <p className="font-bold text-emerald-600 dark:text-emerald-400">{formatUSDT(potentialPayout)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-text-tertiary">DeFi</p>
                              <p className="font-bold text-purple-600 dark:text-purple-400">
                                {defiInfo?.isAllocatedToDefi ? '✨ Earning' : '—'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Orderbook Tab */}
        <TabsContent value="orderbook">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">LP Token Orderbook</h3>
                <div className="flex items-center gap-2">
                  {hasActiveFilters && (
                    <Badge variant="purple">{filteredOrders.length} of {orders.length}</Badge>
                  )}
                  <Badge variant="cyan">{orders.length} Active Orders</Badge>
                </div>
              </div>
              
              {/* Filter Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant={showFilters ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  icon={<SlidersHorizontal className="w-4 h-4" />}
                >
                  Filters {hasActiveFilters && `(${[filterMarket !== 'all', filterMinReturn, filterMaxPrice, filterMinDays].filter(Boolean).length})`}
                </Button>
                
                {/* Sort Dropdown */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'price' | 'return' | 'time')}
                  className="px-3 py-1.5 text-sm rounded-lg bg-background-tertiary border border-border-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-prmx-cyan/50"
                >
                  <option value="price">Sort: Price (Low to High)</option>
                  <option value="return">Sort: Return (High to Low)</option>
                  <option value="time">Sort: Time Remaining</option>
                </select>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    icon={<X className="w-4 h-4" />}
                    className="text-text-secondary hover:text-error"
                  >
                    Clear
                  </Button>
                )}
              </div>

              {/* Expanded Filter Panel */}
              {showFilters && (
                <div className="mt-4 p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* Market Filter */}
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">Market</label>
                      <select
                        value={filterMarket}
                        onChange={(e) => setFilterMarket(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-background-secondary border border-border-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-prmx-cyan/50"
                      >
                        <option value="all">All Markets</option>
                        {marketsInOrders.map(marketId => {
                          const market = getMarketById(marketId);
                          return (
                            <option key={marketId} value={marketId}>
                              {market?.name || `Market #${marketId}`}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Min Return Filter */}
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">Min Return %</label>
                      <input
                        type="number"
                        placeholder="e.g. 10"
                        value={filterMinReturn}
                        onChange={(e) => setFilterMinReturn(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-background-secondary border border-border-secondary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-prmx-cyan/50"
                      />
                    </div>

                    {/* Max Price Filter */}
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">Max Price ($)</label>
                      <input
                        type="number"
                        placeholder="e.g. 90"
                        value={filterMaxPrice}
                        onChange={(e) => setFilterMaxPrice(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-background-secondary border border-border-secondary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-prmx-cyan/50"
                      />
                    </div>

                    {/* Min Days Filter */}
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">Min Days Left</label>
                      <input
                        type="number"
                        placeholder="e.g. 7"
                        value={filterMinDays}
                        onChange={(e) => setFilterMinDays(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-background-secondary border border-border-secondary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-prmx-cyan/50"
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {ordersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-text-tertiary" />
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                  <p className="text-text-secondary">No orders yet</p>
                  <p className="text-xs text-text-tertiary mt-1">Be the first to place an order!</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-12">
                  <Filter className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                  <p className="text-text-secondary">No orders match your filters</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearFilters}
                    className="mt-3"
                  >
                    Clear Filters
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border-secondary">
                  {filteredOrders.map((order) => {
                    const isOwner = isSameAddress(order.seller, selectedAccount?.address);
                    const total = order.remaining * order.priceUsdt;
                    const policy = getPolicyById(order.policyId);
                    const market = policy ? getMarketById(policy.marketId) : null;
                    const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
                    const potentialReturn = market ? calculatePotentialReturn(order.priceUsdt, market.payoutPerShare) : 0;
                    
                    return (
                      <div 
                        key={order.orderId} 
                        onClick={() => {
                          setSelectedOrderForDetail(order);
                          setShowOrderDetailModal(true);
                        }}
                        className={cn(
                          "p-4 hover:bg-background-tertiary/30 transition-colors cursor-pointer",
                          isOwner && "border-l-4 border-l-prmx-cyan bg-prmx-cyan/5"
                        )}>
                        {/* Header Row */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center">
                              <Shield className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{policy?.label || `Policy #${order.policyId}`}</span>
                                <Badge 
                                  variant={policy?.policyVersion === 'V3' ? 'cyan' : policy?.policyVersion === 'V2' ? 'purple' : 'default'} 
                                  className="text-xs"
                                >
                                  {policy?.policyVersion || 'V1'}
                                </Badge>
                                <Badge variant="error" className="text-xs">Sell</Badge>
                                {isOwner && <Badge variant="cyan" className="text-xs">Your Order</Badge>}
                              </div>
                              {market && (
                                <div className="flex items-center gap-1 text-sm text-text-secondary">
                                  <MapPin className="w-3 h-3" />
                                  <span>{market.name}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-lg">{formatUSDT(order.priceUsdt)}</div>
                            <div className="text-xs text-text-secondary">per share</div>
                          </div>
                        </div>

                        {/* Details Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div className="p-2 rounded-lg bg-background-tertiary/50">
                            <div className="text-xs text-text-tertiary mb-1">For Sale</div>
                            <div className="font-medium">{order.remaining.toString()} shares</div>
                          </div>
                          <div className="p-2 rounded-lg bg-background-tertiary/50">
                            <div className="text-xs text-text-tertiary mb-1">Total Value</div>
                            <div className="font-medium">{formatUSDT(total)}</div>
                          </div>
                          {market && (
                            <>
                              <div className="p-2 rounded-lg bg-background-tertiary/50">
                                <div className="text-xs text-text-tertiary mb-1">Strike</div>
                                <div className="font-medium flex items-center gap-1">
                                  <Droplets className="w-3 h-3 text-prmx-cyan" />
                                  {market.strikeValue} mm
                                </div>
                              </div>
                              <div className="p-2 rounded-lg bg-background-tertiary/50">
                                <div className="text-xs text-text-tertiary mb-1">Time Left</div>
                                <div className={cn(
                                  "font-medium flex items-center gap-1",
                                  daysRemaining <= 3 ? "text-warning" : "text-text-primary"
                                )}>
                                  <Clock className="w-3 h-3" />
                                  {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Potential Return & Action */}
                        <div className="flex items-center justify-between pt-3 border-t border-border-secondary/50">
                          <div className="flex items-center gap-4">
                            {market && potentialReturn > 0 && (
                              <div className="flex items-center gap-2">
                                <TrendingUp className={cn(
                                  "w-4 h-4",
                                  potentialReturn >= 50 ? "text-success" : "text-prmx-cyan"
                                )} />
                                <span className="text-sm">
                                  <span className="text-text-secondary">Max Return: </span>
                                  <span className={cn(
                                    "font-medium",
                                    potentialReturn >= 50 ? "text-success" : "text-prmx-cyan"
                                  )}>
                                    +{potentialReturn.toFixed(0)}%
                                  </span>
                                </span>
                              </div>
                            )}
                            <div className="text-sm text-text-secondary">
                              Seller: {isOwner ? (
                                <span className="text-prmx-cyan font-medium">You</span>
                              ) : (
                                <code className="text-xs">{formatAddress(order.seller)}</code>
                              )}
                            </div>
                          </div>
                          {isOwner ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCancelOrder(order.orderId)}
                              loading={cancellingOrderId === order.orderId}
                              disabled={cancellingOrderId !== null}
                              className="text-error hover:bg-error/10"
                            >
                              {cancellingOrderId === order.orderId ? 'Cancelling...' : 'Cancel Order'}
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleOpenBuyModal(order)}
                            >
                              Fill Order
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <div className="space-y-6">
            {/* Trade History Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-prmx-cyan" />
                    <h3 className="font-semibold">Trade History</h3>
                  </div>
                  {trades.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('Clear all trade history?')) {
                          clearHistory();
                          toast.success('Trade history cleared');
                        }
                      }}
                      icon={<Trash2 className="w-4 h-4" />}
                      className="text-text-tertiary hover:text-error"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {tradesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-text-tertiary" />
                  </div>
                ) : trades.length === 0 ? (
                  <div className="text-center py-8">
                    <History className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                    <p className="text-text-secondary text-sm">No trades yet</p>
                    <p className="text-xs text-text-tertiary mt-1">Your buy and sell orders will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {trades.map((trade) => (
                      <div
                        key={trade.id}
                        onClick={() => {
                          setSelectedTrade(trade);
                          setShowTradeDetailModal(true);
                        }}
                        className={cn(
                          "p-4 rounded-xl border transition-all cursor-pointer hover:shadow-md",
                          trade.type === 'buy' 
                            ? "bg-success/5 border-success/20 hover:border-success/40" 
                            : "bg-error/5 border-error/20 hover:border-error/40"
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center",
                              trade.type === 'buy' ? "bg-success/20" : "bg-error/20"
                            )}>
                              {trade.type === 'buy' ? (
                                <ArrowDownRight className="w-4 h-4 text-success" />
                              ) : (
                                <ArrowUpRight className="w-4 h-4 text-error" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "font-semibold",
                                  trade.type === 'buy' ? "text-success" : "text-error"
                                )}>
                                  {trade.type === 'buy' ? 'Bought' : 'Sold'}
                                </span>
                                <span className="text-text-primary">
                                  {trade.shares} share{trade.shares > 1 ? 's' : ''}
                                </span>
                              </div>
                              <p className="text-xs text-text-secondary">
                                {trade.marketName}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">${trade.totalAmount.toFixed(2)}</p>
                            <p className="text-xs text-text-tertiary">
                              ${trade.pricePerShare.toFixed(2)}/share
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-text-tertiary pt-2 border-t border-border-secondary/50">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(trade.timestamp).toLocaleString()}
                          </span>
                          {trade.counterparty && (
                            <span>Counterparty: {trade.counterparty}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Position Outcomes Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-prmx-purple" />
                  <h3 className="font-semibold">Position Outcomes</h3>
                </div>
                <p className="text-sm text-text-secondary mt-1">
                  Track your LP positions and their final outcomes
                </p>
              </CardHeader>
              <CardContent>
                {outcomesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-text-tertiary" />
                  </div>
                ) : outcomes.length === 0 ? (
                  <div className="text-center py-8">
                    <Shield className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                    <p className="text-text-secondary text-sm">No position history</p>
                    <p className="text-xs text-text-tertiary mt-1">
                      Settled positions and their outcomes will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {outcomes.map((outcome) => (
                      <div
                        key={outcome.policyId}
                        onClick={() => {
                          setSelectedOutcome(outcome);
                          setShowOutcomeDetailModal(true);
                        }}
                        className={cn(
                          "p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md",
                          outcome.outcome === 'matured' && "bg-success/5 border-success/20 hover:border-success/40",
                          outcome.outcome === 'event_triggered' && "bg-error/5 border-error/20 hover:border-error/40",
                          outcome.outcome === 'active' && "bg-background-tertiary/50 border-border-secondary hover:border-prmx-cyan/40"
                        )}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-10 h-10 rounded-lg flex items-center justify-center",
                              outcome.outcome === 'matured' && "bg-success/20",
                              outcome.outcome === 'event_triggered' && "bg-error/20",
                              outcome.outcome === 'active' && "bg-prmx-cyan/20"
                            )}>
                              {outcome.outcome === 'matured' && <CheckCircle2 className="w-5 h-5 text-success" />}
                              {outcome.outcome === 'event_triggered' && <XCircle className="w-5 h-5 text-error" />}
                              {outcome.outcome === 'active' && <Clock className="w-5 h-5 text-prmx-cyan" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{outcome.marketName}</span>
                                <Badge 
                                  variant={
                                    outcome.outcome === 'matured' ? 'success' : 
                                    outcome.outcome === 'event_triggered' ? 'destructive' : 
                                    'default'
                                  }
                                >
                                  {outcome.outcome === 'matured' && 'Matured'}
                                  {outcome.outcome === 'event_triggered' && 'Event Triggered'}
                                  {outcome.outcome === 'active' && 'Active'}
                                </Badge>
                              </div>
                              <p className="text-sm text-text-secondary flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {outcome.marketName}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={cn(
                              "text-lg font-bold",
                              outcome.profitLoss >= 0 ? "text-success" : "text-error"
                            )}>
                              {outcome.profitLoss >= 0 ? '+' : ''}{outcome.profitLoss.toFixed(2)} USDT
                            </p>
                            <p className="text-xs text-text-tertiary">
                              {outcome.profitLoss >= 0 ? 'Profit' : 'Loss'}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-3 pt-3 border-t border-border-secondary/50">
                          <div>
                            <p className="text-xs text-text-tertiary">Shares Held</p>
                            <p className="font-medium">{outcome.sharesHeld}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-tertiary">Investment</p>
                            <p className="font-medium">${outcome.investmentCost.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-tertiary">Payout</p>
                            <p className={cn(
                              "font-medium",
                              outcome.payoutReceived > 0 ? "text-success" : "text-text-primary"
                            )}>
                              ${outcome.payoutReceived.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-text-tertiary">
                              {outcome.outcome === 'event_triggered' ? 'Trigger' : 'Status'}
                            </p>
                            <p className="font-medium">
                              {outcome.eventOccurred !== undefined ? (
                                outcome.eventOccurred ? (
                                  <span className="text-error flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Rain Event
                                  </span>
                                ) : (
                                  <span className="text-success">No Event</span>
                                )
                              ) : (
                                <span className="text-text-secondary">Pending</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {outcome.settledAt && (
                          <div className="flex items-center gap-1 text-xs text-text-tertiary mt-3 pt-2 border-t border-border-secondary/50">
                            <Clock className="w-3 h-3" />
                            Settled: {new Date(outcome.settledAt * 1000).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary Stats */}
            {outcomes.length > 0 && (
              <Card className="bg-gradient-to-r from-prmx-cyan/5 to-prmx-purple/5 border-prmx-cyan/20">
                <CardContent className="p-4">
                  <h4 className="font-semibold mb-3">Performance Summary</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-text-secondary">Total Positions</p>
                      <p className="text-xl font-bold">{outcomes.length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-text-secondary">Matured</p>
                      <p className="text-xl font-bold text-success">
                        {outcomes.filter(o => o.outcome === 'matured').length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-text-secondary">Triggered</p>
                      <p className="text-xl font-bold text-error">
                        {outcomes.filter(o => o.outcome === 'event_triggered').length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-text-secondary">Total P&L</p>
                      <p className={cn(
                        "text-xl font-bold",
                        outcomes.reduce((sum, o) => sum + o.profitLoss, 0) >= 0 
                          ? "text-success" 
                          : "text-error"
                      )}>
                        ${outcomes.reduce((sum, o) => sum + o.profitLoss, 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Sell Modal */}
      <Modal
        isOpen={showSellModal}
        onClose={() => setShowSellModal(false)}
        title="Sell LP Tokens"
        size="lg"
      >
        {selectedPolicy && (() => {
          const myHolding = holdings.find(h => h.policyId === selectedPolicy.id);
          const myShares = myHolding ? Number(myHolding.shares) : 0;
          const market = getMarketById(selectedPolicy.marketId);
          const daysRemaining = getDaysRemaining(selectedPolicy.coverageEnd);
          const maxPayout = market ? formatUSDT(market.payoutPerShare) : '$100.00';
          const fairValuePerShare = selectedPolicy.capitalPool.totalShares > 0 
            ? Number(selectedPolicy.capitalPool.totalCapital) / selectedPolicy.capitalPool.totalShares / 1_000_000
            : 0;
          const totalValue = parseFloat(sellQuantity || '0') * parseFloat(sellPrice || '0');

          return (
          <div className="space-y-4">
            {/* Market Info Card */}
            {market && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-prmx-purple/10 to-prmx-cyan/10 border border-prmx-purple/20">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="font-semibold">{selectedPolicy.label}</h4>
                    <p className="text-xs text-text-secondary">{market.name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2 rounded-lg bg-background-primary/50">
                    <div className="text-xs text-text-tertiary mb-1">Strike Threshold</div>
                    <div className="font-medium flex items-center gap-1">
                      <Droplets className="w-3 h-3 text-prmx-cyan" />
                      {market.strikeValue} mm
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-background-primary/50">
                    <div className="text-xs text-text-tertiary mb-1">Max Payout/Share</div>
                    <div className="font-medium text-success">{maxPayout}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Policy Details */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <div className="text-xs text-text-tertiary mb-1">Your LP Tokens</div>
                  <div className="font-semibold text-lg">{myShares} shares</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-tertiary mb-1">Time Remaining</div>
                  <div className={cn(
                    "font-semibold text-lg",
                    daysRemaining <= 3 ? "text-warning" : "text-text-primary"
                  )}>
                    {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-text-secondary">Capital Pool: </span>
                  <span className="font-medium">{formatUSDT(selectedPolicy.capitalPool.totalCapital)}</span>
                </div>
                <div className="text-right">
                  <span className="text-text-secondary">Fair Value: </span>
                  <span className="font-medium">${fairValuePerShare.toFixed(2)}/share</span>
                </div>
              </div>
            </div>

            {/* Pricing Guide */}
            <div className="p-3 rounded-lg bg-prmx-cyan/5 border border-prmx-cyan/20">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-prmx-cyan flex-shrink-0 mt-0.5" />
                <div className="text-xs text-text-secondary">
                  <strong className="text-text-primary">Pricing Guide:</strong> Fair value per share is ~${fairValuePerShare.toFixed(2)} based on the capital pool. 
                  Price lower if you think the event is likely (LP tokens lose value if event occurs), or higher if you believe it's unlikely.
                </div>
              </div>
            </div>

            {/* Input Fields */}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Quantity to Sell"
                type="number"
                min="1"
                max={myShares}
                value={sellQuantity}
                onChange={(e) => setSellQuantity(e.target.value)}
              />
              <Input
                label="Price per Share (USDT)"
                type="number"
                step="0.01"
                min="0.01"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder={`Suggested: $${fairValuePerShare.toFixed(2)}`}
              />
            </div>

            {/* Total Value Summary */}
            <div className="p-4 rounded-xl bg-success/5 border border-success/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-text-secondary">Total Sale Value</span>
                <span className="text-xl font-bold text-success">
                  ${totalValue.toFixed(2)} USDT
                </span>
              </div>
              {parseFloat(sellPrice || '0') > 0 && fairValuePerShare > 0 && (
                <div className="text-xs text-text-secondary">
                  {parseFloat(sellPrice) > fairValuePerShare 
                    ? `${((parseFloat(sellPrice) / fairValuePerShare - 1) * 100).toFixed(0)}% above fair value`
                    : parseFloat(sellPrice) < fairValuePerShare
                    ? `${((1 - parseFloat(sellPrice) / fairValuePerShare) * 100).toFixed(0)}% below fair value`
                    : 'At fair value'}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setShowSellModal(false)} className="flex-1">
                Cancel
              </Button>
              <Button 
                onClick={handlePlaceSellOrder} 
                loading={isSubmitting} 
                disabled={parseInt(sellQuantity) > myShares || parseFloat(sellPrice) <= 0}
                className="flex-1"
              >
                Place Sell Order
              </Button>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Buy Modal */}
      <Modal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        title="Fill Order"
        size="lg"
      >
        {selectedOrder && (() => {
          const policy = getPolicyById(selectedOrder.policyId);
          const market = policy ? getMarketById(policy.marketId) : null;
          const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
          const potentialReturn = market ? calculatePotentialReturn(selectedOrder.priceUsdt, market.payoutPerShare) : 0;
          const maxPayout = market ? formatUSDT(market.payoutPerShare) : '$100.00';
          const totalCost = BigInt(parseInt(buyQuantity || '0')) * selectedOrder.priceUsdt;
          const totalPotentialPayout = BigInt(parseInt(buyQuantity || '0')) * (market?.payoutPerShare || BigInt(100_000_000));

          return (
          <div className="space-y-4">
            {/* Market Info Card */}
            {market && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-prmx-cyan/10 to-prmx-purple/10 border border-prmx-cyan/20">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{policy?.label || `Policy #${selectedOrder.policyId}`}</h4>
                      <Badge 
                        variant={policy?.policyVersion === 'V3' ? 'cyan' : policy?.policyVersion === 'V2' ? 'purple' : 'default'} 
                        className="text-xs"
                      >
                        {policy?.policyVersion || 'V1'}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-secondary">{market.name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2 rounded-lg bg-background-primary/50">
                    <div className="text-xs text-text-tertiary mb-1">Strike Threshold</div>
                    <div className="font-medium flex items-center gap-1">
                      <Droplets className="w-3 h-3 text-prmx-cyan" />
                      {market.strikeValue} mm (24h)
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-background-primary/50">
                    <div className="text-xs text-text-tertiary mb-1">Max Payout/Share</div>
                    <div className="font-medium text-success">{maxPayout}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Coverage Period */}
            {policy && (
              <div className="p-4 rounded-xl bg-background-tertiary/50">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-text-secondary" />
                  <span className="font-medium">Coverage Period</span>
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-text-secondary">Start (UTC)</span>
                  <span>{formatDateTimeUTC(policy.coverageStart)}</span>
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-text-secondary">End (UTC)</span>
                  <span>{formatDateTimeUTC(policy.coverageEnd)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Time Remaining</span>
                  <span className={cn(
                    "font-medium",
                    daysRemaining <= 3 ? "text-warning" : "text-prmx-cyan"
                  )}>
                    {daysRemaining > 0 ? `${daysRemaining} days` : 'Coverage Ended'}
                  </span>
                </div>
              </div>
            )}

            {/* Order Details */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-text-secondary" />
                <span className="font-medium">Order Details</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-text-secondary">Seller</span>
                <code className="text-xs bg-background-secondary px-2 py-1 rounded">{formatAddress(selectedOrder.seller)}</code>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-text-secondary">Price per Share</span>
                <span className="font-medium">{formatUSDT(selectedOrder.priceUsdt)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Available Shares</span>
                <span className="font-medium">{selectedOrder.remaining.toString()}</span>
              </div>
            </div>

            {/* Investment Analysis */}
            {market && potentialReturn > 0 && (
              <div className="p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-prmx-cyan" />
                  <span className="font-medium text-prmx-cyan">Investment Potential</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-text-secondary mb-1">If No Event</div>
                    <div className="font-semibold text-success">
                      +{potentialReturn.toFixed(0)}% return
                    </div>
                  </div>
                  <div>
                    <div className="text-text-secondary mb-1">If Event Occurs</div>
                    <div className="font-semibold text-error">
                      -100% (lose investment)
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border-secondary text-xs text-text-secondary flex items-start gap-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    {policy?.policyVersion === 'V2' ? (
                      <>
                        As an LP, you earn {maxPayout}/share if the cumulative rainfall stays below {market.strikeValue}mm over the coverage window. 
                        V2 policies have early trigger enabled - if rainfall exceeds threshold at any point, your investment pays out immediately.
                      </>
                    ) : (
                      <>
                        As an LP, you earn {maxPayout}/share if the 24h rolling rainfall stays below {market.strikeValue}mm. 
                        If the event occurs (rainfall exceeds threshold), your investment pays out to policy holders.
                      </>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Quantity Input */}
            <Input
              label="Quantity to Buy"
              type="number"
              min="1"
              max={selectedOrder.remaining.toString()}
              value={buyQuantity}
              onChange={(e) => setBuyQuantity(e.target.value)}
            />

            {/* Cost Summary */}
            <div className="p-4 rounded-xl bg-prmx-cyan/5 border border-prmx-cyan/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-text-secondary">Total Cost</span>
                <span className="text-xl font-bold">{formatUSDT(totalCost)}</span>
              </div>
              {market && (
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-secondary">Value if No Event</span>
                  <span className="font-medium text-success">{formatUSDT(totalPotentialPayout)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm pt-2 border-t border-prmx-cyan/20">
                <span className="text-text-secondary">Your Balance</span>
                <span className={usdtBalance >= totalCost ? 'text-success' : 'text-error'}>
                  {usdtFormatted}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setShowBuyModal(false)} className="flex-1">
                Cancel
              </Button>
              <Button 
                onClick={handleFillBuyOrder} 
                loading={isSubmitting} 
                disabled={usdtBalance < totalCost}
                className="flex-1"
              >
                Fill Order
              </Button>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Holding Details Modal - Theme-aware */}
      <Modal
        isOpen={showHoldingModal}
        onClose={() => setShowHoldingModal(false)}
        title=""
        size="lg"
      >
        {selectedHoldingPolicyId !== null && (() => {
          const holding = holdings.find(h => h.policyId === selectedHoldingPolicyId);
          const policyVersionHint = holding ? (holding as any)._policyVersion as 'V1V2' | 'V3' | undefined : undefined;
          const policy = holding 
            ? getPolicyForHolding(selectedHoldingPolicyId, holding.shares, selectedAccount?.address, policyVersionHint)
            : getPolicyById(selectedHoldingPolicyId);
          const market = policy ? getMarketById(policy.marketId) : null;
          
          if (!holding) return null;
          
          const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
          const potentialPayout = holding.shares * (market?.payoutPerShare || BigInt(100_000_000));
          const totalShares = policy?.capitalPool?.totalShares || 1;
          const ownershipPercent = Number(holding.shares) / totalShares * 100;
          const availableShares = holding.shares - holding.lockedShares;
          const isEnded = daysRemaining <= 0;
          const isExpiringSoon = daysRemaining <= 3 && daysRemaining > 0;
          
          const myOrdersForPolicy = orders.filter(o => 
            o.policyId === selectedHoldingPolicyId && 
            isSameAddress(o.seller, selectedAccount?.address)
          );
          
          // Format policy ID for display
          const displayId = typeof selectedHoldingPolicyId === 'string' && selectedHoldingPolicyId.startsWith('0x') 
            ? selectedHoldingPolicyId.slice(2, 14) + '...' 
            : String(selectedHoldingPolicyId);
          const shortId = typeof selectedHoldingPolicyId === 'string' && selectedHoldingPolicyId.startsWith('0x')
            ? selectedHoldingPolicyId.slice(2, 10)
            : String(selectedHoldingPolicyId).slice(0, 8);
          
          return (
          <div className="space-y-5">
            {/* Hero Header */}
            <div className="relative overflow-hidden rounded-2xl">
              {/* Gradient background - works in both themes */}
              <div 
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(135deg, 
                    hsl(${(parseInt(shortId, 16) % 60) + 160}, 65%, 40%) 0%, 
                    hsl(${(parseInt(shortId, 16) % 60) + 200}, 75%, 25%) 50%,
                    hsl(${(parseInt(shortId, 16) % 60) + 240}, 65%, 30%) 100%)`
                }}
              />
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDgpIiBzdHJva2Utd2lkdGg9IjIiLz48L2c+PC9zdmc+')] opacity-40" />
              
              <div className="relative p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div 
                      className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-mono text-lg font-bold shadow-lg"
                      style={{
                        background: `linear-gradient(135deg, 
                          hsl(${(parseInt(shortId, 16) % 60) + 160}, 70%, 55%) 0%, 
                          hsl(${(parseInt(shortId, 16) % 60) + 200}, 80%, 45%) 100%)`
                      }}
                    >
                      {shortId.slice(0, 4).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn(
                          "text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                          policy?.policyVersion === 'V3' 
                            ? "bg-cyan-500/30 text-cyan-100" 
                            : policy?.policyVersion === 'V2' 
                              ? "bg-purple-500/30 text-purple-100" 
                              : "bg-white/20 text-white/90"
                        )}>
                          {policy?.policyVersion || 'V1'}
                        </span>
                        {market && (
                          <span className="text-xs text-white/70 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {market.name}
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-white/50 text-sm">{displayId}</p>
                    </div>
                  </div>
                  
                  <div className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold",
                    isEnded 
                      ? "bg-red-500/30 text-red-100" 
                      : isExpiringSoon 
                        ? "bg-amber-500/30 text-amber-100" 
                        : "bg-emerald-500/30 text-emerald-100"
                  )}>
                    {isEnded ? 'Coverage Ended' : isExpiringSoon ? `${daysRemaining}d remaining` : `${daysRemaining} days left`}
                  </div>
                </div>

                {/* Big numbers */}
                <div className="mt-6 grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-white/50 mb-1">Your Shares</p>
                    <p className="text-4xl font-bold text-white">{holding.shares.toString()}</p>
                    <p className="text-sm text-white/60 mt-1">{ownershipPercent.toFixed(1)}% of pool</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-white/50 mb-1">Max Payout</p>
                    <p className="text-4xl font-bold text-emerald-300">{formatUSDT(potentialPayout)}</p>
                    <p className="text-sm text-white/60 mt-1">if no event occurs</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Grid - Theme-aware */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
                <p className="text-xs text-text-tertiary">Per Share</p>
                <p className="text-lg font-bold text-text-primary">
                  {market?.payoutPerShare ? formatUSDT(market.payoutPerShare) : '$100'}
                </p>
              </div>
              
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-100 dark:bg-cyan-500/10 flex items-center justify-center">
                    <Droplets className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  </div>
                </div>
                <p className="text-xs text-text-tertiary">Strike</p>
                <p className="text-lg font-bold text-text-primary">{market?.strikeValue || 50} mm</p>
              </div>
              
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                </div>
                <p className="text-xs text-text-tertiary">Total Pool</p>
                <p className="text-lg font-bold text-text-primary">{totalShares} shares</p>
              </div>
            </div>

            {/* Coverage Period - Theme-aware */}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-white/5 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-text-tertiary" />
                <span className="text-sm font-medium text-text-primary">Coverage Period</span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Start Date</p>
                    <p className="text-base font-semibold text-text-primary">
                      {policy?.coverageStart 
                        ? new Date(policy.coverageStart * 1000).toLocaleDateString('en-US', { 
                            month: 'long', 
                            day: 'numeric', 
                            year: 'numeric' 
                          }) 
                        : '—'}
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {policy?.coverageStart 
                        ? new Date(policy.coverageStart * 1000).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit',
                            timeZoneName: 'short'
                          }) 
                        : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-text-tertiary uppercase tracking-wider mb-1">End Date</p>
                    <p className="text-base font-semibold text-text-primary">
                      {policy?.coverageEnd 
                        ? new Date(policy.coverageEnd * 1000).toLocaleDateString('en-US', { 
                            month: 'long', 
                            day: 'numeric', 
                            year: 'numeric' 
                          }) 
                        : '—'}
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {policy?.coverageEnd 
                        ? new Date(policy.coverageEnd * 1000).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit',
                            timeZoneName: 'short'
                          }) 
                        : ''}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Share Management - Theme-aware */}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-white/5 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-text-tertiary" />
                <span className="text-sm font-medium text-text-primary">Share Management</span>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-text-secondary">Owned</span>
                  <span className="text-sm font-semibold text-text-primary">{holding.shares.toString()}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-t border-slate-200 dark:border-white/5">
                  <span className="text-sm text-text-secondary">Locked in Orders</span>
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{holding.lockedShares.toString()}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-t border-slate-200 dark:border-white/5">
                  <span className="text-sm text-text-secondary">Available</span>
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{availableShares.toString()}</span>
                </div>
              </div>
            </div>

            {/* Active Orders - Theme-aware */}
            {myOrdersForPolicy.length > 0 && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-500/20 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-medium text-amber-800 dark:text-amber-300">Active Sell Orders</span>
                </div>
                <div className="p-3 space-y-2">
                  {myOrdersForPolicy.map(order => (
                    <div key={order.orderId} className="flex justify-between items-center p-3 rounded-lg bg-amber-100/50 dark:bg-black/20">
                      <div>
                        <span className="text-text-primary font-medium">{order.remaining.toString()}</span>
                        <span className="text-text-secondary text-sm"> shares @ </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatUSDT(order.priceUsdt)}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowHoldingModal(false);
                          handleCancelOrder(order.orderId);
                        }}
                        className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/10 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DeFi Status - Theme-aware */}
            {(() => {
              const defiInfo = policyDefiInfoMap.get(selectedHoldingPolicyId);
              if (!defiInfo?.isAllocatedToDefi) return null;
              
              return (
                <div className="rounded-xl overflow-hidden bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-500/20">
                  <div className="px-4 py-3 border-b border-purple-200 dark:border-purple-500/20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center">
                        <TrendingUp className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <span className="text-sm font-medium text-purple-800 dark:text-purple-300">Earning Yield</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">Active</span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Principal in DeFi</span>
                      <span className="text-xl font-bold text-purple-700 dark:text-purple-300">
                        {defiInfo.position ? formatUSDT(defiInfo.position.principalUsdt) : '$0'}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary mt-3">
                      Funds are earning yield via Hydration Stableswap. DAO covers losses.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Compact Risk Notice - Theme-aware */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/10">
              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              <div className="text-xs text-text-secondary">
                <span className="text-red-600 dark:text-red-400 font-medium">Risk:</span>{' '}
                {policy?.policyVersion === 'V2' 
                  ? `Cumulative rainfall > ${market?.strikeValue || 50}mm triggers payout to policyholder.`
                  : `24h rainfall > ${market?.strikeValue || 50}mm triggers payout to policyholder.`
                }
              </div>
            </div>

            {/* Actions - Theme-aware */}
            <div className="flex gap-3 pt-2">
              <Button 
                variant="secondary" 
                onClick={() => setShowHoldingModal(false)} 
                className="flex-1"
              >
                Close
              </Button>
              {availableShares > BigInt(0) && policy?.status === 'Active' && (
                <Button 
                  variant="primary"
                  onClick={() => {
                    setShowHoldingModal(false);
                    handleOpenSellModal(policy);
                  }}
                  className="flex-1"
                  icon={<ArrowUpRight className="w-4 h-4" />}
                >
                  Sell Shares
                </Button>
              )}
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Trade Detail Modal */}
      <Modal
        isOpen={showTradeDetailModal}
        onClose={() => {
          setShowTradeDetailModal(false);
          setSelectedTrade(null);
        }}
        title="Trade Details"
        size="md"
      >
        {selectedTrade && (() => {
          const policy = getPolicyById(selectedTrade.policyId);
          const market = policy ? getMarketById(policy.marketId) : null;
          const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
          
          return (
            <div className="space-y-5">
              {/* Trade Summary Card */}
              <div className={cn(
                "p-5 rounded-xl",
                selectedTrade.type === 'buy' 
                  ? "bg-gradient-to-br from-success/10 to-success/5 border border-success/20" 
                  : "bg-gradient-to-br from-error/10 to-error/5 border border-error/20"
              )}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-14 h-14 rounded-xl flex items-center justify-center shrink-0",
                      selectedTrade.type === 'buy' ? "bg-success/20" : "bg-error/20"
                    )}>
                      {selectedTrade.type === 'buy' ? (
                        <ArrowDownRight className="w-7 h-7 text-success" />
                      ) : (
                        <ArrowUpRight className="w-7 h-7 text-error" />
                      )}
                    </div>
                    <div>
                      <p className={cn(
                        "text-sm font-medium uppercase tracking-wide",
                        selectedTrade.type === 'buy' ? "text-success" : "text-error"
                      )}>
                        {selectedTrade.type === 'buy' ? 'Purchased' : 'Sold'}
                      </p>
                      <p className="text-2xl font-bold mt-0.5">
                        {selectedTrade.shares} Share{selectedTrade.shares > 1 ? 's' : ''}
                      </p>
                      <p className="text-sm text-text-tertiary mt-1">
                        {new Date(selectedTrade.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-text-tertiary">Total</p>
                    <p className="text-2xl font-bold">${selectedTrade.totalAmount.toFixed(2)}</p>
                    <p className="text-sm text-text-tertiary">
                      @ ${selectedTrade.pricePerShare.toFixed(2)}/share
                    </p>
                  </div>
                </div>
              </div>

              {/* Policy & Market Info */}
              {policy && market && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-border-secondary">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center shrink-0">
                        <Shield className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{policy.label || `Policy #${selectedTrade.policyId}`}</span>
                          <Badge 
                            variant={policy.policyVersion === 'V3' ? 'cyan' : policy.policyVersion === 'V2' ? 'purple' : 'default'} 
                            className="text-xs"
                          >
                            {policy.policyVersion || 'V1'}
                          </Badge>
                        </div>
                        <p className="text-sm text-text-secondary flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {market.name}
                        </p>
                      </div>
                    </div>
                    <Badge variant={policy.status === 'Active' ? 'success' : 'default'}>
                      {policy.status}
                    </Badge>
                  </div>
                  
                  {/* Key Metrics - 2x2 Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-background-tertiary/50">
                      <p className="text-xs text-text-tertiary uppercase tracking-wide">Strike</p>
                      <p className="text-lg font-semibold mt-1 flex items-center gap-1.5">
                        <Droplets className="w-4 h-4 text-prmx-cyan" />
                        {policy.strikeMm ? `${policy.strikeMm / 10}mm` : `${market.strikeValue}mm`}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-background-tertiary/50">
                      <p className="text-xs text-text-tertiary uppercase tracking-wide">Max Payout</p>
                      <p className="text-lg font-semibold text-success mt-1">
                        {formatUSDT(market.payoutPerShare)}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-background-tertiary/50">
                      <p className="text-xs text-text-tertiary uppercase tracking-wide">Time Left</p>
                      <p className={cn(
                        "text-lg font-semibold mt-1 flex items-center gap-1.5",
                        daysRemaining <= 3 ? "text-warning" : ""
                      )}>
                        <Clock className="w-4 h-4" />
                        {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-background-tertiary/50">
                      <p className="text-xs text-text-tertiary uppercase tracking-wide">Coverage</p>
                      <p className="text-sm font-medium mt-1">
                        {new Date(policy.coverageStart * 1000).toLocaleDateString()} - {new Date(policy.coverageEnd * 1000).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Transaction Info */}
              <div className="space-y-3 pt-2">
                <p className="text-xs text-text-tertiary uppercase tracking-wide font-medium">Transaction Details</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-b border-border-secondary/50">
                    <span className="text-sm text-text-secondary">Your Account</span>
                    <span className="font-mono text-sm">{formatAddress(selectedTrade.trader)}</span>
                  </div>
                  {selectedTrade.counterparty && (
                    <div className="flex items-center justify-between py-2 border-b border-border-secondary/50">
                      <span className="text-sm text-text-secondary">Counterparty</span>
                      <span className="font-mono text-sm">{selectedTrade.counterparty}</span>
                    </div>
                  )}
                  <div className="flex items-start justify-between py-2">
                    <span className="text-sm text-text-secondary">Trade ID</span>
                    <span className="font-mono text-xs text-text-tertiary break-all text-right max-w-[200px]">
                      {selectedTrade.id}
                    </span>
                  </div>
                </div>
              </div>

              {/* Close Button */}
              <Button
                variant="secondary"
                onClick={() => {
                  setShowTradeDetailModal(false);
                  setSelectedTrade(null);
                }}
                className="w-full mt-2"
              >
                Close
              </Button>
            </div>
          );
        })()}
      </Modal>

      {/* Position Outcome Detail Modal */}
      <Modal
        isOpen={showOutcomeDetailModal}
        onClose={() => {
          setShowOutcomeDetailModal(false);
          setSelectedOutcome(null);
        }}
        title="Position Outcome Details"
        size="md"
      >
        {selectedOutcome && (() => {
          const policy = getPolicyById(selectedOutcome.policyId);
          const market = getMarketById(selectedOutcome.marketId);
          const isProfit = selectedOutcome.profitLoss >= 0;
          const returnPercent = selectedOutcome.investmentCost > 0 
            ? (selectedOutcome.profitLoss / selectedOutcome.investmentCost) * 100 
            : 0;
          
          return (
            <div className="space-y-5">
              {/* Outcome Summary Card */}
              <div className={cn(
                "p-5 rounded-xl",
                selectedOutcome.outcome === 'matured' && "bg-gradient-to-br from-success/10 to-success/5 border border-success/20",
                selectedOutcome.outcome === 'event_triggered' && "bg-gradient-to-br from-error/10 to-error/5 border border-error/20",
                selectedOutcome.outcome === 'active' && "bg-gradient-to-br from-prmx-cyan/10 to-prmx-cyan/5 border border-prmx-cyan/20"
              )}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-14 h-14 rounded-xl flex items-center justify-center shrink-0",
                      selectedOutcome.outcome === 'matured' && "bg-success/20",
                      selectedOutcome.outcome === 'event_triggered' && "bg-error/20",
                      selectedOutcome.outcome === 'active' && "bg-prmx-cyan/20"
                    )}>
                      {selectedOutcome.outcome === 'matured' && <CheckCircle2 className="w-7 h-7 text-success" />}
                      {selectedOutcome.outcome === 'event_triggered' && <XCircle className="w-7 h-7 text-error" />}
                      {selectedOutcome.outcome === 'active' && <Clock className="w-7 h-7 text-prmx-cyan" />}
                    </div>
                    <div>
                      <p className={cn(
                        "text-sm font-medium uppercase tracking-wide",
                        selectedOutcome.outcome === 'matured' && "text-success",
                        selectedOutcome.outcome === 'event_triggered' && "text-error",
                        selectedOutcome.outcome === 'active' && "text-prmx-cyan"
                      )}>
                        {selectedOutcome.outcome === 'matured' && 'Policy Matured'}
                        {selectedOutcome.outcome === 'event_triggered' && 'Rainfall Event'}
                        {selectedOutcome.outcome === 'active' && 'In Progress'}
                      </p>
                      <p className="text-2xl font-bold mt-0.5">
                        {selectedOutcome.sharesHeld} Share{selectedOutcome.sharesHeld !== 1 ? 's' : ''}
                      </p>
                      {selectedOutcome.settledAt && (
                        <p className="text-sm text-text-tertiary mt-1">
                          Settled: {new Date(selectedOutcome.settledAt * 1000).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-text-tertiary">
                      {isProfit ? 'Profit' : 'Loss'}
                    </p>
                    <p className={cn(
                      "text-2xl font-bold",
                      isProfit ? "text-success" : "text-error"
                    )}>
                      {isProfit ? '+' : ''}{selectedOutcome.profitLoss.toFixed(2)} USDT
                    </p>
                    <p className={cn(
                      "text-sm",
                      isProfit ? "text-success/70" : "text-error/70"
                    )}>
                      {isProfit ? '+' : ''}{returnPercent.toFixed(1)}% return
                    </p>
                  </div>
                </div>
              </div>

              {/* Policy & Market Info */}
              {policy && market && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-border-secondary">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center shrink-0">
                        <Shield className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{policy.label || `Policy #${selectedOutcome.policyId}`}</span>
                          <Badge 
                            variant={policy.policyVersion === 'V3' ? 'cyan' : policy.policyVersion === 'V2' ? 'purple' : 'default'} 
                            className="text-xs"
                          >
                            {policy.policyVersion || 'V1'}
                          </Badge>
                        </div>
                        <p className="text-sm text-text-secondary flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {market.name}
                        </p>
                      </div>
                    </div>
                    <Badge 
                      variant={
                        selectedOutcome.outcome === 'matured' ? 'success' : 
                        selectedOutcome.outcome === 'event_triggered' ? 'destructive' : 
                        'default'
                      }
                    >
                      {selectedOutcome.outcome === 'matured' && 'Matured'}
                      {selectedOutcome.outcome === 'event_triggered' && 'Triggered'}
                      {selectedOutcome.outcome === 'active' && 'Active'}
                    </Badge>
                  </div>
                </div>
              )}

              {/* Financial Summary */}
              <div className="space-y-3">
                <p className="text-xs text-text-tertiary uppercase tracking-wide font-medium">Financial Summary</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-background-tertiary/50">
                    <p className="text-xs text-text-tertiary uppercase tracking-wide">Investment</p>
                    <p className="text-lg font-semibold mt-1">
                      ${selectedOutcome.investmentCost.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-background-tertiary/50">
                    <p className="text-xs text-text-tertiary uppercase tracking-wide">Payout Received</p>
                    <p className={cn(
                      "text-lg font-semibold mt-1",
                      selectedOutcome.payoutReceived > 0 ? "text-success" : ""
                    )}>
                      ${selectedOutcome.payoutReceived.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-background-tertiary/50">
                    <p className="text-xs text-text-tertiary uppercase tracking-wide">Shares Held</p>
                    <p className="text-lg font-semibold mt-1">
                      {selectedOutcome.sharesHeld}
                    </p>
                  </div>
                  <div className={cn(
                    "p-3 rounded-xl",
                    isProfit ? "bg-success/10" : "bg-error/10"
                  )}>
                    <p className="text-xs text-text-tertiary uppercase tracking-wide">Net P&L</p>
                    <p className={cn(
                      "text-lg font-semibold mt-1",
                      isProfit ? "text-success" : "text-error"
                    )}>
                      {isProfit ? '+' : ''}${selectedOutcome.profitLoss.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Coverage Info */}
              {policy && (
                <div className="space-y-3">
                  <p className="text-xs text-text-tertiary uppercase tracking-wide font-medium">Coverage Period</p>
                  <div className="p-4 rounded-xl bg-prmx-cyan/5 border border-prmx-cyan/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-text-tertiary">Start</p>
                        <p className="font-medium">{new Date(policy.coverageStart * 1000).toLocaleDateString()}</p>
                      </div>
                      <div className="flex-1 mx-4 h-2 bg-prmx-cyan/20 rounded-full relative overflow-hidden">
                        <div 
                          className="absolute left-0 top-0 h-full bg-prmx-cyan rounded-full"
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-text-tertiary">End</p>
                        <p className="font-medium">{new Date(policy.coverageEnd * 1000).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Outcome Explanation */}
              <div className={cn(
                "p-4 rounded-xl border",
                selectedOutcome.outcome === 'matured' && "bg-success/5 border-success/20",
                selectedOutcome.outcome === 'event_triggered' && "bg-error/5 border-error/20",
                selectedOutcome.outcome === 'active' && "bg-prmx-cyan/5 border-prmx-cyan/20"
              )}>
                <p className="text-sm">
                  {selectedOutcome.outcome === 'matured' && (
                    <>
                      <span className="font-medium text-success">No rainfall event occurred.</span> The policy matured without triggering, and you received a payout of ${selectedOutcome.payoutReceived.toFixed(2)} for your {selectedOutcome.sharesHeld} share{selectedOutcome.sharesHeld !== 1 ? 's' : ''}.
                    </>
                  )}
                  {selectedOutcome.outcome === 'event_triggered' && (
                    <>
                      <span className="font-medium text-error">A rainfall event was triggered.</span> The threshold was exceeded, resulting in a payout to the policyholder. Your LP investment of ${selectedOutcome.investmentCost.toFixed(2)} was used to cover the claim.
                    </>
                  )}
                  {selectedOutcome.outcome === 'active' && (
                    <>
                      <span className="font-medium text-prmx-cyan">This position is still active.</span> The policy has not yet matured. Your potential outcome depends on whether a rainfall event occurs before the coverage period ends.
                    </>
                  )}
                </p>
              </div>

              {/* Close Button */}
              <Button
                variant="secondary"
                onClick={() => {
                  setShowOutcomeDetailModal(false);
                  setSelectedOutcome(null);
                }}
                className="w-full mt-2"
              >
                Close
              </Button>
            </div>
          );
        })()}
      </Modal>

      {/* Order Detail Modal */}
      <Modal
        isOpen={showOrderDetailModal}
        onClose={() => {
          setShowOrderDetailModal(false);
          setSelectedOrderForDetail(null);
        }}
        title="Order Details"
        size="md"
      >
        {selectedOrderForDetail && (() => {
          const order = selectedOrderForDetail;
          const policy = getPolicyById(order.policyId);
          const market = policy ? getMarketById(policy.marketId) : null;
          const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
          const isV3 = policy?.policyVersion === 'V3';
          // For V3, use the policy's payout ($100/share = 100_000_000)
          const payoutPerShare = isV3 ? BigInt(100_000_000) : (market?.payoutPerShare || BigInt(100_000_000));
          const potentialReturn = calculatePotentialReturn(order.priceUsdt, payoutPerShare);
          const isOwner = isSameAddress(order.seller, selectedAccount?.address);
          const totalValue = order.remaining * order.priceUsdt;
          const sellerInfo = api.getAccountByAddress(order.seller);
          // Get location name for V3
          const locationName = isV3 ? (policy?.label?.split(' - ')[0] || 'Unknown Location') : market?.name;
          
          return (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-prmx-gradient/10 border border-prmx-cyan/20">
                <div className="w-14 h-14 rounded-xl bg-prmx-gradient flex items-center justify-center shrink-0">
                  <Shield className="w-7 h-7 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xl font-bold">{policy?.label || `Policy #${order.policyId}`}</h3>
                    <Badge 
                      variant={isV3 ? 'cyan' : policy?.policyVersion === 'V2' ? 'purple' : 'default'} 
                      className="text-xs"
                    >
                      {policy?.policyVersion || 'V1'}
                    </Badge>
                    <Badge variant="error" className="text-xs">Sell Order</Badge>
                    {isOwner && <Badge variant="success" className="text-xs">Your Order</Badge>}
                  </div>
                  <p className="text-sm text-text-secondary flex items-center gap-1 mt-1">
                    <MapPin className="w-3 h-3" />
                    {locationName || 'Unknown'}
                  </p>
                </div>
              </div>

              {/* Price & Value */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-background-tertiary/50">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-5 h-5 text-success" />
                    <span className="text-sm text-text-secondary">Price per Share</span>
                  </div>
                  <div className="text-2xl font-bold text-success">{formatUSDT(order.priceUsdt)}</div>
                </div>
                <div className="p-4 rounded-xl bg-background-tertiary/50">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-5 h-5 text-prmx-cyan" />
                    <span className="text-sm text-text-secondary">Total Value</span>
                  </div>
                  <div className="text-2xl font-bold text-prmx-cyan">{formatUSDT(totalValue)}</div>
                </div>
              </div>

              {/* Order Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-background-tertiary/50">
                  <p className="text-xs text-text-tertiary">Shares Available</p>
                  <p className="text-lg font-semibold mt-1">{order.remaining.toString()}</p>
                </div>
                <div className="p-3 rounded-xl bg-background-tertiary/50">
                  <p className="text-xs text-text-tertiary">Original Quantity</p>
                  <p className="text-lg font-semibold mt-1">{order.quantity.toString()}</p>
                </div>
                <div className="p-3 rounded-xl bg-background-tertiary/50">
                  <p className="text-xs text-text-tertiary">Time Remaining</p>
                  <p className={cn(
                    "text-lg font-semibold mt-1 flex items-center gap-1.5",
                    daysRemaining <= 3 ? "text-warning" : ""
                  )}>
                    <Clock className="w-4 h-4" />
                    {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-background-tertiary/50">
                  <p className="text-xs text-text-tertiary">Potential Return</p>
                  <p className={cn(
                    "text-lg font-semibold mt-1 flex items-center gap-1.5",
                    potentialReturn >= 50 ? "text-success" : "text-prmx-cyan"
                  )}>
                    <TrendingUp className="w-4 h-4" />
                    +{potentialReturn.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Seller Info */}
              <div className="p-4 rounded-xl bg-background-tertiary/30 border border-border-secondary">
                <p className="text-xs text-text-tertiary uppercase tracking-wide mb-2">Seller</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-prmx-gradient flex items-center justify-center">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">
                      {isOwner ? (
                        <span className="text-prmx-cyan">You</span>
                      ) : (
                        sellerInfo?.name || 'Unknown'
                      )}
                    </p>
                    <p className="text-xs text-text-tertiary font-mono truncate">{formatAddress(order.seller)}</p>
                  </div>
                  {sellerInfo && !isOwner && (
                    <Badge variant="default" className="text-xs shrink-0">{sellerInfo.role}</Badge>
                  )}
                </div>
              </div>

              {/* Coverage Period */}
              {policy && (
                <div className="p-4 rounded-xl bg-prmx-cyan/5 border border-prmx-cyan/20">
                  <p className="text-xs text-text-tertiary uppercase tracking-wide mb-3">Coverage Period</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-text-tertiary">Start</p>
                      <p className="font-medium">{new Date(policy.coverageStart * 1000).toLocaleDateString()}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-text-tertiary" />
                    <div className="text-right">
                      <p className="text-xs text-text-tertiary">End</p>
                      <p className="font-medium">{new Date(policy.coverageEnd * 1000).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Order ID */}
              <div className="p-3 rounded-xl bg-background-tertiary/30 border border-border-secondary">
                <p className="text-xs text-text-tertiary">Order ID</p>
                <p className="font-mono text-sm mt-0.5">{order.orderId}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                {isOwner ? (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setShowOrderDetailModal(false);
                      handleCancelOrder(order.orderId);
                    }}
                    loading={cancellingOrderId === order.orderId}
                    className="flex-1"
                  >
                    Cancel Order
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setShowOrderDetailModal(false);
                      handleOpenBuyModal(order);
                    }}
                    className="flex-1"
                  >
                    Buy Shares
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowOrderDetailModal(false);
                    setSelectedOrderForDetail(null);
                  }}
                  className="flex-1"
                >
                  Close
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
