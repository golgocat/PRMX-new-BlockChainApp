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
  Zap
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { formatCoordinates } from '@/lib/utils';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useMarkets } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface RainfallData {
  marketId: number;
  rollingSumMm: number;
  lastBucketIndex: number;
  lastUpdated: string;
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
          return {
            marketId: market.id,
            rollingSumMm: displayValue, // Convert from scaled (tenths of mm)
            lastBucketIndex: data.lastBucketIndex,
            lastUpdated: new Date(data.lastBucketIndex * 3600 * 1000).toISOString(),
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
  }, [isChainConnected, markets]);

  // Scroll to highlighted market when data loads
  useEffect(() => {
    if (highlightMarketId !== null && !loading && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightMarketId, loading]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchRainfallData();
    setTimeout(() => setIsRefreshing(false), 500);
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

  const getMarketById = (marketId: number) => {
    return markets.find(m => m.id === marketId);
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
          icon={<RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />}
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
          <CardContent>
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

      {/* Rainfall Data Cards */}
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

                    {/* Last Updated */}
                    {data && (
                      <div className="flex items-center justify-center gap-2 text-xs text-text-tertiary pt-2 border-t border-border-secondary">
                        <Clock className="w-3 h-3" />
                        Last updated: {new Date(data.lastUpdated).toLocaleString()}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

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
    </div>
  );
}
