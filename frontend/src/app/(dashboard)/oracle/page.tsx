'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  CloudRain, 
  MapPin, 
  Droplets, 
  Clock,
  RefreshCw,
  Globe2,
  Activity,
  ThermometerSun,
  Settings,
  Zap,
  ChevronDown,
  ChevronUp,
  List,
  Code,
  X,
  AlertTriangle,
  FileText,
  DollarSign,
  User
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Modal } from '@/components/ui/Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { formatCoordinates, formatAddress, formatUSDT } from '@/lib/utils';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useMarkets } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface RainBucketData {
  bucketIndex: number;
  timestamp: Date;
  rainfallMm: number;
  blockNumber: number;
  rawData: Record<string, unknown>; // Raw blockchain data for debugging
}

interface HourlyBucketData {
  hourIndex: number;
  hourUtc: Date;
  rainfallMm: number;
  fetchedAt: Date;
  source: 'current' | 'historical';
  rawData: Record<string, unknown>;
}

interface RainfallData {
  marketId: number;
  rollingSumMm: number;
  lastBucketIndex: number;
  lastUpdated: string;
  buckets: RainBucketData[];
  hourlyBuckets: HourlyBucketData[]; // New: hourly buckets from historical/24
}

export default function OraclePage() {
  const searchParams = useSearchParams();
  const highlightMarketId = searchParams.get('marketId') ? Number(searchParams.get('marketId')) : null;
  const highlightRef = useRef<HTMLDivElement>(null);
  
  const { isChainConnected } = useWalletStore();
  const { markets, loading: marketsLoading } = useMarkets();
  const isDao = useIsDao();
  
  const [rainfallData, setRainfallData] = useState<RainfallData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // DAO controls state
  const [selectedMarketId, setSelectedMarketId] = useState<string>('');
  const [testRainfallValue, setTestRainfallValue] = useState<string>('');
  const [isSettingRainfall, setIsSettingRainfall] = useState(false);
  const [isRefreshingAllMarkets, setIsRefreshingAllMarkets] = useState(false);
  
  
  // Track which markets have expanded bucket details
  const [expandedMarkets, setExpandedMarkets] = useState<Set<number>>(new Set());
  
  // State for raw data modal
  const [selectedBucket, setSelectedBucket] = useState<RainBucketData | null>(null);
  const [showRawDataModal, setShowRawDataModal] = useState(false);
  
  // State for tabs and trigger logs
  const [activeTab, setActiveTab] = useState<'rainfall' | 'triggers'>('rainfall');
  
  // Helper to get UTC offset string (e.g., "UTC+9" for Tokyo)
  const getUtcOffsetString = () => {
    const offsetMinutes = new Date().getTimezoneOffset();
    const offsetHours = -offsetMinutes / 60; // Negate because getTimezoneOffset returns opposite sign
    const sign = offsetHours >= 0 ? '+' : '';
    return `UTC${sign}${offsetHours}`;
  };
  const [triggerLogs, setTriggerLogs] = useState<api.ThresholdTriggerLog[]>([]);
  const [loadingTriggerLogs, setLoadingTriggerLogs] = useState(false);

  const fetchTriggerLogs = async () => {
    if (!isChainConnected) return;
    
    setLoadingTriggerLogs(true);
    try {
      const logs = await api.getThresholdTriggerLogs();
      setTriggerLogs(logs);
    } catch (err) {
      console.error('Failed to fetch trigger logs:', err);
    } finally {
      setLoadingTriggerLogs(false);
    }
  };

  const fetchRainfallData = async () => {
    if (!isChainConnected || markets.length === 0) return;
    
    setLoading(true);
    try {
      const dataPromises = markets.map(async (market) => {
        const data = await api.getRollingRainfallSum(market.id);
        console.log(`[Oracle] Market ${market.id} raw data:`, data);
        if (data) {
          const displayValue = data.rollingSumMm / 10;
          console.log(`[Oracle] Market ${market.id} display value: ${displayValue}mm`);
          
          // Fetch individual bucket readings (legacy)
          const buckets = await api.getRainBuckets(market.id);
          
          // Fetch hourly buckets (new historical/24 data)
          const hourlyBuckets = await api.getHourlyBuckets(market.id);
          console.log(`[Oracle] Market ${market.id} hourly buckets:`, hourlyBuckets.length);
          
          return {
            marketId: market.id,
            rollingSumMm: displayValue, // Convert from scaled (tenths of mm)
            lastBucketIndex: data.lastBucketIndex,
            lastUpdated: new Date(data.lastBucketIndex * 3600 * 1000).toISOString(),
            buckets,
            hourlyBuckets,
          };
        }
        return null;
      });
      
      const results = await Promise.all(dataPromises);
      console.log('[Oracle] All rainfall data:', results);
      setRainfallData(results.filter((r): r is RainfallData => r !== null));
    } catch (err) {
      console.error('Failed to fetch rainfall data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRainfallData();
    fetchTriggerLogs();
  }, [isChainConnected, markets]);

  // Scroll to highlighted market when data loads
  useEffect(() => {
    if (highlightMarketId !== null && !loading && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightMarketId, loading]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchRainfallData(), fetchTriggerLogs()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Get the last reset time for a market (from the most recent trigger)
  const getLastResetTime = (marketId: number): Date | null => {
    const marketTriggers = triggerLogs.filter(log => log.marketId === marketId);
    if (marketTriggers.length === 0) return null;
    // triggerLogs are sorted by triggerId descending (newest first)
    const lastTrigger = marketTriggers[0];
    return lastTrigger.triggeredAt ? new Date(lastTrigger.triggeredAt * 1000) : null;
  };

  const handleSetTestRainfall = async () => {
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    const marketId = parseInt(selectedMarketId);
    const rainfallMm = parseFloat(testRainfallValue);
    
    if (isNaN(marketId) || isNaN(rainfallMm)) {
      toast.error('Please enter valid values');
      return;
    }

    // Convert to tenths of mm (e.g., 15.5mm -> 155)
    const rainfallScaled = Math.round(rainfallMm * 10);

    setIsSettingRainfall(true);
    try {
      await api.setTestRainfall(keypair, marketId, rainfallScaled);
      toast.success(`Set rainfall for Market #${marketId} to ${rainfallMm}mm`);
      setTestRainfallValue('');
      
      // Wait a moment for blockchain state to propagate, then refresh
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Clear existing data to force a full refresh
      setRainfallData([]);
      await fetchRainfallData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set test rainfall');
    } finally {
      setIsSettingRainfall(false);
    }
  };

  const handleRefreshAllMarkets = async () => {
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    setIsRefreshingAllMarkets(true);
    try {
      await api.requestRainfallFetchAll(keypair);
      toast.success(`Queued rainfall fetch for all ${markets.length} markets`);
      
      // Wait a moment for blockchain state to propagate, then refresh
      await new Promise(resolve => setTimeout(resolve, 2000));
      await fetchRainfallData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh all markets');
    } finally {
      setIsRefreshingAllMarkets(false);
    }
  };

  const getMarketById = (marketId: number) => {
    return markets.find(m => m.id === marketId);
  };

  const toggleMarketExpanded = (marketId: number) => {
    setExpandedMarkets(prev => {
      const next = new Set(prev);
      if (next.has(marketId)) {
        next.delete(marketId);
      } else {
        next.add(marketId);
      }
      return next;
    });
  };

  // Calculate aggregate stats
  const marketsAboveThreshold = rainfallData.filter(d => {
    const market = getMarketById(d.marketId);
    return market && d.rollingSumMm >= market.strikeValue;
  }).length;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Oracle Data</h1>
          <p className="text-text-secondary mt-1">
            {highlightMarketId !== null ? (
              <>Viewing rainfall data for <span className="text-prmx-cyan font-medium">{getMarketById(highlightMarketId)?.name || `Market #${highlightMarketId}`}</span></>
            ) : (
              'Real-time rainfall data from AccuWeather'
            )}
          </p>
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatCard
          title="Monitored Markets"
          value={marketsLoading ? '...' : markets.length}
          icon={<Globe2 className="w-5 h-5" />}
        />
        <StatCard
          title="Above Strike"
          value={loading ? '...' : marketsAboveThreshold}
          icon={<Activity className="w-5 h-5" />}
          iconColor={marketsAboveThreshold > 0 ? 'bg-error/10 text-error' : 'bg-success/10 text-success'}
        />
      </div>

      {/* DAO Controls - Only visible to DAO */}
      {isDao && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-warning" />
              <h3 className="font-semibold">DAO Oracle Controls</h3>
              <Badge variant="warning" className="text-xs">Admin Only</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Automatic AccuWeather Updates Status */}
            <div className="p-4 rounded-lg bg-success/10 border border-success/30">
              <h4 className="font-medium text-success mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Automatic AccuWeather Updates
                <Badge variant="success" className="text-xs ml-2">Active</Badge>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    <span className="text-text-secondary">Offchain Worker Status:</span>
                    <span className="text-success font-medium">Running</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Globe2 className="w-4 h-4 text-prmx-cyan" />
                    <span className="text-text-secondary">Data Source:</span>
                    <span className="text-text-primary">AccuWeather API</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-warning" />
                    <span className="text-text-secondary">Update Frequency:</span>
                    <span className="text-text-primary">Every hour (~600 blocks)</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="w-4 h-4 text-prmx-purple" />
                    <span className="text-text-secondary">Transaction Type:</span>
                    <span className="text-text-primary">Signed (Oracle Authority)</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-prmx-cyan" />
                    <span className="text-text-secondary">Signer:</span>
                    <span className="text-text-primary font-mono text-xs">Alice (5GrwvaEF...)</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 p-3 rounded bg-background-secondary/50 border border-border-secondary">
                <p className="text-xs text-text-tertiary">
                  ✅ The offchain worker automatically fetches real 24h rainfall data from AccuWeather API 
                  and updates on-chain storage via signed transactions. No manual intervention required.
                </p>
              </div>
            </div>

            {/* Refresh All Markets Button */}
            <div className="p-4 rounded-lg bg-prmx-cyan/10 border border-prmx-cyan/30">
              <h4 className="font-medium text-prmx-cyan mb-3 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Manual Refresh All Markets
              </h4>
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleRefreshAllMarkets}
                  loading={isRefreshingAllMarkets}
                  icon={<RefreshCw className="w-4 h-4" />}
                  className="bg-prmx-cyan hover:bg-prmx-cyan/90 text-black"
                >
                  Refresh All Markets Now
                </Button>
                <span className="text-sm text-text-secondary">
                  {markets.length} markets will be queued for refresh
                </span>
              </div>
              <p className="text-xs text-text-tertiary mt-3">
                💡 Use this when the node has been offline and missed regular AccuWeather polling.
                This queues fetch requests for all markets, which the offchain worker will process.
              </p>
            </div>

            {/* Test Data Section */}
            <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
              <h4 className="font-medium text-warning mb-3 flex items-center gap-2">
                <ThermometerSun className="w-4 h-4" />
                Set Test Rainfall (Manual Override)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Market</label>
                  <select
                    value={selectedMarketId}
                    onChange={(e) => setSelectedMarketId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-background-secondary border border-border-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-warning/50"
                  >
                    <option value="">Select Market</option>
                    {markets.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} (ID: {m.id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Rainfall (mm)</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="500"
                    placeholder="e.g. 25.5"
                    value={testRainfallValue}
                    onChange={(e) => setTestRainfallValue(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleSetTestRainfall}
                  loading={isSettingRainfall}
                  disabled={!selectedMarketId || !testRainfallValue}
                  icon={<Zap className="w-4 h-4" />}
                  className="bg-warning hover:bg-warning/90 text-black"
                >
                  Set Test Rainfall
                </Button>
              </div>
              <p className="text-xs text-text-tertiary mt-3">
                ⚠️ This manually sets the 24h rolling rainfall sum for testing purposes. 
                Use this when AccuWeather API is unavailable or for demo scenarios.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Oracle Info */}
      <Card className="bg-gradient-to-r from-prmx-cyan/5 to-prmx-purple/5 border-prmx-cyan/20">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-prmx-gradient flex items-center justify-center flex-shrink-0">
              <CloudRain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">AccuWeather Oracle</h3>
              <p className="text-text-secondary mb-4">
                Rainfall data is fetched hourly from AccuWeather API via off-chain workers. 
                The 24-hour rolling sum is calculated on-chain to determine policy triggers.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-text-tertiary">Data Source</span>
                  <p className="font-medium">AccuWeather API</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Update Frequency</span>
                  <p className="font-medium">Hourly</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Rolling Window</span>
                  <p className="font-medium">24 Hours</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Precision</span>
                  <p className="font-medium">0.1 mm</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs for Rainfall Data and Trigger Logs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'rainfall' | 'triggers')}>
        <TabsList className="mb-6">
          <TabsTrigger value="rainfall">
            <CloudRain className="w-4 h-4 mr-2" />
            Market Rainfall Data
            <Badge variant="cyan" className="ml-2">{markets.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="triggers">
            <AlertTriangle className="w-4 h-4 mr-2" />
            Trigger Logs
            <Badge variant={triggerLogs.length > 0 ? "warning" : "default"} className="ml-2">{triggerLogs.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* Rainfall Data Tab */}
        <TabsContent value="rainfall">
        <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Market Rainfall Data</h2>
          <Badge variant="cyan">
            {markets.length} Markets
          </Badge>
        </div>
        
        {loading || marketsLoading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-text-tertiary" />
              <p className="text-text-secondary mt-3">Loading rainfall data...</p>
            </CardContent>
          </Card>
        ) : markets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Globe2 className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
              <h3 className="font-semibold mb-1">No markets available</h3>
              <p className="text-text-secondary text-sm">Create a market to start monitoring rainfall data</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {markets.map((market) => {
              const data = rainfallData.find(d => d.marketId === market.id);
              const rollingSumMm = data?.rollingSumMm ?? 0;
              const isAboveStrike = rollingSumMm >= market.strikeValue;
              const percentOfStrike = (rollingSumMm / market.strikeValue) * 100;
              const isHighlighted = highlightMarketId === market.id;
              const remainingToStrike = Math.max(0, market.strikeValue - rollingSumMm);

              return (
                <Card 
                  key={market.id}
                  ref={isHighlighted ? highlightRef : undefined}
                  className={cn(
                    'transition-all',
                    isHighlighted && 'ring-2 ring-prmx-cyan shadow-lg shadow-prmx-cyan/20'
                  )}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center">
                          <MapPin className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{market.name}</h3>
                          <p className="text-xs text-text-secondary">
                            {formatCoordinates(market.centerLatitude, market.centerLongitude)}
                          </p>
                        </div>
                      </div>
                      {data ? (
                        isAboveStrike ? (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            Triggered
                          </Badge>
                        ) : (
                          <Badge variant="success" className="flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            Normal
                          </Badge>
                        )
                      ) : (
                        <Badge variant="default">No Data</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Rainfall Progress */}
                    <div className="p-4 rounded-xl bg-background-tertiary/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-text-secondary">24h Rolling Sum</span>
                        <span className={cn(
                          'text-2xl font-bold',
                          isAboveStrike ? 'text-error' : 'text-prmx-cyan'
                        )}>
                          {rollingSumMm.toFixed(1)} mm
                        </span>
                      </div>
                      
                      {/* Progress bar */}
                      <div className="h-3 bg-background-secondary rounded-full overflow-hidden mb-2">
                        <div 
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            percentOfStrike >= 100 ? 'bg-error' : percentOfStrike >= 75 ? 'bg-warning' : 'bg-prmx-cyan'
                          )}
                          style={{ width: `${Math.min(percentOfStrike, 100)}%` }}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-tertiary">0 mm</span>
                        <span className={cn(
                          'font-medium',
                          isAboveStrike ? 'text-error' : 'text-text-secondary'
                        )}>
                          {percentOfStrike.toFixed(0)}% of strike
                        </span>
                        <span className="text-text-tertiary">{market.strikeValue} mm</span>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-background-tertiary/30">
                        <div className="flex items-center gap-2 mb-1">
                          <Droplets className="w-4 h-4 text-prmx-cyan" />
                          <span className="text-xs text-text-secondary">Strike Value</span>
                        </div>
                        <p className="font-semibold">{market.strikeValue} mm</p>
                      </div>
                      <div className="p-3 rounded-lg bg-background-tertiary/30">
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className="w-4 h-4 text-warning" />
                          <span className="text-xs text-text-secondary">To Strike</span>
                        </div>
                        <p className={cn(
                          'font-semibold',
                          isAboveStrike ? 'text-error' : 'text-text-primary'
                        )}>
                          {isAboveStrike ? 'TRIGGERED' : `${remainingToStrike.toFixed(1)} mm`}
                        </p>
                      </div>
                    </div>

                    {/* Expand/Collapse Button for Bucket Details */}
                    {data && (data.hourlyBuckets.length > 0 || data.buckets.length > 0) && (
                      <button
                        onClick={() => toggleMarketExpanded(market.id)}
                        className="w-full flex items-center justify-center gap-2 py-2 text-sm text-prmx-cyan hover:text-prmx-cyan/80 transition-colors border-t border-border-secondary"
                      >
                        <List className="w-4 h-4" />
                        {expandedMarkets.has(market.id) ? 'Hide' : 'Show'} Hourly Readings ({data.hourlyBuckets.length || data.buckets.length})
                        {data.hourlyBuckets.length > 0 && (
                          <Badge variant="purple" className="text-[10px]">Historical</Badge>
                        )}
                        {expandedMarkets.has(market.id) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    )}

                    {/* Expanded Bucket Details - Prefer hourly buckets (historical/24) over legacy */}
                    {data && expandedMarkets.has(market.id) && (
                      <div className="border-t border-border-secondary pt-4 mt-2">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <Droplets className="w-4 h-4 text-prmx-cyan" />
                          Hourly Rainfall Readings (Past 24h)
                          {data.hourlyBuckets.length > 0 && (
                            <Badge variant="purple" className="text-[10px]">AccuWeather Historical/24</Badge>
                          )}
                        </h4>
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {/* Prefer hourly buckets (new) over legacy buckets */}
                          {data.hourlyBuckets.length > 0 ? (
                            data.hourlyBuckets.map((bucket, idx) => (
                              <div 
                                key={bucket.hourIndex}
                                onClick={() => {
                                  // Convert to common format for modal
                                  setSelectedBucket({
                                    bucketIndex: bucket.hourIndex,
                                    timestamp: bucket.hourUtc,
                                    rainfallMm: bucket.rainfallMm,
                                    blockNumber: 0,
                                    rawData: bucket.rawData,
                                  });
                                  setShowRawDataModal(true);
                                }}
                                className={cn(
                                  'flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-all hover:ring-1 hover:ring-prmx-cyan/50',
                                  idx === 0 ? 'bg-prmx-cyan/10 border border-prmx-cyan/30' : 'bg-background-tertiary/30 hover:bg-background-tertiary/50'
                                )}
                                title="Click to view raw data"
                              >
                                <div className="flex items-center gap-2">
                                  <Clock className="w-3 h-3 text-text-tertiary" />
                                  <span className="text-text-secondary">
                                    {bucket.hourUtc.toLocaleTimeString([], { 
                                      hour: '2-digit', 
                                      minute: '2-digit',
                                      hour12: true 
                                    })}
                                  </span>
                                  <span className="text-text-tertiary text-xs">
                                    {bucket.hourUtc.toLocaleDateString([], { 
                                      month: 'short', 
                                      day: 'numeric' 
                                    })}
                                  </span>
                                  <span className="text-prmx-cyan text-xs font-medium">
                                    ({getUtcOffsetString()})
                                  </span>
                                  {idx === 0 && (
                                    <Badge variant="cyan" className="text-xs ml-1">Latest</Badge>
                                  )}
                                  <Badge 
                                    variant={bucket.source === 'historical' ? 'purple' : 'default'}
                                    className="text-[10px] ml-1"
                                  >
                                    {bucket.source === 'historical' ? 'Hist' : 'Live'}
                                  </Badge>
                                  <Code className="w-3 h-3 text-text-tertiary ml-1" />
                                </div>
                                <div className={cn(
                                  'font-mono font-semibold',
                                  bucket.rainfallMm > 0 ? 'text-prmx-cyan' : 'text-text-tertiary'
                                )}>
                                  {bucket.rainfallMm.toFixed(1)} mm
                                </div>
                              </div>
                            ))
                          ) : data.buckets.length > 0 ? (
                            // Fallback to legacy buckets
                            data.buckets.map((bucket, idx) => (
                              <div 
                                key={bucket.bucketIndex}
                                onClick={() => {
                                  setSelectedBucket(bucket);
                                  setShowRawDataModal(true);
                                }}
                                className={cn(
                                  'flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-all hover:ring-1 hover:ring-prmx-cyan/50',
                                  idx === 0 ? 'bg-prmx-cyan/10 border border-prmx-cyan/30' : 'bg-background-tertiary/30 hover:bg-background-tertiary/50'
                                )}
                                title="Click to view raw data"
                              >
                                <div className="flex items-center gap-2">
                                  <Clock className="w-3 h-3 text-text-tertiary" />
                                  <span className="text-text-secondary">
                                    {bucket.timestamp.toLocaleTimeString([], { 
                                      hour: '2-digit', 
                                      minute: '2-digit',
                                      hour12: true 
                                    })}
                                  </span>
                                  <span className="text-text-tertiary text-xs">
                                    {bucket.timestamp.toLocaleDateString([], { 
                                      month: 'short', 
                                      day: 'numeric' 
                                    })}
                                  </span>
                                  <span className="text-prmx-cyan text-xs font-medium">
                                    ({getUtcOffsetString()})
                                  </span>
                                  {idx === 0 && (
                                    <Badge variant="cyan" className="text-xs ml-1">Latest</Badge>
                                  )}
                                  <Badge variant="default" className="text-[10px] ml-1">Legacy</Badge>
                                  <Code className="w-3 h-3 text-text-tertiary ml-1" />
                                </div>
                                <div className={cn(
                                  'font-mono font-semibold',
                                  bucket.rainfallMm > 0 ? 'text-prmx-cyan' : 'text-text-tertiary'
                                )}>
                                  {bucket.rainfallMm.toFixed(1)} mm
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-center text-text-tertiary text-sm py-4">
                              No hourly readings available
                            </div>
                          )}
                        </div>
                        {/* Summary */}
                        <div className="mt-3 pt-3 border-t border-border-secondary flex items-center justify-between text-sm">
                          <span className="text-text-secondary">Total (Sum of readings)</span>
                          <span className="font-semibold text-prmx-cyan">
                            {(data.hourlyBuckets.length > 0 
                              ? data.hourlyBuckets.reduce((sum, b) => sum + b.rainfallMm, 0) 
                              : data.buckets.reduce((sum, b) => sum + b.rainfallMm, 0)
                            ).toFixed(1)} mm
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Last Updated & Last Reset */}
                    {data && (
                      <div className="pt-2 border-t border-border-secondary space-y-1">
                        <div className="flex items-center justify-center gap-2 text-xs text-text-tertiary">
                          <Clock className="w-3 h-3" />
                          Last updated: {new Date(data.lastUpdated).toLocaleString()} <span className="text-prmx-cyan">({getUtcOffsetString()})</span>
                        </div>
                        {(() => {
                          const lastReset = getLastResetTime(market.id);
                          return lastReset ? (
                            <div className="flex items-center justify-center gap-2 text-xs text-warning">
                              <RefreshCw className="w-3 h-3" />
                              Sum reset after trigger: {lastReset.toLocaleString()} <span className="text-prmx-cyan">({getUtcOffsetString()})</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-2 text-xs text-text-tertiary/60">
                              <RefreshCw className="w-3 h-3" />
                              No triggers (sum never reset)
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      </TabsContent>

      {/* Trigger Logs Tab */}
      <TabsContent value="triggers">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Threshold Trigger Logs</h2>
            <Badge variant={triggerLogs.length > 0 ? "warning" : "default"}>
              {triggerLogs.length} Triggers
            </Badge>
          </div>

          {loadingTriggerLogs ? (
            <Card>
              <CardContent className="py-12 text-center">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-text-tertiary" />
                <p className="text-text-secondary mt-3">Loading trigger logs...</p>
              </CardContent>
            </Card>
          ) : triggerLogs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
                <h3 className="font-semibold mb-1">No triggers recorded</h3>
                <p className="text-text-secondary text-sm">
                  Threshold triggers will appear here when rainfall exceeds market strike values
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {triggerLogs.map((log, idx) => {
                const market = getMarketById(log.marketId);
                return (
                  <Card key={idx} className="border-warning/30">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-warning" />
                          </div>
                          <div>
                            <h4 className="font-semibold">
                              {market?.name || `Market #${log.marketId}`}
                            </h4>
                            <p className="text-sm text-text-secondary">
                              Triggered at block #{log.blockNumber ?? 'unknown'}
                            </p>
                          </div>
                        </div>
                        <Badge variant="warning">Triggered</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border-secondary">
                        <div>
                          <span className="text-xs text-text-tertiary">Rainfall</span>
                          <p className="font-semibold text-error">{(log.rollingSumMm / 10).toFixed(1)} mm</p>
                        </div>
                        <div>
                          <span className="text-xs text-text-tertiary">Strike Threshold</span>
                          <p className="font-semibold">{(log.strikeThreshold / 10).toFixed(1)} mm</p>
                        </div>
                        <div>
                          <span className="text-xs text-text-tertiary">Policy ID</span>
                          <p className="font-semibold">#{log.policyId}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </TabsContent>
      </Tabs>

      {/* How It Works */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold">How the Oracle Works</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="w-10 h-10 rounded-lg bg-prmx-cyan/20 flex items-center justify-center mb-3">
                <CloudRain className="w-5 h-5 text-prmx-cyan" />
              </div>
              <h4 className="font-semibold mb-2">1. Data Ingestion</h4>
              <p className="text-sm text-text-secondary">
                Off-chain workers fetch hourly rainfall data from AccuWeather API 
                for each market's geographic location.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="w-10 h-10 rounded-lg bg-prmx-purple/20 flex items-center justify-center mb-3">
                <Activity className="w-5 h-5 text-prmx-purple-light" />
              </div>
              <h4 className="font-semibold mb-2">2. Rolling Calculation</h4>
              <p className="text-sm text-text-secondary">
                The smart contract calculates a 24-hour rolling sum on-chain, 
                ensuring tamper-proof and transparent calculations.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center mb-3">
                <ThermometerSun className="w-5 h-5 text-success" />
              </div>
              <h4 className="font-semibold mb-2">3. Trigger Evaluation</h4>
              <p className="text-sm text-text-secondary">
                When the 24h rolling sum exceeds the market's strike value, 
                policy payouts are triggered automatically.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Raw Data Modal */}
      <Modal
        isOpen={showRawDataModal}
        onClose={() => {
          setShowRawDataModal(false);
          setSelectedBucket(null);
        }}
        title="Raw Bucket Data"
        size="lg"
      >
        {selectedBucket && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="p-4 rounded-xl bg-prmx-cyan/10 border border-prmx-cyan/30">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-text-secondary">Bucket Index</span>
                  <p className="font-mono font-semibold">{selectedBucket.bucketIndex}</p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">Rainfall (Display)</span>
                  <p className="font-mono font-semibold text-prmx-cyan">{selectedBucket.rainfallMm.toFixed(1)} mm</p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">Block Number</span>
                  <p className="font-mono font-semibold text-prmx-purple">#{selectedBucket.blockNumber.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">Timestamp <span className="text-prmx-cyan">(UTC)</span></span>
                  <p className="font-mono text-sm">{selectedBucket.timestamp.toISOString()}</p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">Local Time <span className="text-prmx-cyan">({getUtcOffsetString()})</span></span>
                  <p className="font-mono text-sm">{selectedBucket.timestamp.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Raw JSON Data */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-prmx-purple" />
                <span className="font-semibold">Raw Blockchain Data</span>
              </div>
              <pre className="p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary overflow-x-auto text-xs font-mono text-text-secondary max-h-64 overflow-y-auto">
                {JSON.stringify(selectedBucket.rawData, null, 2)}
              </pre>
            </div>

            {/* Note */}
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
              <p className="text-xs text-text-secondary">
                <strong className="text-warning">Note:</strong> The <code className="px-1 py-0.5 rounded bg-background-tertiary">rainfall_mm</code> field 
                in raw data is stored in <strong>tenths of mm</strong> (e.g., 100 = 10.0mm). 
                The display value above shows the converted value.
              </p>
            </div>

            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(selectedBucket.rawData, null, 2));
                toast.success('Raw data copied to clipboard!');
              }}
              className="w-full"
              icon={<Code className="w-4 h-4" />}
            >
              Copy Raw JSON
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
