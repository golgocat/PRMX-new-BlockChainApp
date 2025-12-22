'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Globe2, 
  ChevronLeft, 
  MapPin, 
  Droplets, 
  Calendar,
  Clock,
  Users,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Shield,
  Settings,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { usePolicies } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import { formatUSDT, formatCoordinates, formatDateTimeUTCCompact, formatBasisPoints, secondsToDays, formatAddress, cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Market, Policy } from '@/types';

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const marketId = Number(params.id);
  
  const { isConnected } = useWalletStore();
  const isDao = useIsDao();
  const { policies: allPolicies } = usePolicies();
  
  const [market, setMarket] = useState<Market | null>(null);
  const [rainfallData, setRainfallData] = useState<{ rollingSumMm: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter policies for this market
  const marketPolicies = allPolicies.filter(p => p.marketId === marketId);
  const activePolicies = marketPolicies.filter(p => p.status === 'Active');
  const settledPolicies = marketPolicies.filter(p => p.status === 'Settled');

  useEffect(() => {
    if (isNaN(marketId) || marketId < 0) {
      router.push('/markets');
      return;
    }
    
    loadMarket();
  }, [marketId]);

  const loadMarket = async (isInitialLoad = true) => {
    if (isInitialLoad) {
      setLoading(true);
    }
    try {
      const marketData = await api.getMarket(marketId);
      setMarket(marketData);
      
      // Load rainfall data
      try {
        const rainfall = await api.getRollingRainfallSum(marketId);
        setRainfallData(rainfall);
      } catch {
        // Rainfall data might not be available
      }
    } catch (err) {
      console.error('Failed to load market:', err);
      toast.error('Failed to load market details');
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  };

  const now = Math.floor(Date.now() / 1000);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/markets">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Market Details</h1>
            <p className="text-text-secondary mt-1">Loading...</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <RefreshCw className="w-12 h-12 mx-auto mb-4 animate-spin text-prmx-cyan" />
            <p className="text-text-secondary">Loading market details...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/markets">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Market Not Found</h1>
            <p className="text-text-secondary mt-1">The requested market does not exist</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <Globe2 className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Market #{marketId} not found</h3>
            <p className="text-text-secondary mb-6">
              This market may have been removed or never existed.
            </p>
            <Link href="/markets">
              <Button>Back to Markets</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/markets">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-prmx-gradient flex items-center justify-center">
                <MapPin className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold">{market.name}</h1>
                  {/* V1/V2 badges - Manila (id=0) supports V2 */}
                  {marketId === 0 ? (
                    <div className="flex gap-1.5">
                      <Badge variant="default">V1</Badge>
                      <Badge variant="purple">V2</Badge>
                    </div>
                  ) : (
                    <Badge variant="default">V1</Badge>
                  )}
                </div>
                <p className="text-text-secondary">
                  {formatCoordinates(market.centerLatitude, market.centerLongitude)}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={market.status} />
          <Button 
            variant="secondary" 
            onClick={async () => {
              setIsRefreshing(true);
              await loadMarket(false);
              setIsRefreshing(false);
            }} 
            icon={<RefreshCw className={cn('w-4 h-4 transition-transform', isRefreshing && 'animate-spin')} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-prmx-cyan/20 flex items-center justify-center">
                <Droplets className="w-5 h-5 text-prmx-cyan" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Strike Value</p>
                <p className="text-xl font-bold">{market.strikeValue} mm</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Payout/Share</p>
                <p className="text-xl font-bold">{formatUSDT(market.payoutPerShare)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-prmx-purple/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-prmx-purple" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Active Policies</p>
                <p className="text-xl font-bold">{activePolicies.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">DAO Margin</p>
                <p className="text-xl font-bold">{formatBasisPoints(market.riskParameters.daoMarginBp)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Market Configuration */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5 text-text-secondary" />
              Market Configuration
            </h2>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Location */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-prmx-cyan" />
                Location
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-text-secondary">Latitude</span>
                  <p className="font-mono">{(market.centerLatitude / 1e6).toFixed(6)}°</p>
                </div>
                <div>
                  <span className="text-text-secondary">Longitude</span>
                  <p className="font-mono">{(market.centerLongitude / 1e6).toFixed(6)}°</p>
                </div>
              </div>
            </div>

            {/* Coverage Window Rules */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-prmx-purple" />
                Coverage Window Rules
              </h3>
              
              {/* V1 Rules */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="default">V1</Badge>
                  <span className="text-xs text-text-tertiary">24-hour rolling rainfall</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm pl-2 border-l-2 border-border-secondary">
                  <div>
                    <span className="text-text-secondary">Duration</span>
                    <p className="font-medium text-prmx-cyan">24 hours</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Min Lead Time</span>
                    <p className="font-medium">{secondsToDays(market.windowRules.minLeadTimeSecs)} days</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Event Type</span>
                    <p className="font-medium">Rolling 24h sum</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Early Trigger</span>
                    <p className="font-medium text-text-tertiary">Disabled</p>
                  </div>
                </div>
              </div>
              
              {/* V2 Rules - Only for Manila (marketId === 0) */}
              {marketId === 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="purple">V2</Badge>
                    <span className="text-xs text-text-tertiary">Cumulative rainfall + early trigger</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm pl-2 border-l-2 border-prmx-purple/50">
                    <div>
                      <span className="text-text-secondary">Duration</span>
                      <p className="font-medium text-prmx-purple">2–7 days</p>
                    </div>
                    <div>
                      <span className="text-text-secondary">Min Lead Time</span>
                      <p className="font-medium">{secondsToDays(market.windowRules.minLeadTimeSecs)} days</p>
                    </div>
                    <div>
                      <span className="text-text-secondary">Event Type</span>
                      <p className="font-medium">Cumulative rainfall</p>
                    </div>
                    <div>
                      <span className="text-text-secondary">Early Trigger</span>
                      <p className="font-medium text-success">Enabled</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Insurance Parameters */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-success" />
                Insurance Parameters
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="col-span-2">
                  <span className="text-text-secondary">Strike Threshold</span>
                  <p className="font-medium">
                    {market.strikeValue} mm
                    {marketId === 0 ? (
                      <span className="text-text-tertiary text-xs ml-2">
                        (V1: 24h rolling / V2: cumulative over window)
                      </span>
                    ) : (
                      <span className="text-text-tertiary text-xs ml-2">(24h rolling sum)</span>
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-text-secondary">Payout per Share</span>
                  <p className="font-medium text-success">{formatUSDT(market.payoutPerShare)}</p>
                </div>
                <div>
                  <span className="text-text-secondary">DAO Margin</span>
                  <p className="font-medium">{formatBasisPoints(market.riskParameters.daoMarginBp)}</p>
                </div>
                <div>
                  <span className="text-text-secondary">Status</span>
                  <StatusBadge status={market.status} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rainfall Data */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Droplets className="w-5 h-5 text-prmx-cyan" />
                Oracle Data
              </h2>
            </CardHeader>
            <CardContent>
              {rainfallData ? (() => {
                // Convert from tenths of mm to mm for display
                const displayRainfall = rainfallData.rollingSumMm / 10;
                return (
                <div className="text-center py-4">
                  <p className="text-4xl font-bold text-prmx-cyan">
                    {displayRainfall.toFixed(1)} mm
                  </p>
                  <p className="text-sm text-text-secondary mt-2">
                    24h rolling rainfall sum
                  </p>
                  <div className={`mt-4 p-3 rounded-lg ${
                    displayRainfall >= market.strikeValue 
                      ? 'bg-success/10 border border-success/30' 
                      : 'bg-prmx-cyan/10 border border-prmx-cyan/30'
                  }`}>
                    {displayRainfall >= market.strikeValue ? (
                      <div className="flex items-center justify-center gap-2 text-success">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">Strike threshold reached!</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-prmx-cyan">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm font-medium">
                          {(market.strikeValue - displayRainfall).toFixed(1)} mm to strike
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                );
              })() : (
                <div className="text-center py-8 text-text-secondary">
                  <Droplets className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No rainfall data available</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Quick Actions</h2>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href={`/oracle?marketId=${marketId}`} className="block">
                <Button variant="secondary" className="w-full" icon={<Droplets className="w-4 h-4" />}>
                  View Rainfall Data
                </Button>
              </Link>
              {isConnected && market.status === 'Open' && (
                <Link href="/policies/new" className="block">
                  <Button className="w-full" icon={<Shield className="w-4 h-4" />}>
                    Get Coverage
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Policies Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-prmx-purple" />
              Policies in this Market ({marketPolicies.length})
            </h2>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Policy ID</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Holder</TableHeaderCell>
                <TableHeaderCell>Coverage Period</TableHeaderCell>
                <TableHeaderCell>Shares</TableHeaderCell>
                <TableHeaderCell>Max Payout</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {marketPolicies.length === 0 ? (
                <TableEmpty 
                  colSpan={7} 
                  message="No policies in this market yet"
                  icon={<Shield className="w-8 h-8" />}
                />
              ) : (
                marketPolicies.map((policy) => {
                  const isExpired = policy.coverageEnd <= now;
                  return (
                    <TableRow key={policy.id} className="cursor-pointer hover:bg-background-tertiary/50">
                      <TableCell>
                        <Link href={`/policies/${policy.id}`} className="font-medium hover:text-prmx-cyan">
                          #{policy.id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={policy.policyVersion === 'V2' ? 'purple' : 'default'}>
                          {policy.policyVersion || 'V1'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{formatAddress(policy.holder)}</span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{formatDateTimeUTCCompact(policy.coverageStart)} - {formatDateTimeUTCCompact(policy.coverageEnd)}</p>
                          {policy.status === 'Active' && (
                            <p className={`text-xs ${isExpired ? 'text-warning' : 'text-text-tertiary'}`}>
                              {isExpired ? 'Expired - awaiting settlement' : `Ends in ${Math.ceil((policy.coverageEnd - now) / 86400)} days`}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{Number(policy.shares)}</TableCell>
                      <TableCell className="text-success font-medium">{formatUSDT(policy.maxPayout)}</TableCell>
                      <TableCell>
                        <StatusBadge status={policy.status} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
