'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { 
  ArrowLeft,
  MapPin,
  Calendar,
  DollarSign,
  Clock,
  Users,
  Shield,
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  CloudRain,
  Percent
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { useWalletStore } from '@/stores/walletStore';
import { useV3Policy, useV3OracleState, useV3PolicyLpHolders } from '@/hooks/useV3ChainData';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { 
  V3PolicyStatus,
  V3AggState,
  getEventTypeInfo, 
  formatThresholdValue
} from '@/types/v3';
import { formatUSDT, formatDateTimeUTCCompact, formatTimeRemaining, formatAddress, cn } from '@/lib/utils';

function getStatusBadge(status: V3PolicyStatus, coverageEnd: number) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = coverageEnd <= now;
  
  if (status === 'Active' && isExpired) {
    return <Badge variant="warning" className="text-sm px-3 py-1">Pending Settlement</Badge>;
  }
  
  switch (status) {
    case 'Active':
      return <Badge variant="success" className="text-sm px-3 py-1">Active</Badge>;
    case 'Triggered':
      return <Badge variant="info" className="text-sm px-3 py-1">Event Triggered</Badge>;
    case 'Matured':
      return <Badge variant="default" className="text-sm px-3 py-1">Matured</Badge>;
    case 'Settled':
      return <Badge variant="cyan" className="text-sm px-3 py-1">Settled</Badge>;
    default:
      return <Badge variant="default" className="text-sm px-3 py-1">{status}</Badge>;
  }
}

function formatAggStateValue(aggState: V3AggState): string {
  switch (aggState.type) {
    case 'PrecipSum':
      return `${(aggState.sumMmX1000 / 1000).toFixed(1)} mm`;
    case 'Precip1hMax':
      return `${(aggState.max1hMmX1000 / 1000).toFixed(1)} mm/hr`;
    case 'TempMax':
      return `${(aggState.maxCX1000 / 1000).toFixed(1)}°C`;
    case 'TempMin':
      return `${(aggState.minCX1000 / 1000).toFixed(1)}°C`;
    case 'WindGustMax':
      return `${(aggState.maxMpsX1000 / 1000).toFixed(1)} m/s`;
    case 'PrecipTypeOccurred':
      return `Mask: ${aggState.mask}`;
    default:
      return 'N/A';
  }
}

function getAggStateLabel(aggState: V3AggState): string {
  switch (aggState.type) {
    case 'PrecipSum': return 'Cumulative Rainfall';
    case 'Precip1hMax': return 'Max Hourly Rainfall';
    case 'TempMax': return 'Max Temperature';
    case 'TempMin': return 'Min Temperature';
    case 'WindGustMax': return 'Max Wind Gust';
    case 'PrecipTypeOccurred': return 'Precipitation Types';
    default: return 'Current Value';
  }
}

export default function V3PolicyDetailPage() {
  const params = useParams();
  const policyId = params.id ? parseInt(params.id as string) : null;
  
  const { isConnected, selectedAccount } = useWalletStore();
  const { policy, loading: policyLoading, error, refresh: refreshPolicy } = useV3Policy(policyId);
  const { oracleState, loading: oracleLoading, refresh: refreshOracle } = useV3OracleState(policyId);
  const { holders: lpHolders, loading: holdersLoading, refresh: refreshHolders } = useV3PolicyLpHolders(policyId);
  
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const eventInfo = useMemo(() => 
    policy ? getEventTypeInfo(policy.eventSpec.eventType) : null, 
    [policy]
  );
  
  const isHolder = useMemo(() =>
    policy && selectedAccount && policy.holder === selectedAccount.address,
    [policy, selectedAccount]
  );
  
  const myLpHolding = useMemo(() =>
    selectedAccount ? lpHolders.find(h => h.holder === selectedAccount.address) : null,
    [selectedAccount, lpHolders]
  );
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refreshPolicy(), refreshOracle(), refreshHolders()]);
    setIsRefreshing(false);
  };
  
  if (!isConnected) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/v3/policies">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div>
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
            <h1 className="text-3xl font-bold mt-1">Policy Details</h1>
          </div>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to view policy details
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
  
  if (policyLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/v3/policies">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div className="animate-pulse">
            <div className="h-4 w-16 bg-background-tertiary/50 rounded mb-2" />
            <div className="h-8 w-48 bg-background-tertiary/50 rounded" />
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-32 bg-background-tertiary/50 rounded" />
              </CardContent>
            </Card>
          </div>
          <Card className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-64 bg-background-tertiary/50 rounded" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  
  if (error || !policy) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/v3/policies">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div>
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
            <h1 className="text-3xl font-bold mt-1">Policy Details</h1>
          </div>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <XCircle className="w-16 h-16 mx-auto mb-4 text-error" />
            <h3 className="text-lg font-semibold mb-2">Policy Not Found</h3>
            <p className="text-text-secondary mb-6">
              {error || 'The policy you are looking for does not exist'}
            </p>
            <Link href="/v3/policies">
              <Button>Back to Policies</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const now = Math.floor(Date.now() / 1000);
  const isExpired = policy.coverageEnd <= now;
  const coverageProgress = Math.min(100, Math.max(0, 
    ((now - policy.coverageStart) / (policy.coverageEnd - policy.coverageStart)) * 100
  ));
  
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/v3/policies">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="purple" className="text-xs">V3 P2P</Badge>
              {isHolder && <Badge variant="cyan">Your Policy</Badge>}
              {myLpHolding && !isHolder && <Badge variant="purple">LP Holder</Badge>}
            </div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <span className="text-4xl">{eventInfo?.icon}</span>
              Policy #{policy.id}
            </h1>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </div>
      
      <div className="grid md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Status Card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                {getStatusBadge(policy.status, policy.coverageEnd)}
                {!isExpired && policy.status === 'Active' && (
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Clock className="w-4 h-4" />
                    <span>{formatTimeRemaining(policy.coverageEnd)} remaining</span>
                  </div>
                )}
              </div>
              
              {/* Coverage Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-text-secondary">Coverage Progress</span>
                  <span className="font-medium">
                    {coverageProgress.toFixed(0)}%
                  </span>
                </div>
                <div className="h-3 bg-background-tertiary rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all",
                      policy.status === 'Triggered' ? 'bg-error' : 'bg-prmx-gradient'
                    )}
                    style={{ width: `${coverageProgress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-text-tertiary mt-1">
                  <span>{formatDateTimeUTCCompact(policy.coverageStart)}</span>
                  <span>{formatDateTimeUTCCompact(policy.coverageEnd)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Oracle State / Weather Monitoring */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-prmx-cyan" />
                  Weather Monitoring
                </h3>
                {oracleState && (
                  <span className="text-xs text-text-tertiary">
                    Last updated: {new Date(oracleState.observedUntil * 1000).toLocaleString()}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              {oracleLoading ? (
                <div className="animate-pulse space-y-4">
                  <div className="h-20 bg-background-tertiary/50 rounded" />
                </div>
              ) : oracleState ? (
                <div className="space-y-4">
                  {/* Current Value vs Threshold */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-background-tertiary/50">
                      <p className="text-sm text-text-secondary mb-1">
                        {getAggStateLabel(oracleState.aggState)}
                      </p>
                      <p className="text-2xl font-bold">
                        {formatAggStateValue(oracleState.aggState)}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-background-tertiary/50">
                      <p className="text-sm text-text-secondary mb-1">Trigger Threshold</p>
                      <p className="text-2xl font-bold">
                        {formatThresholdValue(
                          policy.eventSpec.threshold.value,
                          policy.eventSpec.threshold.unit
                        )}
                      </p>
                    </div>
                  </div>
                  
                  {/* Progress to trigger (visual) */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-text-secondary">Progress to Trigger</span>
                    </div>
                    <div className="h-4 bg-background-tertiary rounded-full overflow-hidden relative">
                      {/* Calculate progress based on agg state vs threshold */}
                      <div 
                        className={cn(
                          "h-full transition-all",
                          policy.status === 'Triggered' 
                            ? 'bg-error' 
                            : 'bg-gradient-to-r from-success via-warning to-error'
                        )}
                        style={{ 
                          width: `${Math.min(100, getProgressToTrigger(oracleState.aggState, policy.eventSpec.threshold.value))}%` 
                        }}
                      />
                      <div 
                        className="absolute top-0 h-full w-0.5 bg-white"
                        style={{ left: '100%', transform: 'translateX(-2px)' }}
                      />
                    </div>
                  </div>
                  
                  {/* Commitment hash */}
                  <div className="p-3 rounded-lg bg-prmx-cyan/10 border border-prmx-cyan/30">
                    <p className="text-xs text-text-secondary mb-1">Commitment Hash</p>
                    <code className="text-xs break-all">{oracleState.commitment}</code>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-text-secondary">
                  <CloudRain className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No oracle data available yet</p>
                  <p className="text-sm text-text-tertiary">
                    Weather monitoring will begin when coverage starts
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Event Details */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Coverage Details</h3>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-text-secondary mb-1">Event Type</p>
                    <p className="font-medium text-lg">{eventInfo?.label}</p>
                    <p className="text-sm text-text-tertiary">{eventInfo?.description}</p>
                  </div>
                  <div>
                    <p className="text-sm text-text-secondary mb-1">Trigger Threshold</p>
                    <p className="font-medium text-lg">
                      {formatThresholdValue(policy.eventSpec.threshold.value, policy.eventSpec.threshold.unit)}
                    </p>
                  </div>
                  {policy.eventSpec.earlyTrigger && (
                    <Badge variant="warning">Early Trigger Enabled</Badge>
                  )}
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-text-secondary mb-1">
                      <MapPin className="w-4 h-4 inline mr-1" />
                      Location
                    </p>
                    <p className="font-medium text-lg">{policy.location?.name || `Location #${policy.locationId}`}</p>
                  </div>
                  <div>
                    <p className="text-sm text-text-secondary mb-1">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      Coverage Period
                    </p>
                    <p className="font-medium">
                      {formatDateTimeUTCCompact(policy.coverageStart)} - {formatDateTimeUTCCompact(policy.coverageEnd)}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* LP Holders */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Users className="w-5 h-5" />
                LP Token Holders
              </h3>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Holder</TableHeaderCell>
                    <TableHeaderCell>LP Shares</TableHeaderCell>
                    <TableHeaderCell>Ownership</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {holdersLoading ? (
                    <TableRow className="animate-pulse">
                      <TableCell><div className="h-4 w-32 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-16 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-16 bg-background-tertiary/50 rounded" /></TableCell>
                    </TableRow>
                  ) : lpHolders.length === 0 ? (
                    <TableEmpty
                      icon={<Users className="w-8 h-8" />}
                      title="No LP holders"
                      description="No underwriters have accepted this policy yet"
                    />
                  ) : (
                    lpHolders.map((holder) => {
                      const isMe = holder.holder === selectedAccount?.address;
                      return (
                        <TableRow key={holder.holder}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <code className="text-sm">{formatAddress(holder.holder)}</code>
                              {isMe && <Badge variant="cyan">You</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{holder.lpShares}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-background-tertiary rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-prmx-gradient"
                                  style={{ width: `${holder.percentageOwned}%` }}
                                />
                              </div>
                              <span className="text-sm">{holder.percentageOwned.toFixed(1)}%</span>
                            </div>
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
        
        {/* Sidebar */}
        <div className="space-y-6">
          {/* Financial Summary */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Financial Summary
              </h3>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <div className="flex justify-between">
                <span className="text-text-secondary">Total Shares</span>
                <span className="font-medium">{policy.totalShares}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Premium Paid</span>
                <span className="font-medium text-success">{formatUSDT(policy.premiumPaid)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Max Payout</span>
                <span className="font-medium text-prmx-cyan">{formatUSDT(policy.maxPayout)}</span>
              </div>
              <hr className="border-border-primary" />
              <div className="flex justify-between">
                <span className="text-text-secondary">Payout per Share</span>
                <span className="font-medium">{formatUSDT(policy.maxPayout / BigInt(policy.totalShares))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Premium per Share</span>
                <span className="font-medium">{formatUSDT(policy.premiumPaid / BigInt(policy.totalShares))}</span>
              </div>
            </CardContent>
          </Card>
          
          {/* My Position */}
          {(isHolder || myLpHolding) && (
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Percent className="w-5 h-5" />
                  My Position
                </h3>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                {isHolder && (
                  <div className="p-3 rounded-lg bg-prmx-cyan/10 border border-prmx-cyan/30">
                    <p className="text-sm font-medium text-prmx-cyan">Policy Holder</p>
                    <p className="text-xs text-text-secondary mt-1">
                      You will receive the payout if the weather event occurs
                    </p>
                  </div>
                )}
                {myLpHolding && (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-text-secondary">My LP Shares</span>
                      <span className="font-medium">{myLpHolding.lpShares}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Ownership</span>
                      <span className="font-medium">{myLpHolding.percentageOwned.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">My Collateral</span>
                      <span className="font-medium">
                        {formatUSDT(BigInt(myLpHolding.lpShares) * BigInt(100_000_000))}
                      </span>
                    </div>
                    {policy.status === 'Active' && !isExpired && (
                      <Link href="/lp">
                        <Button variant="secondary" size="sm" className="w-full mt-2">
                          Trade LP Tokens
                        </Button>
                      </Link>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* Policyholder Info */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Policyholder</h3>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-prmx-gradient flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <code className="text-sm">{formatAddress(policy.holder)}</code>
                  {isHolder && <Badge variant="cyan" className="ml-2">You</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Related Links */}
          <Card>
            <CardContent className="p-6 space-y-3">
              <Link href={`/v3/requests/${policy.id}`}>
                <Button variant="secondary" className="w-full" size="sm">
                  View Original Request
                </Button>
              </Link>
              <Link href="/v3/requests">
                <Button variant="ghost" className="w-full" size="sm">
                  Browse Marketplace
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Helper function to calculate progress to trigger
function getProgressToTrigger(aggState: V3AggState, threshold: number): number {
  let currentValue: number;
  
  switch (aggState.type) {
    case 'PrecipSum':
      currentValue = aggState.sumMmX1000;
      break;
    case 'Precip1hMax':
      currentValue = aggState.max1hMmX1000;
      break;
    case 'TempMax':
      currentValue = aggState.maxCX1000;
      break;
    case 'TempMin':
      // For min temp, we want to track how close we are to going below threshold
      // This is inverted logic
      return threshold > 0 ? Math.max(0, 100 - (aggState.minCX1000 / threshold) * 100) : 0;
    case 'WindGustMax':
      currentValue = aggState.maxMpsX1000;
      break;
    case 'PrecipTypeOccurred':
      // Binary check - if any bit matches threshold mask, it's 100%
      return (aggState.mask & threshold) ? 100 : 0;
    default:
      return 0;
  }
  
  if (threshold <= 0) return 0;
  return (currentValue / threshold) * 100;
}

