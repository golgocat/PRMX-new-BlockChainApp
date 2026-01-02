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
import { formatThresholdValue } from '@/types/v3';
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
    // V3-specific: event spec for threshold display
    eventSpec: v3Policy.eventSpec,
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
  const [policyDefiInfoMap, setPolicyDefiInfoMap] = useState<Map<string, PolicyDefiInfo>>(new Map());
  
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
      const newMap = new Map<string, PolicyDefiInfo>();
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

  const handleCancelOrder = async (orderId: number, sellerAddress?: string) => {
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    setCancellingOrderId(orderId);
    try {
      // Check if this is a DAO Capital order and the current user is DAO Admin
      const isDaoOrder = sellerAddress && api.isDaoCapitalAccount(sellerAddress);
      const isDaoAdmin = selectedAccount?.role === 'DAO Admin';
      
      if (isDaoOrder && isDaoAdmin) {
        // Use sudo to cancel DAO Capital orders
        await api.cancelLpAskAsDao(keypair, orderId);
        toast.success('DAO order cancelled successfully');
      } else {
        // Regular cancel for own orders
        await api.cancelLpAsk(keypair, orderId);
        toast.success('Order cancelled successfully');
      }
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
            {/* Portfolio Header - Sleek design */}
            <div className="flex items-center justify-between px-5 py-4 rounded-xl bg-background-secondary/50 border border-border-primary/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-prmx-cyan" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-text-primary">My LP Holdings</h2>
                  <p className="text-xs text-text-tertiary">
                    {holdings.filter(h => h.shares > 0).length} position{holdings.filter(h => h.shares > 0).length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-text-tertiary uppercase tracking-wider">Balance</p>
                <p className="text-xl font-bold text-prmx-cyan">
                  {usdtFormatted}
                </p>
              </div>
            </div>

            {/* Solvency Warning - Sleek design */}
            {solvencyInfo && !solvencyInfo.isSolvent && holdings.filter(h => h.shares > 0).length > 0 && (
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <span className="font-medium">Solvency alert:</span> DAO coverage may be limited
                </p>
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
              <Card className="overflow-hidden">
                <CardContent className="text-center py-12">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-text-tertiary" />
                  </div>
                  <h3 className="text-base font-semibold text-text-primary mb-1">No LP Holdings</h3>
                  <p className="text-sm text-text-tertiary max-w-sm mx-auto">
                    Start earning from premiums via the orderbook
                  </p>
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
                  <div className="w-[100px] text-center flex-shrink-0">Status</div>
                  <div className="w-[80px] flex-shrink-0"></div>
                </div>
                
                {/* List Items */}
                <div className="divide-y divide-border-secondary">
                  {holdings.filter(h => h.shares > 0).map((holding, index) => {
                    const policyVersionHint = (holding as any)._policyVersion as 'V1V2' | 'V3' | undefined;
                    const isDaoHolding = (holding as any)._isDaoHolding === true;
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
                                {isDaoHolding && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-prmx-purple/20 text-prmx-purple-light">
                                    DAO
                                  </span>
                                )}
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
                          <div className="w-[100px] flex-shrink-0 text-center">
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
                          </div>
                          
                          {/* Action */}
                          <div className="w-[80px] flex-shrink-0 flex items-center justify-end gap-1 text-text-tertiary group-hover:text-prmx-cyan transition-colors">
                            <span className="text-xs font-medium">Details</span>
                            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-all" />
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
          <Card className="overflow-hidden">
            <CardHeader className="p-0 border-b border-border-primary/50">
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-prmx-cyan" />
                    </div>
                    <h3 className="text-base font-semibold">LP Orderbook</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasActiveFilters && (
                      <span className="text-xs text-text-tertiary">{filteredOrders.length} of {orders.length}</span>
                    )}
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-prmx-cyan/10 text-prmx-cyan">
                      {orders.length} orders
                    </span>
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
                <div className="mt-4 p-4 rounded-lg bg-background-tertiary/30 border border-border-primary/30">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Market</label>
                      <select
                        value={filterMarket}
                        onChange={(e) => setFilterMarket(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm rounded-lg bg-background-secondary border border-border-primary/50 text-text-primary focus:outline-none focus:ring-1 focus:ring-prmx-cyan/50"
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
                    <div>
                      <label className="block text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Min Return %</label>
                      <input
                        type="number"
                        placeholder="e.g. 10"
                        value={filterMinReturn}
                        onChange={(e) => setFilterMinReturn(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm rounded-lg bg-background-secondary border border-border-primary/50 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-prmx-cyan/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Max Price ($)</label>
                      <input
                        type="number"
                        placeholder="e.g. 90"
                        value={filterMaxPrice}
                        onChange={(e) => setFilterMaxPrice(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm rounded-lg bg-background-secondary border border-border-primary/50 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-prmx-cyan/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Min Days Left</label>
                      <input
                        type="number"
                        placeholder="e.g. 7"
                        value={filterMinDays}
                        onChange={(e) => setFilterMinDays(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm rounded-lg bg-background-secondary border border-border-primary/50 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-prmx-cyan/50"
                      />
                    </div>
                  </div>
                </div>
              )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {ordersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-text-tertiary" />
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-text-tertiary" />
                  </div>
                  <p className="text-sm text-text-secondary">No orders yet</p>
                  <p className="text-xs text-text-tertiary mt-0.5">Be the first to place an order</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                    <Filter className="w-5 h-5 text-text-tertiary" />
                  </div>
                  <p className="text-sm text-text-secondary">No matching orders</p>
                  <Button variant="secondary" size="sm" onClick={clearFilters} className="mt-2">
                    Clear Filters
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border-secondary">
                  {filteredOrders.map((order) => {
                    const isOwner = isSameAddress(order.seller, selectedAccount?.address);
                    const isDaoOrder = api.isDaoCapitalAccount(order.seller);
                    const isDaoAdmin = selectedAccount?.role === 'DAO Admin';
                    const canCancel = isOwner || (isDaoOrder && isDaoAdmin);
                    const total = order.remaining * order.priceUsdt;
                    const policy = getPolicyById(order.policyId);
                    const market = policy ? getMarketById(policy.marketId) : null;
                    const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
                    const potentialReturn = market ? calculatePotentialReturn(order.priceUsdt, market.payoutPerShare) : 0;
                    
                    // Format short policy ID
                    const shortId = typeof order.policyId === 'string' && order.policyId.startsWith('0x') 
                      ? order.policyId.slice(2, 10) 
                      : String(order.policyId).slice(0, 8);
                    const locationName = market?.name || (policy as any)?.locationName || 'Unknown';
                    
                    return (
                      <div 
                        key={order.orderId} 
                        onClick={() => {
                          setSelectedOrderForDetail(order);
                          setShowOrderDetailModal(true);
                        }}
                        className={cn(
                          "group py-3 px-4 hover:bg-background-tertiary/30 transition-colors cursor-pointer",
                          isOwner && "bg-prmx-cyan/5",
                          isDaoOrder && isDaoAdmin && !isOwner && "bg-prmx-purple/5"
                        )}>
                        {/* Main Row - Compact layout */}
                        <div className="flex items-center gap-3">
                          {/* Policy Icon */}
                          <div className="w-10 h-10 rounded-lg bg-prmx-cyan/10 flex items-center justify-center flex-shrink-0">
                            <Shield className="w-5 h-5 text-prmx-cyan" />
                          </div>
                          
                          {/* Policy Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-sm truncate max-w-[180px]">
                                {shortId}...
                              </span>
                              <span className={cn(
                                "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                                policy?.policyVersion === 'V3' ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" 
                                  : policy?.policyVersion === 'V2' ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                              )}>
                                {policy?.policyVersion || 'V1'}
                              </span>
                              {isOwner && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-prmx-cyan/10 text-prmx-cyan uppercase">
                                  Yours
                                </span>
                              )}
                              {isDaoOrder && !isOwner && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-prmx-purple/10 text-prmx-purple uppercase">
                                  DAO
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-text-tertiary">
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {locationName}
                              </span>
                              <span>•</span>
                              <span>{order.remaining.toString()} shares</span>
                              <span>•</span>
                              <span className={cn(daysRemaining <= 3 && daysRemaining > 0 && "text-amber-500")}>
                                {daysRemaining > 0 ? `${daysRemaining}d left` : 'Ended'}
                              </span>
                            </div>
                          </div>
                          
                          {/* Price & Return */}
                          <div className="text-right flex-shrink-0">
                            <p className="text-lg font-bold text-text-primary">{formatUSDT(order.priceUsdt)}</p>
                            <p className="text-xs text-text-tertiary">
                              {market && potentialReturn > 0 ? (
                                <span className={cn("font-medium", potentialReturn >= 50 ? "text-emerald-500" : "text-prmx-cyan")}>
                                  +{potentialReturn.toFixed(1)}% return
                                </span>
                              ) : (
                                <span>per share</span>
                              )}
                            </p>
                          </div>
                          
                          {/* Action */}
                          <div className="flex-shrink-0 ml-2">
                            {canCancel ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelOrder(order.orderId, order.seller);
                                }}
                                disabled={cancellingOrderId !== null}
                                className="text-xs font-medium text-rose-500 hover:text-rose-600 disabled:opacity-50"
                              >
                                {cancellingOrderId === order.orderId ? '...' : 'Cancel'}
                              </button>
                            ) : (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenBuyModal(order);
                                }}
                              >
                                Buy
                              </Button>
                            )}
                          </div>
                          
                          {/* Chevron */}
                          <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-cyan group-hover:translate-x-0.5 transition-all flex-shrink-0" />
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
            {/* Trade History Section - Sleek design */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                        <History className="w-4 h-4 text-prmx-cyan" />
                      </div>
                      <h3 className="text-base font-semibold">Trade History</h3>
                    </div>
                    {trades.length > 0 && (
                      <button
                        onClick={() => {
                          if (confirm('Clear all trade history?')) {
                            clearHistory();
                            toast.success('Trade history cleared');
                          }
                        }}
                        className="text-xs text-text-tertiary hover:text-error transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="p-5">
                  {tradesLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <RefreshCw className="w-5 h-5 animate-spin text-text-tertiary" />
                    </div>
                  ) : trades.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                        <History className="w-5 h-5 text-text-tertiary" />
                      </div>
                      <p className="text-sm text-text-secondary">No trades yet</p>
                      <p className="text-xs text-text-tertiary mt-0.5">Your orders will appear here</p>
                    </div>
                  )                 : (
                    <div className="space-y-2">
                      {trades.map((trade) => (
                        <div
                          key={trade.id}
                          onClick={() => {
                            setSelectedTrade(trade);
                            setShowTradeDetailModal(true);
                          }}
                          className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-background-tertiary/30 transition-colors cursor-pointer group"
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center",
                              trade.type === 'buy' ? "bg-emerald-500/10" : "bg-rose-500/10"
                            )}>
                              {trade.type === 'buy' ? (
                                <ArrowDownRight className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <ArrowUpRight className="w-4 h-4 text-rose-500" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "text-sm font-medium",
                                  trade.type === 'buy' ? "text-emerald-500" : "text-rose-500"
                                )}>
                                  {trade.type === 'buy' ? 'Bought' : 'Sold'}
                                </span>
                                <span className="text-sm text-text-primary">
                                  {trade.shares} share{trade.shares > 1 ? 's' : ''}
                                </span>
                              </div>
                              <p className="text-xs text-text-tertiary">
                                {trade.marketName}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">${trade.totalAmount.toFixed(2)}</p>
                            <p className="text-xs text-text-tertiary">
                              {new Date(trade.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Position Outcomes Section - Sleek design */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-prmx-purple/10 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-prmx-purple" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold">Position Outcomes</h3>
                      <p className="text-xs text-text-tertiary">Final outcomes of settled positions</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-5">
                  {outcomesLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <RefreshCw className="w-5 h-5 animate-spin text-text-tertiary" />
                    </div>
                  ) : outcomes.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                        <Shield className="w-5 h-5 text-text-tertiary" />
                      </div>
                      <p className="text-sm text-text-secondary">No position history</p>
                      <p className="text-xs text-text-tertiary mt-0.5">Settled outcomes appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {outcomes.map((outcome) => (
                        <div
                          key={outcome.policyId}
                          onClick={() => {
                            setSelectedOutcome(outcome);
                            setShowOutcomeDetailModal(true);
                          }}
                          className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-background-tertiary/30 transition-colors cursor-pointer group"
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center",
                              outcome.outcome === 'matured' && "bg-emerald-500/10",
                              outcome.outcome === 'event_triggered' && "bg-rose-500/10",
                              outcome.outcome === 'active' && "bg-prmx-cyan/10"
                            )}>
                              {outcome.outcome === 'matured' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                              {outcome.outcome === 'event_triggered' && <XCircle className="w-4 h-4 text-rose-500" />}
                              {outcome.outcome === 'active' && <Clock className="w-4 h-4 text-prmx-cyan" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{outcome.marketName}</span>
                                <span className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                  outcome.outcome === 'matured' && "bg-emerald-500/10 text-emerald-500",
                                  outcome.outcome === 'event_triggered' && "bg-rose-500/10 text-rose-500",
                                  outcome.outcome === 'active' && "bg-prmx-cyan/10 text-prmx-cyan"
                                )}>
                                  {outcome.outcome === 'matured' && 'Matured'}
                                  {outcome.outcome === 'event_triggered' && 'Triggered'}
                                  {outcome.outcome === 'active' && 'Active'}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-text-tertiary mt-0.5">
                                <span>{outcome.sharesHeld} shares</span>
                                <span>•</span>
                                <span>${outcome.investmentCost.toFixed(0)} invested</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={cn(
                              "text-sm font-bold",
                              outcome.profitLoss >= 0 ? "text-emerald-500" : "text-rose-500"
                            )}>
                              {outcome.profitLoss >= 0 ? '+' : ''}{outcome.profitLoss.toFixed(2)}
                            </p>
                            {outcome.settledAt && (
                              <p className="text-xs text-text-tertiary">
                                {new Date(outcome.settledAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Summary Stats - Sleek design */}
            {outcomes.length > 0 && (
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="px-5 py-4 border-b border-border-primary/50">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-violet-500" />
                      </div>
                      <h4 className="text-base font-semibold">Performance Summary</h4>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 divide-x divide-border-primary/30">
                    <div className="px-5 py-4 text-center">
                      <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Positions</p>
                      <p className="text-lg font-bold">{outcomes.length}</p>
                    </div>
                    <div className="px-5 py-4 text-center">
                      <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Matured</p>
                      <p className="text-lg font-bold text-emerald-500">
                        {outcomes.filter(o => o.outcome === 'matured').length}
                      </p>
                    </div>
                    <div className="px-5 py-4 text-center">
                      <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Triggered</p>
                      <p className="text-lg font-bold text-rose-500">
                        {outcomes.filter(o => o.outcome === 'event_triggered').length}
                      </p>
                    </div>
                    <div className="px-5 py-4 text-center">
                      <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Total P&L</p>
                      <p className={cn(
                        "text-lg font-bold",
                        outcomes.reduce((sum, o) => sum + o.profitLoss, 0) >= 0 
                          ? "text-emerald-500" 
                          : "text-rose-500"
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
            {/* Header - Clean design */}
            <div className="flex items-center gap-3 pb-4 border-b border-border-primary/30">
              <div className="w-10 h-10 rounded-lg bg-prmx-purple/10 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-prmx-purple" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold truncate">{selectedPolicy.label}</p>
                {market && <p className="text-xs text-text-tertiary">{market.name}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-text-tertiary">Your Shares</p>
                <p className="text-lg font-bold text-prmx-purple">{myShares}</p>
              </div>
            </div>

            {/* Policy Info - Compact rows */}
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Time Remaining</span>
                <span className={cn(
                  "text-sm font-semibold",
                  daysRemaining <= 3 ? "text-amber-500" : "text-text-primary"
                )}>
                  {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                </span>
              </div>
              {market && (
                <>
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                    <span className="text-sm text-text-secondary">Strike Threshold</span>
                    <span className="text-sm font-medium">{market.strikeValue} mm</span>
                  </div>
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                    <span className="text-sm text-text-secondary">Max Payout/Share</span>
                    <span className="text-sm font-semibold text-emerald-500">{maxPayout}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Fair Value</span>
                <span className="text-sm font-medium">${fairValuePerShare.toFixed(2)}/share</span>
              </div>
            </div>

            {/* Pricing Hint */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-background-tertiary/30">
              <Info className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-text-tertiary leading-relaxed">
                Price lower if event is likely (LP tokens lose value), higher if unlikely.
              </p>
            </div>

            {/* Input Fields */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Quantity"
                type="number"
                min="1"
                max={myShares}
                value={sellQuantity}
                onChange={(e) => setSellQuantity(e.target.value)}
              />
              <Input
                label="Price (USDT)"
                type="number"
                step="0.01"
                min="0.01"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder={`~$${fairValuePerShare.toFixed(2)}`}
              />
            </div>

            {/* Total Value - Clean summary */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/5">
              <span className="text-sm text-text-secondary">Total Sale Value</span>
              <div className="text-right">
                <p className="text-xl font-bold text-emerald-500">${totalValue.toFixed(2)}</p>
                {parseFloat(sellPrice || '0') > 0 && fairValuePerShare > 0 && (
                  <p className="text-[10px] text-text-tertiary">
                    {parseFloat(sellPrice) > fairValuePerShare 
                      ? `${((parseFloat(sellPrice) / fairValuePerShare - 1) * 100).toFixed(0)}% above fair value`
                      : parseFloat(sellPrice) < fairValuePerShare
                      ? `${((1 - parseFloat(sellPrice) / fairValuePerShare) * 100).toFixed(0)}% below fair value`
                      : 'At fair value'}
                  </p>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
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
            {/* Header - Clean design */}
            <div className="flex items-center gap-3 pb-4 border-b border-border-primary/30">
              <div className="w-10 h-10 rounded-lg bg-prmx-cyan/10 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-prmx-cyan" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                    policy?.policyVersion === 'V3' ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" 
                      : policy?.policyVersion === 'V2' ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                  )}>
                    {policy?.policyVersion || 'V1'}
                  </span>
                </div>
                <p className="text-base font-semibold truncate">{policy?.label || `Policy #${selectedOrder.policyId}`}</p>
                {market && <p className="text-xs text-text-tertiary">{market.name}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-text-tertiary">Price/Share</p>
                <p className="text-lg font-bold text-prmx-cyan">{formatUSDT(selectedOrder.priceUsdt)}</p>
              </div>
            </div>

            {/* Order & Policy Info - Compact rows */}
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Available</span>
                <span className="text-sm font-semibold">{selectedOrder.remaining.toString()} shares</span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Time Remaining</span>
                <span className={cn(
                  "text-sm font-semibold",
                  daysRemaining <= 3 ? "text-amber-500" : "text-text-primary"
                )}>
                  {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                </span>
              </div>
              {market && (
                <>
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                    <span className="text-sm text-text-secondary">Strike</span>
                    <span className="text-sm font-medium">{market.strikeValue} mm</span>
                  </div>
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                    <span className="text-sm text-text-secondary">Max Payout</span>
                    <span className="text-sm font-semibold text-emerald-500">{maxPayout}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Seller</span>
                <code className="text-xs font-mono text-text-secondary">{formatAddress(selectedOrder.seller)}</code>
              </div>
            </div>

            {/* Potential Return - Compact */}
            {market && potentialReturn > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary/30">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm text-text-secondary">If no event</span>
                </div>
                <span className="text-sm font-bold text-emerald-500">+{potentialReturn.toFixed(1)}% return</span>
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

            {/* Cost Summary - Clean */}
            <div className="space-y-2 p-3 rounded-lg bg-prmx-cyan/5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Total Cost</span>
                <span className="text-xl font-bold">{formatUSDT(totalCost)}</span>
              </div>
              {market && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Value if No Event</span>
                  <span className="text-sm font-semibold text-emerald-500">{formatUSDT(totalPotentialPayout)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-border-primary/20">
                <span className="text-xs text-text-tertiary">Your Balance</span>
                <span className={cn("text-sm font-medium", usdtBalance >= totalCost ? 'text-emerald-500' : 'text-rose-500')}>
                  {usdtFormatted}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
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
          const isDaoHolding = holding ? (holding as any)._isDaoHolding === true : false;
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
          <div className="space-y-4">
            {/* Header - Clean design */}
            <div className="flex items-center gap-3 pb-4 border-b border-border-primary/30">
              <div className="w-12 h-12 rounded-lg bg-prmx-cyan/10 flex items-center justify-center shrink-0">
                <Shield className="w-6 h-6 text-prmx-cyan" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                    policy?.policyVersion === 'V3' ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" 
                      : policy?.policyVersion === 'V2' ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                  )}>
                    {policy?.policyVersion || 'V1'}
                  </span>
                  {isDaoHolding && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-prmx-purple/20 text-prmx-purple-light">
                      DAO
                    </span>
                  )}
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                    isEnded ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                      : isExpiringSoon ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                  )}>
                    {isEnded ? 'Ended' : `${daysRemaining}d left`}
                  </span>
                </div>
                <p className="text-base font-semibold truncate">{policy?.label || displayId}</p>
                {market && <p className="text-xs text-text-tertiary flex items-center gap-1"><MapPin className="w-3 h-3" />{market.name}</p>}
              </div>
            </div>

            {/* Key Stats - Side by side */}
            <div className="flex gap-3">
              <div className="flex-1 p-3 rounded-lg bg-background-tertiary/30">
                <p className="text-xs text-text-tertiary mb-1">{isDaoHolding ? 'DAO Shares' : 'Your Shares'}</p>
                <p className="text-2xl font-bold text-text-primary">{holding.shares.toString()}</p>
                <p className="text-[10px] text-text-tertiary">{ownershipPercent.toFixed(1)}% of pool</p>
              </div>
              <div className="flex-1 p-3 rounded-lg bg-emerald-500/5">
                <p className="text-xs text-text-tertiary mb-1">Max Payout</p>
                <p className="text-2xl font-bold text-emerald-500">{formatUSDT(potentialPayout)}</p>
                <p className="text-[10px] text-text-tertiary">if no event</p>
              </div>
            </div>

            {/* Details - Compact rows */}
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Per Share</span>
                <span className="text-sm font-semibold">{market?.payoutPerShare ? formatUSDT(market.payoutPerShare) : '$100'}</span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Strike</span>
                <span className="text-sm font-medium">
                  {(policy as any)?.eventSpec 
                    ? formatThresholdValue((policy as any).eventSpec.threshold.value, (policy as any).eventSpec.threshold.unit)
                    : `${market?.strikeValue || 50} mm`
                  }
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Total Pool</span>
                <span className="text-sm font-medium">{totalShares} shares</span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Coverage</span>
                <span className="text-sm">
                  {policy?.coverageStart ? new Date(policy.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  {' → '}
                  {policy?.coverageEnd ? new Date(policy.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </span>
              </div>
            </div>

            {/* Share Management - Compact */}
            <div className="pt-3 border-t border-border-primary/30 space-y-2">
              <p className="text-xs text-text-tertiary uppercase tracking-wide mb-2">Share Management</p>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Owned</span>
                <span className="text-sm font-semibold">{holding.shares.toString()}</span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Locked in Orders</span>
                <span className="text-sm font-semibold text-amber-500">{holding.lockedShares.toString()}</span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                <span className="text-sm text-text-secondary">Available to Sell</span>
                <span className="text-sm font-semibold text-emerald-500">{availableShares.toString()}</span>
              </div>
            </div>

            {/* Active Orders */}
            {myOrdersForPolicy.length > 0 && (
              <div className="pt-3 border-t border-border-primary/30">
                <p className="text-xs text-amber-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Active Sell Orders
                </p>
                <div className="space-y-2">
                  {myOrdersForPolicy.map(order => (
                    <div key={order.orderId} className="flex justify-between items-center py-2 px-3 rounded-lg bg-amber-500/5">
                      <span className="text-sm">
                        <span className="font-medium">{order.remaining.toString()}</span>
                        <span className="text-text-tertiary"> @ </span>
                        <span className="font-medium text-emerald-500">{formatUSDT(order.priceUsdt)}</span>
                      </span>
                      <button
                        onClick={() => {
                          setShowHoldingModal(false);
                          handleCancelOrder(order.orderId, order.seller);
                        }}
                        className="text-xs text-rose-500 hover:text-rose-600 font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DeFi Status */}
            {(() => {
              const defiInfo = policyDefiInfoMap.get(selectedHoldingPolicyId);
              if (!defiInfo?.isAllocatedToDefi) return null;
              
              return (
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-purple-500/5">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-purple-500" />
                    <span className="text-sm text-text-secondary">Earning Yield</span>
                  </div>
                  <span className="text-sm font-bold text-purple-500">
                    {defiInfo.position ? formatUSDT(defiInfo.position.principalUsdt) : '$0'}
                  </span>
                </div>
              );
            })()}

            {/* Risk Notice - Minimal */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-text-tertiary">
                <span className="text-rose-500 font-medium">Risk:</span>{' '}
                {policy?.policyVersion === 'V3' && (policy as any)?.eventSpec
                  ? `${(policy as any).eventSpec.eventType.replace(/([A-Z])/g, ' $1').trim()} > ${formatThresholdValue((policy as any).eventSpec.threshold.value, (policy as any).eventSpec.threshold.unit)} triggers payout.`
                  : policy?.policyVersion === 'V2' 
                    ? `Cumulative rainfall > ${market?.strikeValue || 50}mm triggers payout.`
                    : `24h rainfall > ${market?.strikeValue || 50}mm triggers payout.`
                }
              </p>
            </div>

            {/* Actions */}
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
            <div className="space-y-4">
              {/* Trade Summary - Clean header */}
              <div className="flex items-center gap-3 pb-4 border-b border-border-primary/30">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  selectedTrade.type === 'buy' ? "bg-emerald-500/10" : "bg-rose-500/10"
                )}>
                  {selectedTrade.type === 'buy' ? (
                    <ArrowDownRight className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <ArrowUpRight className="w-5 h-5 text-rose-500" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                      selectedTrade.type === 'buy' 
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                    )}>
                      {selectedTrade.type === 'buy' ? 'Bought' : 'Sold'}
                    </span>
                    <span className="text-base font-semibold">
                      {selectedTrade.shares} Share{selectedTrade.shares > 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {new Date(selectedTrade.timestamp).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold">${selectedTrade.totalAmount.toFixed(2)}</p>
                  <p className="text-xs text-text-tertiary">@ ${selectedTrade.pricePerShare.toFixed(2)}/share</p>
                </div>
              </div>

              {/* Policy Info - Compact */}
              {policy && market && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4 text-prmx-cyan" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                          policy.policyVersion === 'V3' ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" 
                            : policy.policyVersion === 'V2' ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                        )}>
                          {policy.policyVersion || 'V1'}
                        </span>
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                          policy.status === 'Active' 
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                        )}>
                          {policy.status}
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate mt-0.5">{policy.label || `Policy #${selectedTrade.policyId}`}</p>
                    </div>
                  </div>
                  
                  {/* Key Metrics - Row layout */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                      <span className="text-sm text-text-secondary">Location</span>
                      <span className="text-sm font-medium flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-text-tertiary" />
                        {market.name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                      <span className="text-sm text-text-secondary">Strike</span>
                      <span className="text-sm font-medium">
                        {policy.strikeMm ? `${policy.strikeMm / 10}mm` : `${market.strikeValue}mm`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                      <span className="text-sm text-text-secondary">Max Payout</span>
                      <span className="text-sm font-semibold text-emerald-500">{formatUSDT(market.payoutPerShare)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                      <span className="text-sm text-text-secondary">Time Left</span>
                      <span className={cn(
                        "text-sm font-medium",
                        daysRemaining <= 3 ? "text-amber-500" : ""
                      )}>
                        {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Transaction Info - Compact footer */}
              <div className="pt-3 border-t border-border-primary/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Your Account</span>
                  <code className="text-xs font-mono text-text-secondary">{formatAddress(selectedTrade.trader)}</code>
                </div>
                {selectedTrade.counterparty && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">Counterparty</span>
                    <code className="text-xs font-mono text-text-secondary">{selectedTrade.counterparty}</code>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Trade ID</span>
                  <code className="text-[10px] font-mono text-text-tertiary truncate max-w-[180px]">{selectedTrade.id}</code>
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
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 border border-prmx-cyan/30 flex items-center justify-center shrink-0">
                        <Shield className="w-5 h-5 text-prmx-cyan" />
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
          const isDaoOrder = api.isDaoCapitalAccount(order.seller);
          const isDaoAdmin = selectedAccount?.role === 'DAO Admin';
          const canCancel = isOwner || (isDaoOrder && isDaoAdmin);
          const totalValue = order.remaining * order.priceUsdt;
          const sellerInfo = api.getAccountByAddress(order.seller);
          
          // Get location name properly
          const locationName = isV3 
            ? ((policy as any)?.locationName || (policy as any)?.location?.name || 'V3 Policy')
            : market?.name;
          
          // Format short policy ID for display
          const shortId = typeof order.policyId === 'string' && order.policyId.startsWith('0x')
            ? order.policyId.slice(2, 10)
            : String(order.policyId).slice(0, 8);
          
          return (
            <div className="space-y-4">
              {/* Header - Clean design */}
              <div className="flex items-center gap-3 pb-4 border-b border-border-primary/30">
                <div className="w-12 h-12 rounded-lg bg-prmx-cyan/10 flex items-center justify-center shrink-0">
                  <Shield className="w-6 h-6 text-prmx-cyan" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                      isV3 ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" 
                        : policy?.policyVersion === 'V2' ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                    )}>
                      {policy?.policyVersion || 'V1'}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 uppercase">
                      Sell
                    </span>
                    {isOwner && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 uppercase">
                        Your Order
                      </span>
                    )}
                    {isDaoOrder && !isOwner && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-prmx-purple/10 text-prmx-purple uppercase">
                        DAO Order
                      </span>
                    )}
                  </div>
                  <p className="text-base font-semibold">
                    {locationName || 'Unknown Location'}
                  </p>
                  <p className="text-xs text-text-tertiary font-mono mt-0.5">
                    {shortId}...
                  </p>
                </div>
              </div>

              {/* Price & Value - Side by side compact */}
              <div className="flex gap-3">
                <div className="flex-1 p-3 rounded-lg bg-background-tertiary/30">
                  <p className="text-xs text-text-tertiary mb-1">Price per Share</p>
                  <p className="text-xl font-bold text-emerald-500">{formatUSDT(order.priceUsdt)}</p>
                </div>
                <div className="flex-1 p-3 rounded-lg bg-background-tertiary/30">
                  <p className="text-xs text-text-tertiary mb-1">Total Value</p>
                  <p className="text-xl font-bold text-prmx-cyan">{formatUSDT(totalValue)}</p>
                </div>
              </div>

              {/* Order Info Grid - Compact rows */}
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                  <span className="text-sm text-text-secondary">Shares Available</span>
                  <span className="text-sm font-semibold">{order.remaining.toString()}</span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                  <span className="text-sm text-text-secondary">Original Quantity</span>
                  <span className="text-sm font-semibold">{order.quantity.toString()}</span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                  <span className="text-sm text-text-secondary">Time Remaining</span>
                  <span className={cn(
                    "text-sm font-semibold flex items-center gap-1",
                    daysRemaining <= 3 ? "text-amber-500" : "text-text-primary"
                  )}>
                    <Clock className="w-3.5 h-3.5" />
                    {daysRemaining > 0 ? `${daysRemaining} days` : 'Expired'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                  <span className="text-sm text-text-secondary">Potential Return</span>
                  <span className={cn(
                    "text-sm font-semibold flex items-center gap-1",
                    potentialReturn >= 50 ? "text-emerald-500" : "text-prmx-cyan"
                  )}>
                    <TrendingUp className="w-3.5 h-3.5" />
                    +{potentialReturn.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Seller & Coverage - Compact */}
              <div className="pt-3 border-t border-border-primary/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Seller</span>
                  <div className="flex items-center gap-2">
                    {isOwner ? (
                      <span className="text-sm font-medium text-prmx-cyan">You</span>
                    ) : (
                      <span className="text-sm font-medium">{sellerInfo?.name || 'Unknown'}</span>
                    )}
                    <code className="text-[10px] text-text-tertiary font-mono">{formatAddress(order.seller)}</code>
                  </div>
                </div>
                
                {policy && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">Coverage</span>
                    <span className="text-sm">
                      {new Date(policy.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' → '}
                      {new Date(policy.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                )}
                
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Order ID</span>
                  <code className="text-xs font-mono text-text-secondary">{order.orderId}</code>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                {canCancel ? (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setShowOrderDetailModal(false);
                      handleCancelOrder(order.orderId, order.seller);
                    }}
                    loading={cancellingOrderId === order.orderId}
                    className="flex-1"
                  >
                    {isDaoOrder && !isOwner ? 'Cancel DAO Order' : 'Cancel Order'}
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
