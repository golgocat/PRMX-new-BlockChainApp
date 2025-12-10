'use client';

import { useState, useEffect } from 'react';
import { 
  Wallet, 
  Plus, 
  Minus, 
  TrendingUp, 
  Shield,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
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
  Trash2
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Modal } from '@/components/ui/Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { formatUSDT, formatAddress, formatDate } from '@/lib/utils';
import { useWalletStore, useFormattedBalance, useIsDao } from '@/stores/walletStore';
import { useLpOrders, useMyLpHoldings, usePolicies, useMarkets, useTradeHistory, useLpPositionOutcomes, addTradeToHistory } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import type { LpAskOrder, Policy, DaoSolvencyInfo, PolicyDefiInfo } from '@/types';
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
  const { holdings, loading: holdingsLoading, refresh: refreshHoldings } = useMyLpHoldings();
  const { policies } = usePolicies();
  const { markets } = useMarkets();
  const { trades, loading: tradesLoading, refresh: refreshTrades, addTrade, clearHistory } = useTradeHistory();
  const { outcomes, loading: outcomesLoading, refresh: refreshOutcomes } = useLpPositionOutcomes();
  
  // Active tab state
  const [activeTab, setActiveTab] = useState<'orderbook' | 'history'>('orderbook');

  // Helper to get policy by ID
  const getPolicyById = (policyId: number) => policies.find(p => p.id === policyId);
  
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
      
      // Record sell order placement in trade history
      const market = getMarketById(selectedPolicy.marketId);
      addTrade({
        type: 'sell',
        policyId: selectedPolicy.id,
        marketName: market?.name || `Market ${selectedPolicy.marketId}`,
        shares: quantity,
        pricePerShare: parseFloat(sellPrice),
        totalAmount: quantity * parseFloat(sellPrice),
        timestamp: Date.now(),
        counterparty: 'Order placed',
      });
      
      toast.success('Sell order placed successfully!');
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
            <Button onClick={() => useWalletStore.getState().connect()}>
              Connect Wallet
            </Button>
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
          icon={<RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />}
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
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'orderbook' | 'history')}>
        <TabsList className="mb-6">
          <TabsTrigger value="orderbook">
            <TrendingUp className="w-4 h-4 mr-2" />
            Orderbook
            <Badge variant="cyan" className="ml-2">{orders.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="w-4 h-4 mr-2" />
            History
            <Badge variant={trades.length > 0 ? "purple" : "default"} className="ml-2">{trades.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* Orderbook Tab */}
        <TabsContent value="orderbook">
      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Orderbook */}
        <div className="lg:col-span-2">
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
                      <div key={order.orderId} className={cn(
                        "p-4 hover:bg-background-tertiary/30 transition-colors",
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
                                <span className="font-semibold">Policy #{order.policyId}</span>
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
                            <div className="text-xs text-text-tertiary mb-1">Available</div>
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
        </div>

        {/* My LP Holdings & Actions */}
        <div className="space-y-6">
          {/* My Holdings */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">My LP Holdings</h3>
                {holdings.filter(h => h.shares > 0).length > 0 && (
                  <span className="text-xs text-text-tertiary">Click to view & sell</span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {holdingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-text-tertiary" />
                </div>
              ) : holdings.filter(h => h.shares > 0).length === 0 ? (
                <div className="text-center py-8">
                  <Wallet className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                  <p className="text-text-secondary text-sm">No LP holdings yet</p>
                  <p className="text-xs text-text-tertiary mt-1">Fill orders from the orderbook to acquire LP tokens</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* DAO Solvency Warning */}
                  {solvencyInfo && !solvencyInfo.isSolvent && (
                    <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                        <div className="text-xs">
                          <p className="font-medium text-warning">DAO Solvency Warning</p>
                          <p className="text-text-secondary mt-1">
                            DAO may not fully cover DeFi losses. Some positions may have reduced payouts.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {holdings.filter(h => h.shares > 0).map((holding, index) => {
                    const policy = getPolicyById(holding.policyId);
                    const market = policy ? getMarketById(policy.marketId) : null;
                    const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
                    const potentialPayout = holding.shares * (market?.payoutPerShare || BigInt(100_000_000));
                    const defiInfo = policyDefiInfoMap.get(holding.policyId);
                    
                    return (
                    <div
                      key={index}
                      onClick={() => handleOpenHoldingModal(holding.policyId)}
                      className="p-3 rounded-xl bg-background-tertiary/50 border border-border-secondary cursor-pointer hover:bg-background-tertiary/80 hover:border-prmx-cyan/50 transition-all group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                          <span className="font-medium group-hover:text-prmx-cyan transition-colors">Policy #{holding.policyId}</span>
                            {/* DeFi Allocation Indicator */}
                            {defiInfo?.isAllocatedToDefi && (
                              <Badge variant="success" className="text-xs px-1.5 py-0.5">
                                📈 DeFi
                              </Badge>
                            )}
                          </div>
                          {market && (
                            <p className="text-xs text-text-secondary flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3" />
                              {market.name}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="success">{holding.shares.toString()} shares</Badge>
                          <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-cyan transition-colors" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-text-secondary">Max Payout: </span>
                          <span className="text-success font-medium">
                            {formatUSDT(potentialPayout)}
                          </span>
                        </div>
                        {policy && (
                          <div className="text-right">
                            <span className="text-text-secondary">Expires: </span>
                            <span className={cn(
                              "font-medium",
                              daysRemaining <= 3 ? "text-warning" : "text-text-primary"
                            )}>
                              {daysRemaining > 0 ? `${daysRemaining}d` : 'Ended'}
                            </span>
                          </div>
                        )}
                      </div>
                      {/* DeFi Principal Display */}
                      {defiInfo?.position && (
                        <div className="mt-2 pt-2 border-t border-border-secondary/50 text-xs">
                          <span className="text-text-tertiary">DeFi Allocated: </span>
                          <span className="text-prmx-purple-light font-medium">
                            {formatUSDT(defiInfo.position.principalUsdt)}
                          </span>
                        </div>
                      )}
                    </div>
                  );})}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Balance */}
          <Card className="bg-gradient-to-br from-prmx-cyan/10 to-prmx-purple/10 border-prmx-cyan/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">Available Balance</p>
                  <p className="text-xl font-bold">{usdtFormatted}</p>
                </div>
                <Wallet className="w-8 h-8 text-prmx-cyan opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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
                        className={cn(
                          "p-4 rounded-xl border transition-all",
                          trade.type === 'buy' 
                            ? "bg-success/5 border-success/20" 
                            : "bg-error/5 border-error/20"
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
                                Policy #{trade.policyId} • {trade.marketName}
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
                        className={cn(
                          "p-4 rounded-xl border",
                          outcome.outcome === 'matured' && "bg-success/5 border-success/20",
                          outcome.outcome === 'event_triggered' && "bg-error/5 border-error/20",
                          outcome.outcome === 'active' && "bg-background-tertiary/50 border-border-secondary"
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
                                <span className="font-semibold">Policy #{outcome.policyId}</span>
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
                    <h4 className="font-semibold">{market.name}</h4>
                    <p className="text-xs text-text-secondary">Policy #{selectedPolicy.id}</p>
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
                    <h4 className="font-semibold">{market.name}</h4>
                    <p className="text-xs text-text-secondary">Policy #{selectedOrder.policyId}</p>
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
                  <span className="text-text-secondary">Start</span>
                  <span>{formatDate(policy.coverageStart)}</span>
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-text-secondary">End</span>
                  <span>{formatDate(policy.coverageEnd)}</span>
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
                    As an LP, you earn {maxPayout}/share if the 24h rolling rainfall stays below {market.strikeValue}mm. 
                    If the event occurs (rainfall exceeds threshold), your investment pays out to policy holders.
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

      {/* Holding Details Modal */}
      <Modal
        isOpen={showHoldingModal}
        onClose={() => setShowHoldingModal(false)}
        title="LP Holding Details"
        size="lg"
      >
        {selectedHoldingPolicyId !== null && (() => {
          const holding = holdings.find(h => h.policyId === selectedHoldingPolicyId);
          const policy = getPolicyById(selectedHoldingPolicyId);
          const market = policy ? getMarketById(policy.marketId) : null;
          
          if (!holding) return null;
          
          const daysRemaining = policy ? getDaysRemaining(policy.coverageEnd) : 0;
          const potentialPayout = holding.shares * (market?.payoutPerShare || BigInt(100_000_000));
          const totalShares = policy?.capitalPool?.totalShares || 1;
          const ownershipPercent = Number(holding.shares) / totalShares * 100;
          const availableShares = holding.shares - holding.lockedShares;
          
          // Find orders for this policy by this user
          const myOrdersForPolicy = orders.filter(o => 
            o.policyId === selectedHoldingPolicyId && 
            isSameAddress(o.seller, selectedAccount?.address)
          );
          
          return (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-prmx-gradient/10 border border-prmx-cyan/20">
              <div className="w-14 h-14 rounded-xl bg-prmx-gradient flex items-center justify-center">
                <Shield className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold">Policy #{selectedHoldingPolicyId}</h3>
                {market && (
                  <p className="text-text-secondary flex items-center gap-1 mt-1">
                    <MapPin className="w-4 h-4" />
                    {market.name}
                  </p>
                )}
              </div>
              <Badge variant="success" className="text-lg px-4 py-1">
                {holding.shares.toString()} shares
              </Badge>
            </div>

            {/* Holdings Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-background-tertiary/50">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-5 h-5 text-success" />
                  <span className="text-sm text-text-secondary">Max Payout (if no event)</span>
                </div>
                <div className="text-2xl font-bold text-success">{formatUSDT(potentialPayout)}</div>
                <p className="text-xs text-text-tertiary mt-1">
                  {market?.payoutPerShare ? formatUSDT(market.payoutPerShare) : '$100'} per share
                </p>
              </div>
              
              <div className="p-4 rounded-xl bg-background-tertiary/50">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-prmx-cyan" />
                  <span className="text-sm text-text-secondary">Ownership</span>
                </div>
                <div className="text-2xl font-bold text-prmx-cyan">{ownershipPercent.toFixed(1)}%</div>
                <p className="text-xs text-text-tertiary mt-1">
                  of {totalShares} total shares
                </p>
              </div>
            </div>

            {/* Share Details */}
            <div className="p-4 rounded-xl bg-background-tertiary/30 border border-border-secondary">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                Share Breakdown
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Total Shares</span>
                  <span className="font-medium">{holding.shares.toString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Locked (in orders)</span>
                  <span className="font-medium text-warning">{holding.lockedShares.toString()}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-border-secondary">
                  <span className="text-text-secondary">Available to Sell</span>
                  <span className="font-medium text-success">{availableShares.toString()}</span>
                </div>
              </div>
            </div>

            {/* Policy Info */}
            {policy && market && (
              <div className="p-4 rounded-xl bg-background-tertiary/30 border border-border-secondary">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Policy Information
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-text-tertiary">Strike Value</span>
                    <p className="font-medium flex items-center gap-1">
                      <Droplets className="w-3 h-3 text-prmx-cyan" />
                      {market.strikeValue} mm
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Coverage Ends</span>
                    <p className={cn(
                      "font-medium flex items-center gap-1",
                      daysRemaining <= 3 ? "text-warning" : "text-text-primary"
                    )}>
                      <Clock className="w-3 h-3" />
                      {daysRemaining > 0 ? `${daysRemaining} days` : 'Ended'}
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Policy Status</span>
                    <p className="font-medium">
                      <StatusBadge status={policy.status as 'Active' | 'Settled' | 'Expired'} />
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Total Pool</span>
                    <p className="font-medium">{formatUSDT(policy.capitalPool.totalCapital)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Active Orders */}
            {myOrdersForPolicy.length > 0 && (
              <div className="p-4 rounded-xl bg-warning/5 border border-warning/20">
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-warning">
                  <AlertTriangle className="w-4 h-4" />
                  Your Active Sell Orders
                </h4>
                <div className="space-y-2">
                  {myOrdersForPolicy.map(order => (
                    <div key={order.orderId} className="flex justify-between items-center text-sm p-2 rounded-lg bg-background-tertiary/50">
                      <span>{order.remaining.toString()} shares @ {formatUSDT(order.priceUsdt)}/share</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowHoldingModal(false);
                          handleCancelOrder(order.orderId);
                        }}
                        className="text-error text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DeFi Allocation Info */}
            {(() => {
              const defiInfo = policyDefiInfoMap.get(selectedHoldingPolicyId);
              if (!defiInfo?.isAllocatedToDefi) return null;
              
              return (
                <div className="p-4 rounded-xl bg-prmx-purple/5 border border-prmx-purple/20">
                  <h4 className="font-semibold mb-2 flex items-center gap-2 text-prmx-purple-light">
                    <TrendingUp className="w-4 h-4" />
                    DeFi Yield Strategy Active
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Status</span>
                      <Badge variant="success" className="text-xs">Allocated to DeFi</Badge>
                    </div>
                    {defiInfo.position && (
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Principal in DeFi</span>
                        <span className="font-medium">{formatUSDT(defiInfo.position.principalUsdt)}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-text-tertiary mt-3 pt-2 border-t border-prmx-purple/20">
                    Pool funds are generating yield via Hydration Stableswap. 
                    The DAO provides loss coverage.
                  </p>
                </div>
              );
            })()}

            {/* DAO Solvency Warning in Modal */}
            {solvencyInfo && !solvencyInfo.isSolvent && policyDefiInfoMap.get(selectedHoldingPolicyId)?.isAllocatedToDefi && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                  <div className="text-xs">
                    <span className="text-warning font-medium">Solvency Notice: </span>
                    <span className="text-text-secondary">
                      DAO coverage may be limited. If DeFi incurs significant losses, 
                      full payout may not be guaranteed.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Risk Warning */}
            <div className="p-3 rounded-lg bg-error/5 border border-error/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-error mt-0.5 flex-shrink-0" />
                <div className="text-xs text-text-secondary">
                  <span className="text-error font-medium">Event Risk: </span>
                  If the 24h rolling rainfall exceeds {market?.strikeValue || 50}mm during the coverage period, 
                  your LP tokens will pay out to the policy holder and you will lose your investment.
                  {policyDefiInfoMap.get(selectedHoldingPolicyId)?.isAllocatedToDefi && (
                    <span className="block mt-1">
                      <span className="text-prmx-purple-light font-medium">DeFi Risk: </span>
                      Pool funds in DeFi may experience additional yield/loss. The DAO covers DeFi losses when solvent.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
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
    </div>
  );
}
