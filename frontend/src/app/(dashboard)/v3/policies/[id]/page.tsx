'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  Percent,
  FileText,
  ChevronRight,
  ShoppingCart,
  Copy,
  Check,
  TrendingUp
} from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useWalletStore } from '@/stores/walletStore';
import { useV3Policy, useV3OracleState, useV3PolicyLpHolders, useV3Observations } from '@/hooks/useV3ChainData';
import { WeatherHistoryChart } from '@/components/features/WeatherHistoryChart';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { 
  V3PolicyStatus,
  V3AggState,
  getEventTypeInfo, 
  formatThresholdValue
} from '@/types/v3';
import { formatUSDT, formatDateTimeUTCCompact, formatTimeRemaining, formatAddress, cn } from '@/lib/utils';
import * as api from '@/lib/api';
import * as apiV3 from '@/lib/api-v3';
import { formatId } from '@/lib/api-v3';
import type { PolicyDefiInfo } from '@/types';
import { useIsDao } from '@/stores/walletStore';
import { Modal } from '@/components/ui/Modal';
import { AlertCircle } from 'lucide-react';

// Snapshot scheduling constants (matching pallet-oracle-v3)
const V3_SNAPSHOT_INTERVAL_SECS = 6 * 3600;  // 6 hours
const V3_SNAPSHOT_INTERVAL_FINAL_SECS = 3600; // 1 hour (final 24h)

/**
 * Calculate next snapshot time based on OCW scheduling logic
 */
function getNextSnapshotInfo(
  observedUntil: number,
  coverageStart: number,
  coverageEnd: number,
  status: V3PolicyStatus
): { label: string; timestamp: number | null; isUrgent: boolean } {
  const now = Math.floor(Date.now() / 1000);
  
  // Policy is not active
  if (status !== 'Active') {
    return { label: 'Policy finalized', timestamp: null, isUrgent: false };
  }
  
  // Coverage hasn't started
  if (now < coverageStart) {
    return { label: 'Starts after coverage begins', timestamp: coverageStart, isUrgent: false };
  }
  
  // Coverage has ended
  if (now > coverageEnd) {
    return { label: 'Pending final report', timestamp: null, isUrgent: true };
  }
  
  // Calculate interval based on time remaining
  const timeToEnd = coverageEnd - now;
  const isInFinal24Hours = timeToEnd <= 24 * 3600;
  const interval = isInFinal24Hours ? V3_SNAPSHOT_INTERVAL_FINAL_SECS : V3_SNAPSHOT_INTERVAL_SECS;
  
  // No observations yet
  if (observedUntil === 0) {
    return { 
      label: 'Awaiting first observation', 
      timestamp: null, 
      isUrgent: false 
    };
  }
  
  // Calculate next snapshot time
  const lastSnapshotApprox = observedUntil; // Best approximation
  const nextSnapshot = lastSnapshotApprox + interval;
  
  // If next snapshot time is in the past, it should happen soon
  if (nextSnapshot <= now) {
    return { 
      label: 'Due now', 
      timestamp: now, 
      isUrgent: true 
    };
  }
  
  return {
    label: formatTimeRemaining(nextSnapshot),
    timestamp: nextSnapshot,
    isUrgent: isInFinal24Hours
  };
}

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
  // Check for sentinel values (i64::MIN for max types, i64::MAX for min types)
  // These indicate no observations have been recorded yet
  const I64_MIN_APPROX = -9223372036854775000; // Close to i64::MIN
  const I64_MAX_APPROX = 9223372036854775000;  // Close to i64::MAX
  
  switch (aggState.type) {
    case 'PrecipSum':
      return `${(aggState.sumMmX1000 / 1000).toFixed(1)} mm`;
    case 'Precip1hMax':
      if (aggState.max1hMmX1000 < I64_MIN_APPROX) return 'No data';
      return `${(aggState.max1hMmX1000 / 1000).toFixed(1)} mm/hr`;
    case 'TempMax':
      if (aggState.maxCX1000 < I64_MIN_APPROX) return 'No data';
      return `${(aggState.maxCX1000 / 1000).toFixed(1)}°C`;
    case 'TempMin':
      if (aggState.minCX1000 > I64_MAX_APPROX) return 'No data';
      return `${(aggState.minCX1000 / 1000).toFixed(1)}°C`;
    case 'WindGustMax':
      if (aggState.maxMpsX1000 < I64_MIN_APPROX) return 'No data';
      return `${(aggState.maxMpsX1000 / 1000).toFixed(1)} m/s`;
    case 'PrecipTypeOccurred':
      return aggState.mask === 0 ? 'None' : `Mask: ${aggState.mask}`;
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
  const router = useRouter();
  // Policy ID is now an H128 hex string
  const policyId = params.id ? String(params.id) : null;
  
  const { isConnected, selectedAccount } = useWalletStore();
  const { policy, loading: policyLoading, error, refresh: refreshPolicy } = useV3Policy(policyId);
  
  // Check if V1/V2 policy exists when V3 policy is not found - redirect if so
  // With hash-based IDs, policies are uniquely identified - no collision possible
  useEffect(() => {
    if (policyLoading || policy || policyId === null) return;
    
    // V3 policy not found, check if V1/V2 policy exists
    const checkLegacyPolicy = async () => {
      try {
        const legacyPolicies = await api.getPolicies();
        const legacyPolicy = legacyPolicies.find(p => p.id === policyId);
        if (legacyPolicy) {
          // V1/V2 policy exists - redirect to legacy page
          router.push(`/policies/${policyId}`);
        }
      } catch (err) {
        console.error('Failed to check legacy policy:', err);
      }
    };
    
    checkLegacyPolicy();
  }, [policyLoading, policy, policyId, router]);
  const { oracleState, loading: oracleLoading, refresh: refreshOracle } = useV3OracleState(policyId);
  const { holders: lpHolders, loading: holdersLoading, refresh: refreshHolders } = useV3PolicyLpHolders(policyId);
  const { observations, loading: observationsLoading, error: observationsError, refresh: refreshObservations } = useV3Observations(policyId);
  
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [defiInfo, setDefiInfo] = useState<PolicyDefiInfo | null>(null);
  const [defiLoading, setDefiLoading] = useState(true);
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const [poolBalance, setPoolBalance] = useState<bigint | null>(null);
  
  const isDao = useIsDao();
  
  const handleCopyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    toast.success('Address copied to clipboard!');
    setTimeout(() => setCopiedAddress(null), 2000);
  };
  
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
  
  // Check if user can allocate (DAO or >=51% LP holder)
  const canAllocate = useMemo(() => {
    if (!policy || !selectedAccount) return false;
    if (isDao) return true; // DAO can always allocate
    if (!myLpHolding || !policy.totalShares) return false;
    // Check if LP holder has >=51% ownership
    const ownershipPercentage = (myLpHolding.lpShares / policy.totalShares) * 100;
    return ownershipPercentage >= 51;
  }, [policy, selectedAccount, isDao, myLpHolding]);
  
  const handleAllocateToDefi = async () => {
    if (!policyId || !policy || !selectedAccount || !poolBalance || poolBalance === 0n) {
      toast.error('Cannot allocate: insufficient pool balance');
      return;
    }
    
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }
    
    setIsAllocating(true);
    try {
      // Allocate 100% of pool balance
      if (isDao) {
        // DAO uses sudo
        await api.allocatePolicyToDefi(keypair, policyId, poolBalance);
      } else {
        // LP holder uses direct call
        await api.lpAllocatePolicyToDefi(keypair, policyId, poolBalance);
      }
      toast.success('Successfully allocated policy capital to DeFi strategy');
      setShowAllocationModal(false);
      
      // Refresh data
      await Promise.all([
        refreshPolicy(),
        api.getPolicyDefiInfo(policyId).then(setDefiInfo),
        apiV3.getV3PolicyPoolBalance(policyId).then(setPoolBalance)
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to allocate to DeFi');
    } finally {
      setIsAllocating(false);
    }
  };
  
  // Load DeFi allocation info and pool balance
  useEffect(() => {
    if (policyId === null || policyId === undefined) {
      setDefiLoading(false);
      return;
    }
    
    let cancelled = false;
    let timeoutId: NodeJS.Timeout;
    
    const loadDefiInfo = async () => {
      setDefiLoading(true);
      
      // Set a timeout to ensure we don't load forever
      timeoutId = setTimeout(() => {
        if (!cancelled) {
          setDefiInfo({
            investmentStatus: 'NotInvested',
            position: null,
            isAllocatedToDefi: false,
          });
          setPoolBalance(BigInt(0));
          setDefiLoading(false);
        }
      }, 5000);
      
      try {
        // Run queries in parallel with individual error handling
        const [defiResult, balanceResult, poolAccountResult] = await Promise.allSettled([
          api.getPolicyDefiInfo(policyId),
          apiV3.getV3PolicyPoolBalance(policyId),
          apiV3.getV3PolicyPoolAccount(policyId)
        ]);
        
        clearTimeout(timeoutId);
        
        if (cancelled) return;
        
        // Get pool account address
        const poolAccount = poolAccountResult.status === 'fulfilled' ? poolAccountResult.value : undefined;
        
        // Handle defi info
        if (defiResult.status === 'fulfilled') {
          setDefiInfo({ ...defiResult.value, poolAccount });
        } else {
          setDefiInfo({
            investmentStatus: 'NotInvested',
            position: null,
            isAllocatedToDefi: false,
            poolAccount,
          });
        }
        
        // Handle pool balance
        if (balanceResult.status === 'fulfilled') {
          setPoolBalance(balanceResult.value);
        } else {
          setPoolBalance(BigInt(0));
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (!cancelled) {
          setDefiInfo({
            investmentStatus: 'NotInvested',
            position: null,
            isAllocatedToDefi: false,
          });
          setPoolBalance(BigInt(0));
        }
      } finally {
        if (!cancelled) {
          setDefiLoading(false);
        }
      }
    };
    
    loadDefiInfo();
    
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [policyId]);
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshPolicy(), refreshOracle(), refreshHolders(), refreshObservations()]);
      // Refresh DeFi info
      if (policyId) {
        try {
          const defi = await api.getPolicyDefiInfo(policyId);
          setDefiInfo(defi);
        } catch (err) {
          console.error('Failed to refresh DeFi info:', err);
        }
      }
    } finally {
      // Ensure animation is visible for at least 500ms
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };
  
  if (!isConnected) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
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
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
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
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
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
  
  // Get status badge for header (smaller size)
  const getHeaderStatusBadge = (status: V3PolicyStatus, coverageEnd: number) => {
    if (status === 'Active' && coverageEnd <= now) {
      return <Badge variant="warning" className="text-xs">Pending Settlement</Badge>;
    }
    switch (status) {
      case 'Active':
        return <Badge variant="success" className="text-xs">Active</Badge>;
      case 'Triggered':
        return <Badge variant="info" className="text-xs">Event Triggered</Badge>;
      case 'Matured':
        return <Badge variant="default" className="text-xs">Matured</Badge>;
      case 'Settled':
        return <Badge variant="cyan" className="text-xs">Settled</Badge>;
      default:
        return <Badge variant="default" className="text-xs">{status}</Badge>;
    }
  };
  
  return (
    <div className="space-y-8 max-w-6xl mx-auto pt-4">
      {/* Header */}
      {(() => {
        // Format short policy ID for avatar
        const shortId = typeof policy.id === 'string' && policy.id.startsWith('0x') 
          ? policy.id.slice(2, 10) 
          : String(policy.id).slice(0, 8);
        const displayId = typeof policy.id === 'string' && policy.id.startsWith('0x')
          ? policy.id.slice(2, 14) + '...'
          : String(policy.id);
        
        return (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/v3/policies">
                <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                  Back
                </Button>
              </Link>
              
              {/* Subtle gradient avatar - matching V1/V2 style */}
              <div 
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-mono text-lg font-bold shadow-sm flex-shrink-0 bg-gradient-to-br from-gray-600 to-gray-700 dark:from-slate-600 dark:to-slate-700 border border-gray-500/30"
              >
                {shortId.slice(0, 4).toUpperCase()}
              </div>
              
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300 uppercase">
                    V3
                  </span>
                  {isHolder && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 uppercase">
                      Your Policy
                    </span>
                  )}
                  {myLpHolding && !isHolder && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300 uppercase">
                      LP Holder
                    </span>
                  )}
                  {getHeaderStatusBadge(policy.status, policy.coverageEnd)}
                  {policy.location && (
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {policy.location.name}
                    </span>
                  )}
                </div>
                <h1 className="text-2xl font-bold font-mono text-text-primary">
                  {displayId}
                </h1>
                <p className="text-sm text-text-tertiary mt-0.5">
                  {eventInfo?.label} ≥ {formatThresholdValue(policy.eventSpec.threshold.value, policy.eventSpec.threshold.unit)}
                </p>
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
        );
      })()}
      
      <div className="grid md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Coverage Details - Sleek design */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-prmx-purple/10 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-prmx-purple" />
                  </div>
                  <h3 className="text-base font-semibold">Coverage Details</h3>
                </div>
              </div>
              
              <div className="p-5">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Left column - Event info */}
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs text-text-tertiary mb-1">Event Type</p>
                      <p className="text-base font-semibold">{eventInfo?.label}</p>
                      <p className="text-xs text-text-tertiary mt-1">{eventInfo?.description}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-tertiary mb-1">Trigger Threshold</p>
                      <p className="text-xl font-bold text-prmx-cyan">
                        {formatThresholdValue(policy.eventSpec.threshold.value, policy.eventSpec.threshold.unit)}
                      </p>
                    </div>
                  </div>
                  
                  {/* Right column - Location & Period */}
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <MapPin className="w-3.5 h-3.5 text-text-tertiary" />
                        <p className="text-xs text-text-tertiary">Location</p>
                      </div>
                      <p className="text-base font-semibold">{policy.location?.name || `Location #${policy.locationId}`}</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Calendar className="w-3.5 h-3.5 text-text-tertiary" />
                        <p className="text-xs text-text-tertiary">Coverage Period</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-center px-3 py-2 rounded-lg bg-background-tertiary/50 flex-1">
                          <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Start</p>
                          <p className="font-semibold text-sm mt-0.5">
                            {new Date(policy.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          <p className="text-[10px] text-text-tertiary">
                            {new Date(policy.coverageStart * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })} UTC
                          </p>
                        </div>
                        <span className="text-text-tertiary text-sm">→</span>
                        <div className="text-center px-3 py-2 rounded-lg bg-background-tertiary/50 flex-1">
                          <p className="text-[10px] text-text-tertiary uppercase tracking-wide">End</p>
                          <p className="font-semibold text-sm mt-0.5">
                            {new Date(policy.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          <p className="text-[10px] text-text-tertiary">
                            {new Date(policy.coverageEnd * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })} UTC
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
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
                      policy.status === 'Triggered' ? 'bg-error' : 'bg-gradient-to-br from-slate-700 to-slate-800'
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
          
          {/* Oracle State / Weather Monitoring - Sleek design */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                      <Activity className="w-4 h-4 text-prmx-cyan" />
                    </div>
                    <h3 className="text-base font-semibold">Weather Monitoring</h3>
                  </div>
                  <span className="text-[11px] text-text-tertiary">
                    {oracleState?.observedUntil && oracleState.observedUntil > 0 
                      ? `Updated ${new Date(oracleState.observedUntil * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                      : now < policy.coverageStart
                        ? `Starts in ${formatTimeRemaining(policy.coverageStart)}`
                        : 'Awaiting data'
                    }
                  </span>
                </div>
              </div>
              
              {oracleLoading ? (
                <div className="px-5 py-6">
                  <div className="animate-pulse space-y-3">
                    <div className="h-12 bg-background-tertiary/50 rounded-lg" />
                    <div className="h-4 bg-background-tertiary/50 rounded w-2/3" />
                  </div>
                </div>
              ) : oracleState ? (
                <div className="px-5 py-4 space-y-4">
                  {/* Current Value vs Threshold - Side by side */}
                  <div className="flex items-stretch gap-3">
                    <div className="flex-1 p-3 rounded-lg bg-background-tertiary/30">
                      <p className="text-xs text-text-tertiary mb-1">
                        {getAggStateLabel(oracleState.aggState)}
                      </p>
                      <p className="text-xl font-bold text-prmx-cyan">
                        {formatAggStateValue(oracleState.aggState)}
                      </p>
                    </div>
                    <div className="flex items-center text-text-tertiary">
                      <span className="text-xs">/</span>
                    </div>
                    <div className="flex-1 p-3 rounded-lg bg-background-tertiary/30">
                      <p className="text-xs text-text-tertiary mb-1">Threshold</p>
                      <p className="text-xl font-bold">
                        {formatThresholdValue(
                          policy.eventSpec.threshold.value,
                          policy.eventSpec.threshold.unit
                        )}
                      </p>
                    </div>
                  </div>
                  
                  {/* Threshold proximity bar */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs text-text-tertiary">Progress</span>
                      <span className="text-xs font-medium">
                        {Math.min(100, getThresholdProximity(oracleState.aggState, policy.eventSpec.threshold.value)).toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full transition-all rounded-full",
                          policy.status === 'Triggered' ? 'bg-error' : 'bg-prmx-cyan'
                        )}
                        style={{ 
                          width: `${Math.min(100, getThresholdProximity(oracleState.aggState, policy.eventSpec.threshold.value))}%` 
                        }}
                      />
                    </div>
                  </div>
                  
                  {/* Next Snapshot & Commitment - Compact */}
                  {(() => {
                    const snapshotInfo = getNextSnapshotInfo(
                      oracleState.observedUntil,
                      policy.coverageStart,
                      policy.coverageEnd,
                      policy.status
                    );
                    const now = Math.floor(Date.now() / 1000);
                    const isInFinal24h = policy.coverageEnd - now <= 24 * 3600;
                    
                    return (
                      <div className="pt-3 border-t border-border-primary/30 space-y-3">
                        {/* Next Snapshot */}
                        {policy.status === 'Active' && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 text-text-tertiary" />
                              <span className="text-xs text-text-tertiary">Next update</span>
                            </div>
                            <div className="text-right">
                              <span className={cn(
                                "text-sm font-medium",
                                snapshotInfo.isUrgent ? "text-amber-500" : "text-text-primary"
                              )}>
                                {snapshotInfo.label}
                              </span>
                              <p className="text-[10px] text-text-tertiary">
                                {isInFinal24h ? 'Hourly' : 'Every 6h'}
                              </p>
                            </div>
                          </div>
                        )}
                        
                        {/* Commitment hash - Collapsible style */}
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs text-text-tertiary flex-shrink-0">Commitment</span>
                          <code className="text-[10px] text-text-secondary font-mono break-all text-right leading-relaxed">
                            {oracleState.commitment.slice(0, 24)}...
                          </code>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="px-5 py-8 text-center">
                  <CloudRain className="w-10 h-10 mx-auto mb-3 text-text-tertiary/50" />
                  <p className="text-sm text-text-secondary">No data yet</p>
                  <p className="text-xs text-text-tertiary mt-1">
                    Monitoring starts with coverage
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Weather History Chart */}
          {policy && (
            <WeatherHistoryChart
              observations={observations}
              eventType={policy.eventSpec.eventType}
              threshold={policy.eventSpec.threshold.value}
              thresholdUnit={policy.eventSpec.threshold.unit}
              coverageStart={policy.coverageStart}
              coverageEnd={policy.coverageEnd}
              loading={observationsLoading}
              error={observationsError}
            />
          )}
          
          {/* Settlement Outcome - Only show for settled policies */}
          {(policy.status === 'Triggered' || policy.status === 'Matured' || policy.status === 'Settled') && (
            <Card className={cn(
              "border-2",
              policy.status === 'Triggered' || oracleState?.status === 'Triggered'
                ? "border-success/50 bg-success/5"
                : "border-prmx-cyan/50 bg-prmx-cyan/5"
            )}>
              <CardHeader>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  {policy.status === 'Triggered' || oracleState?.status === 'Triggered' ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-success" />
                      Event Triggered - Payout Distributed
                    </>
                  ) : (
                    <>
                      <Shield className="w-5 h-5 text-prmx-cyan" />
                      Policy Matured - No Event
                    </>
                  )}
                </h3>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {/* Outcome Summary */}
                  <div className={cn(
                    "p-4 rounded-lg",
                    policy.status === 'Triggered' || oracleState?.status === 'Triggered'
                      ? "bg-success/10"
                      : "bg-prmx-cyan/10"
                  )}>
                    {policy.status === 'Triggered' || oracleState?.status === 'Triggered' ? (
                      <div className="space-y-2">
                        <p className="text-sm text-text-secondary">
                          The weather event threshold was reached. The policyholder receives the full payout.
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-text-secondary">Payout to Holder</span>
                          <span className="text-2xl font-bold text-success">
                            {formatUSDT(policy.maxPayout, false)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text-tertiary">LP Collateral</span>
                          <span className="text-text-secondary">Forfeited (paid to holder)</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-text-secondary">
                          Coverage ended without the weather event occurring. LP providers receive their collateral back plus earned premium.
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-text-secondary">Returned to LPs</span>
                          <span className="text-2xl font-bold text-prmx-cyan">
                            {formatUSDT(policy.maxPayout, false)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text-tertiary">Breakdown</span>
                          <span className="text-text-secondary">
                            {formatUSDT(policy.maxPayout - policy.premiumPaid, false)} collateral + {formatUSDT(policy.premiumPaid, false)} premium
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Final Weather Reading */}
                  {oracleState && (
                    <div className="p-3 rounded-lg bg-background-tertiary/50">
                      <p className="text-xs text-text-secondary mb-1">Final Weather Reading</p>
                      <p className="font-medium">
                        {getAggStateLabel(oracleState.aggState)}: {formatAggStateValue(oracleState.aggState)}
                      </p>
                      <p className="text-xs text-text-tertiary mt-1">
                        Threshold: {formatThresholdValue(policy.eventSpec.threshold.value, policy.eventSpec.threshold.unit)}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* LP Holders - Refined design */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5 text-text-secondary" />
                  LP Token Holders
                </h2>
                {!holdersLoading && lpHolders.length > 0 && (
                  <span className="text-sm text-text-tertiary">
                    {lpHolders.reduce((sum, h) => sum + h.lpShares, 0).toLocaleString()} total shares
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {holdersLoading ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-12 bg-background-tertiary/50 rounded-lg" />
                  <div className="h-12 bg-background-tertiary/50 rounded-lg" />
                </div>
              ) : lpHolders.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-10 h-10 mx-auto mb-3 text-text-tertiary/50" />
                  <p className="text-text-secondary text-sm">No LP holders yet</p>
                  <p className="text-text-tertiary text-xs mt-1">
                    No underwriters have accepted this policy yet
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lpHolders.map((holder, idx) => {
                    const isMe = holder.holder === selectedAccount?.address;
                    
                    return (
                      <div 
                        key={holder.holder}
                        className="group flex items-center gap-3 p-3 rounded-lg hover:bg-background-tertiary/50 transition-colors"
                      >
                        {/* Rank indicator */}
                        <div className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0",
                          idx === 0 
                            ? "bg-prmx-cyan/20 text-prmx-cyan" 
                            : "bg-background-tertiary text-text-tertiary"
                        )}>
                          {idx + 1}
                        </div>
                        
                        {/* Address & shares */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCopyAddress(holder.holder)}
                              className="flex items-center gap-1.5 group/copy cursor-pointer"
                              title="Click to copy address"
                            >
                              <code className="text-sm font-medium text-text-primary group-hover/copy:text-prmx-cyan transition-colors">
                                {formatAddress(holder.holder)}
                              </code>
                              {copiedAddress === holder.holder ? (
                                <Check className="w-3.5 h-3.5 text-success" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 group-hover/copy:text-prmx-cyan transition-all" />
                              )}
                            </button>
                            {isMe && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-prmx-cyan/20 text-prmx-cyan">
                                You
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-tertiary mt-0.5">
                            {holder.lpShares.toLocaleString()} shares
                          </p>
                        </div>
                        
                        {/* Ownership percentage with mini bar */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-12 h-1.5 rounded-full bg-background-tertiary overflow-hidden">
                            <div 
                              className="h-full bg-prmx-cyan rounded-full"
                              style={{ width: `${holder.percentageOwned}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-text-primary w-12 text-right">
                            {holder.percentageOwned.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        {/* Sidebar */}
        <div className="space-y-6">
          {/* Financial Summary - Sleek design */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header with gradient accent */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                  </div>
                  <h2 className="text-base font-semibold">Financial Summary</h2>
                </div>
              </div>
              
              {/* Max Payout highlight */}
              <div className="px-5 py-4 bg-gradient-to-r from-emerald-500/5 to-transparent">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">Max Payout</span>
                  <span className="text-2xl font-bold text-emerald-500">{formatUSDT(policy.maxPayout, false)}</span>
                </div>
              </div>
              
              {/* Details */}
              <div className="px-5 py-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-tertiary">Shares</span>
                  <span className="text-sm font-medium">{policy.totalShares}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-tertiary">Premium / Share</span>
                  <span className="text-sm font-medium">{formatUSDT(policy.premiumPerShare, false)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-tertiary">Premium Paid</span>
                  <span className="text-sm font-medium text-prmx-cyan">{formatUSDT(policy.premiumPaid, false)}</span>
                </div>
                <div className="h-px bg-border-primary/50 my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-tertiary">Payout / Share</span>
                  <span className="text-sm font-medium">$100</span>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* DeFi Allocation Card - Sleek design */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-violet-500" />
                    </div>
                    <h2 className="text-base font-semibold">DeFi Strategy</h2>
                  </div>
                  {!defiLoading && defiInfo && (
                    <span className={cn(
                      "text-xs font-medium px-2 py-1 rounded-full",
                      defiInfo.isAllocatedToDefi 
                        ? "bg-emerald-500/10 text-emerald-500" 
                        : "bg-text-tertiary/10 text-text-tertiary"
                    )}>
                      {defiInfo.isAllocatedToDefi ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </div>
              </div>
              
              {defiLoading ? (
                <div className="px-5 py-6">
                  <div className="animate-pulse space-y-3">
                    <div className="h-4 bg-background-tertiary/50 rounded w-2/3" />
                    <div className="h-4 bg-background-tertiary/50 rounded w-1/2" />
                  </div>
                </div>
              ) : defiInfo ? (
                <div className="px-5 py-4">
                  {/* Status indicator */}
                  {defiInfo.isAllocatedToDefi ? (
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs text-text-secondary">
                        Earning yield via Hydration Stableswap
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-text-tertiary mb-4">
                      Funds available for DeFi allocation
                    </p>
                  )}

                  {/* Position Details */}
                  {defiInfo.position ? (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-tertiary">Principal</span>
                        <span className="text-sm font-semibold text-emerald-500">
                          {formatUSDT(defiInfo.position.principalUsdt, false)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-tertiary">LP Tokens</span>
                        <span className="text-sm font-medium">
                          {(Number(defiInfo.position.lpShares) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  ) : poolBalance !== null && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-text-tertiary">Pool Balance</span>
                      <span className="text-sm font-medium">{formatUSDT(poolBalance, false)}</span>
                    </div>
                  )}
                  
                  {/* Pool Account */}
                  {defiInfo.poolAccount && (
                    <div className="mt-4 pt-3 border-t border-border-primary/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-tertiary">Pool</span>
                        <button
                          onClick={() => handleCopyAddress(defiInfo.poolAccount!)}
                          className="flex items-center gap-1.5 group"
                          title="Copy address"
                        >
                          <code className="text-xs font-mono text-text-secondary group-hover:text-prmx-cyan transition-colors">
                            {formatAddress(defiInfo.poolAccount)}
                          </code>
                          {copiedAddress === defiInfo.poolAccount ? (
                            <Check className="w-3 h-3 text-success" />
                          ) : (
                            <Copy className="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Allocate Button */}
                  {!defiInfo.isAllocatedToDefi && canAllocate && poolBalance !== null && poolBalance > 0n && (
                    <div className="mt-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        onClick={() => setShowAllocationModal(true)}
                        icon={<TrendingUp className="w-4 h-4" />}
                      >
                        Allocate to DeFi
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-5 py-6 text-center">
                  <p className="text-sm text-text-tertiary">Unable to load status</p>
                </div>
              )}
              
              {/* Footer note */}
              <div className="px-5 py-3 bg-background-tertiary/30 border-t border-border-primary/30">
                <p className="text-[11px] text-text-tertiary">
                  DAO guarantees coverage of DeFi losses
                </p>
              </div>
            </CardContent>
          </Card>
          
          {/* Allocation Confirmation Modal */}
          <Modal
            isOpen={showAllocationModal}
            onClose={() => !isAllocating && setShowAllocationModal(false)}
            title="Allocate to DeFi Strategy"
            size="md"
          >
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-warning mb-1">Confirm DeFi Allocation</p>
                    <p className="text-xs text-text-secondary">
                      This will allocate {poolBalance !== null ? formatUSDT(poolBalance, false) : 'all available'} from the policy pool to the DeFi yield strategy (Hydration Stableswap Pool 102).
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Policy ID</span>
                  <span className="font-medium">#{policyId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Pool Balance</span>
                  <span className="font-medium">{poolBalance !== null ? formatUSDT(poolBalance, false) : 'Loading...'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Allocation Amount</span>
                  <span className="font-medium text-success">{poolBalance !== null ? formatUSDT(poolBalance, false) : 'Loading...'}</span>
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-background-tertiary/50">
                <p className="text-xs text-text-secondary">
                  <strong>Note:</strong> The DAO guarantees coverage of potential losses from DeFi investments. 
                  Funds will be allocated to the Hydration Stableswap Pool 102 (Mock Strategy in current setup).
                </p>
              </div>
              
              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowAllocationModal(false)}
                  disabled={isAllocating}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleAllocateToDefi}
                  loading={isAllocating}
                  icon={<TrendingUp className="w-4 h-4" />}
                >
                  {isAllocating ? 'Allocating...' : 'Confirm Allocation'}
                </Button>
              </div>
            </div>
          </Modal>
          
          {/* My Position - Sleek design */}
          {(isHolder || myLpHolding) && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                      <Percent className="w-4 h-4 text-prmx-cyan" />
                    </div>
                    <h3 className="text-base font-semibold">My Position</h3>
                  </div>
                </div>
                
                <div className="px-5 py-4">
                  {isHolder && (
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-2 h-2 rounded-full bg-prmx-cyan" />
                      <div>
                        <p className="text-sm font-medium text-prmx-cyan">Policy Holder</p>
                        <p className="text-xs text-text-tertiary">
                          Receive payout if event occurs
                        </p>
                      </div>
                    </div>
                  )}
                  {myLpHolding && (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-tertiary">LP Shares</span>
                        <span className="text-sm font-medium">{myLpHolding.lpShares}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-tertiary">Ownership</span>
                        <span className="text-sm font-semibold text-prmx-cyan">{myLpHolding.percentageOwned.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-tertiary">Collateral</span>
                        <span className="text-sm font-medium">
                          {formatUSDT(BigInt(myLpHolding.lpShares) * BigInt(100_000_000))}
                        </span>
                      </div>
                      {policy.status === 'Active' && !isExpired && (
                        <div className="pt-3 mt-1">
                          <Link href="/lp">
                            <Button variant="secondary" size="sm" className="w-full">
                              Trade LP Tokens
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Policyholder Info */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Policyholder</h3>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-prmx-cyan/30 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyAddress(policy.holder)}
                    className="flex items-center gap-1.5 group cursor-pointer hover:text-prmx-cyan transition-colors"
                    title="Click to copy address"
                  >
                    <code className="text-sm group-hover:text-prmx-cyan transition-colors">{formatAddress(policy.holder)}</code>
                    {copiedAddress === policy.holder ? (
                      <Check className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-text-tertiary group-hover:text-prmx-cyan transition-colors" />
                    )}
                  </button>
                  {isHolder && <Badge variant="cyan">You</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Quick Actions */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide px-1">Quick Actions</h3>
              <Link href={`/v3/requests/${policy.id}`} className="block">
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer group">
                  <div className="w-7 h-7 rounded-md bg-prmx-purple/20 flex items-center justify-center">
                    <FileText className="w-3.5 h-3.5 text-prmx-purple" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium group-hover:text-prmx-purple transition-colors">Original Request</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-purple transition-colors" />
                </div>
              </Link>
              <Link href="/v3/requests" className="block">
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer group">
                  <div className="w-7 h-7 rounded-md bg-prmx-cyan/20 flex items-center justify-center">
                    <ShoppingCart className="w-3.5 h-3.5 text-prmx-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium group-hover:text-prmx-cyan transition-colors">Marketplace</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-cyan transition-colors" />
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Helper function to calculate threshold proximity percentage
function getThresholdProximity(aggState: V3AggState, threshold: number): number {
  // Sentinel values for uninitialized aggregation state
  const I64_MIN_APPROX = -9223372036854775000;
  const I64_MAX_APPROX = 9223372036854775000;
  
  let currentValue: number;
  
  switch (aggState.type) {
    case 'PrecipSum':
      currentValue = aggState.sumMmX1000;
      break;
    case 'Precip1hMax':
      if (aggState.max1hMmX1000 < I64_MIN_APPROX) return 0;
      currentValue = aggState.max1hMmX1000;
      break;
    case 'TempMax':
      if (aggState.maxCX1000 < I64_MIN_APPROX) return 0;
      currentValue = aggState.maxCX1000;
      break;
    case 'TempMin':
      if (aggState.minCX1000 > I64_MAX_APPROX) return 0;
      // For min temp, we want to track how close we are to going below threshold
      // This is inverted logic
      return threshold > 0 ? Math.max(0, 100 - (aggState.minCX1000 / threshold) * 100) : 0;
    case 'WindGustMax':
      if (aggState.maxMpsX1000 < I64_MIN_APPROX) return 0;
      currentValue = aggState.maxMpsX1000;
      break;
    case 'PrecipTypeOccurred':
      // Binary check - if any bit matches threshold mask, it's 100%
      return (aggState.mask & threshold) ? 100 : 0;
    default:
      return 0;
  }
  
  if (threshold <= 0) return 0;
  return Math.max(0, (currentValue / threshold) * 100);
}

