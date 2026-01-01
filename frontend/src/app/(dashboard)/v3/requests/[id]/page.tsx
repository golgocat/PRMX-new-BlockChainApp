'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  ArrowLeft,
  MapPin,
  Calendar,
  DollarSign,
  Clock,
  Users,
  Shield,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  Zap,
  Target,
  Wallet,
  ArrowRight,
  Copy,
  Check,
  ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useV3Request } from '@/hooks/useV3ChainData';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { acceptV3Request, cancelV3Request, expireV3Request, formatId } from '@/lib/api-v3';
import { 
  V3RequestStatus,
  getEventTypeInfo, 
  formatThresholdValue,
  getRemainingShares,
  isRequestAcceptable,
  calculateCollateral,
  V3ThresholdUnit
} from '@/types/v3';
import { formatUSDT, formatDateTimeUTCCompact, formatTimeRemaining, formatAddress, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

function getStatusConfig(status: V3RequestStatus, expiresAt: number) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = expiresAt <= now;
  
  if (status === 'Pending' && isExpired) {
    return { 
      label: 'Expired', 
      variant: 'error' as const,
      icon: Clock,
      color: 'text-error',
      bgColor: 'bg-error/10',
      borderColor: 'border-error/30'
    };
  }
  
  const configs = {
    'Pending': { 
      label: 'Open for Underwriting', 
      variant: 'warning' as const,
      icon: Target,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      borderColor: 'border-warning/30'
    },
    'PartiallyFilled': { 
      label: 'Partially Filled', 
      variant: 'info' as const,
      icon: TrendingUp,
      color: 'text-info',
      bgColor: 'bg-info/10',
      borderColor: 'border-info/30'
    },
    'FullyFilled': { 
      label: 'Fully Underwritten', 
      variant: 'success' as const,
      icon: CheckCircle2,
      color: 'text-success',
      bgColor: 'bg-success/10',
      borderColor: 'border-success/30'
    },
    'Cancelled': { 
      label: 'Cancelled', 
      variant: 'default' as const,
      icon: XCircle,
      color: 'text-text-tertiary',
      bgColor: 'bg-background-tertiary',
      borderColor: 'border-border-secondary'
    },
    'Expired': { 
      label: 'Expired', 
      variant: 'error' as const,
      icon: Clock,
      color: 'text-error',
      bgColor: 'bg-error/10',
      borderColor: 'border-error/30'
    },
  };
  
  return configs[status] || configs['Pending'];
}

export default function V3RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  // V3 request IDs are H128 hex strings (e.g., "0x3a7f8b2c...")
  const requestId = params.id ? (params.id as string) : null;
  
  const { isConnected, selectedAccount, getKeypair } = useWalletStore();
  const isDao = useIsDao();
  const { request, loading, error, refresh } = useV3Request(requestId);
  
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [sharesToAccept, setSharesToAccept] = useState<number>(1);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isExpiring, setIsExpiring] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  
  const eventInfo = useMemo(() => 
    request ? getEventTypeInfo(request.eventSpec.eventType) : null, 
    [request]
  );
  
  const remainingShares = useMemo(() => 
    request ? getRemainingShares(request) : 0,
    [request]
  );
  
  const canAccept = useMemo(() => 
    request && 
    isConnected && 
    isRequestAcceptable(request) && 
    request.requester !== selectedAccount?.address &&
    remainingShares > 0,
    [request, isConnected, selectedAccount, remainingShares]
  );
  
  const isOwner = useMemo(() =>
    request && selectedAccount && request.requester === selectedAccount.address,
    [request, selectedAccount]
  );
  
  const canCancel = useMemo(() =>
    isOwner && 
    request && 
    (request.status === 'Pending' || request.status === 'PartiallyFilled') &&
    remainingShares > 0,
    [isOwner, request, remainingShares]
  );
  
  const collateralNeeded = useMemo(() =>
    calculateCollateral(sharesToAccept),
    [sharesToAccept]
  );
  
  const premiumToEarn = useMemo(() =>
    request ? BigInt(sharesToAccept) * request.premiumPerShare : BigInt(0),
    [request, sharesToAccept]
  );
  
  // Calculate ROI percentage
  const roiPercentage = useMemo(() => {
    if (!request) return 0;
    const collateral = Number(calculateCollateral(1));
    const premium = Number(request.premiumPerShare);
    return collateral > 0 ? ((premium / collateral) * 100) : 0;
  }, [request]);
  
  const handleCopyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(true);
    toast.success('Address copied!');
    setTimeout(() => setCopiedAddress(false), 2000);
  };
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };
  
  const handleAccept = async () => {
    const keypair = getKeypair();
    if (!keypair || !request) {
      toast.error('Wallet not connected');
      return;
    }
    
    if (sharesToAccept < 1 || sharesToAccept > remainingShares) {
      toast.error(`Please enter between 1 and ${remainingShares} shares`);
      return;
    }
    
    setIsAccepting(true);
    try {
      await acceptV3Request(keypair, request.id, sharesToAccept);
      toast.success(`Successfully accepted ${sharesToAccept} shares!`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept request');
    } finally {
      setIsAccepting(false);
    }
  };
  
  const handleCancel = async () => {
    const keypair = getKeypair();
    if (!keypair || !request) {
      toast.error('Wallet not connected');
      return;
    }
    
    setIsCancelling(true);
    try {
      const refund = await cancelV3Request(keypair, request.id);
      toast.success(`Request cancelled. Refund: ${formatUSDT(refund)}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel request');
    } finally {
      setIsCancelling(false);
    }
  };
  
  const handleExpire = async () => {
    const keypair = getKeypair();
    if (!keypair || !request) {
      toast.error('Wallet not connected');
      return;
    }
    
    setIsExpiring(true);
    try {
      const refund = await expireV3Request(keypair, request.id);
      toast.success(`Request expired. Refund to requester: ${formatUSDT(refund)}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to expire request');
    } finally {
      setIsExpiring(false);
    }
  };
  
  // Check if request can be manually expired (DAO only, after expiry time)
  const canExpire = useMemo(() =>
    isDao && 
    request && 
    (request.status === 'Pending' || request.status === 'PartiallyFilled') &&
    request.expiresAt <= Math.floor(Date.now() / 1000),
    [isDao, request]
  );
  
  if (!isConnected) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
        <div className="flex items-center gap-4">
          <Link href="/v3/requests">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div>
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
            <h1 className="text-3xl font-bold mt-1">Request Details</h1>
          </div>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-border-secondary flex items-center justify-center">
              <Wallet className="w-10 h-10 text-gray-400 dark:text-text-tertiary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-8 max-w-md mx-auto">
              Connect your wallet to view request details and participate in the P2P marketplace
            </p>
            <Button size="lg" onClick={() => setShowWalletModal(true)}>
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
  
  if (loading) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
        <div className="flex items-center gap-4">
          <Link href="/v3/requests">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div className="animate-pulse">
            <div className="h-4 w-16 bg-background-tertiary/50 rounded mb-2" />
            <div className="h-8 w-48 bg-background-tertiary/50 rounded" />
          </div>
        </div>
        
        {/* Skeleton loading */}
        <div className="animate-pulse space-y-6">
          <div className="h-48 bg-background-tertiary/30 rounded-2xl" />
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <div className="h-64 bg-background-tertiary/30 rounded-2xl" />
              <div className="h-48 bg-background-tertiary/30 rounded-2xl" />
            </div>
            <div className="h-96 bg-background-tertiary/30 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }
  
  if (error || !request) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
        <div className="flex items-center gap-4">
          <Link href="/v3/requests">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div>
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
            <h1 className="text-3xl font-bold mt-1">Request Details</h1>
          </div>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-error/10 flex items-center justify-center">
              <XCircle className="w-10 h-10 text-error" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Request Not Found</h3>
            <p className="text-text-secondary mb-8">
              {error || 'The request you are looking for does not exist or has been removed'}
            </p>
            <Link href="/v3/requests">
              <Button>Browse All Requests</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const now = Math.floor(Date.now() / 1000);
  const isExpired = request.expiresAt <= now;
  const statusConfig = getStatusConfig(request.status, request.expiresAt);
  const StatusIcon = statusConfig.icon;
  const fillPercentage = (request.filledShares / request.totalShares) * 100;
  
  return (
    <div className="space-y-6 max-w-6xl mx-auto pt-4">
      {/* Header */}
      {(() => {
        // Format short request ID for avatar
        const shortId = typeof request.id === 'string' && request.id.startsWith('0x') 
          ? request.id.slice(2, 10) 
          : String(request.id).slice(0, 8);
        const displayId = typeof request.id === 'string' && request.id.startsWith('0x')
          ? request.id.slice(2, 14) + '...'
          : String(request.id);
        
        return (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/v3/requests">
                <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                  Back
                </Button>
              </Link>
              
              {/* Subtle gradient avatar */}
              <div 
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-mono text-lg font-bold shadow-sm flex-shrink-0 bg-gradient-to-br from-gray-600 to-gray-700 dark:from-slate-600 dark:to-slate-700 border border-gray-500/30"
              >
                {shortId.slice(0, 4).toUpperCase()}
              </div>
              
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 uppercase">
                    Request
                  </span>
                  {isOwner && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 uppercase">
                      Your Request
                    </span>
                  )}
                  {request.location && (
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {request.location.name}
                    </span>
                  )}
                </div>
                <h1 className="text-2xl font-bold font-mono text-text-primary">
                  {displayId}
                </h1>
                <p className="text-sm text-text-tertiary mt-0.5">
                  {getEventTypeInfo(request.eventSpec.eventType)?.label} ≥ {formatThresholdValue(
                    request.eventSpec.threshold.value,
                    request.eventSpec.threshold.unit
                  )}
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
      
      {/* Hero Card - Event Overview */}
      <Card className={cn('overflow-hidden border-2', statusConfig.borderColor)}>
        <div className={cn('px-6 py-4', statusConfig.bgColor)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusIcon className={cn('w-5 h-5', statusConfig.color)} />
              <span className={cn('font-semibold', statusConfig.color)}>{statusConfig.label}</span>
            </div>
            {!isExpired && (request.status === 'Pending' || request.status === 'PartiallyFilled') && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Clock className="w-4 h-4" />
                <span>Expires in {formatTimeRemaining(request.expiresAt)}</span>
              </div>
            )}
          </div>
        </div>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Event Icon & Type */}
            <div className="flex-shrink-0">
              <div className="w-24 h-24 rounded-2xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-border-secondary flex items-center justify-center text-5xl">
                {eventInfo?.icon || '📋'}
              </div>
            </div>
            
            {/* Event Details */}
            <div className="flex-1 space-y-4">
              <div>
                <h2 className="text-2xl font-bold mb-1">
                  {eventInfo?.label || request.eventSpec.eventType}
                </h2>
                <p className="text-text-secondary">
                  {eventInfo?.description || 'Climate risk insurance coverage'}
                </p>
              </div>
              
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-transparent">
                  <MapPin className="w-4 h-4 text-gray-500 dark:text-text-secondary" />
                  <span className="font-medium">{request.location?.name || `Location #${request.locationId}`}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-transparent">
                  <Target className="w-4 h-4 text-gray-500 dark:text-text-secondary" />
                  <span className="font-medium">
                    Trigger: {formatThresholdValue(request.eventSpec.threshold.value, request.eventSpec.threshold.unit)}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Key Financial Summary */}
            <div className="flex-shrink-0 md:text-right">
              <div className="inline-block px-4 py-3 rounded-xl bg-background-tertiary">
                <p className="text-sm text-text-secondary mb-1">Max Payout</p>
                <p className="text-2xl font-bold text-prmx-cyan">
                  {formatUSDT(BigInt(request.totalShares) * request.payoutPerShare, false)}
                </p>
              </div>
            </div>
          </div>
          
          {/* Fill Progress */}
          <div className="mt-6 pt-6 border-t border-border-secondary">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-text-secondary" />
                <span className="text-sm text-text-secondary">Underwriting Progress</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{request.filledShares}</span>
                <span className="text-text-secondary">/</span>
                <span className="text-lg font-medium text-text-secondary">{request.totalShares} shares</span>
              </div>
            </div>
            <div className="relative h-3 bg-gray-200 dark:bg-background-tertiary rounded-full overflow-hidden">
              <div 
                className="absolute inset-y-0 left-0 bg-prmx-cyan transition-all duration-500 ease-out"
                style={{ width: `${fillPercentage}%` }}
              />
            </div>
            {remainingShares > 0 && !isExpired && (
              <p className="text-sm text-text-secondary mt-2">
                <Zap className="w-4 h-4 inline mr-1 text-warning" />
                {remainingShares} share{remainingShares > 1 ? 's' : ''} available for underwriting
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      
      <div className="grid md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Coverage Timeline - Sleek horizontal design */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-prmx-cyan" />
                  </div>
                  <h3 className="text-base font-semibold">Timeline</h3>
                </div>
              </div>
              
              {/* Timeline - Horizontal on desktop, vertical on mobile */}
              <div className="p-5">
                {/* Desktop horizontal timeline */}
                <div className="hidden md:block">
                  <div className="relative">
                    {/* Progress bar background */}
                    <div className="absolute top-4 left-0 right-0 h-0.5 bg-border-secondary" />
                    
                    {/* Progress bar fill - based on current time */}
                    {(() => {
                      const totalDuration = request.coverageEnd - request.createdAt;
                      const elapsed = Math.max(0, Math.min(now - request.createdAt, totalDuration));
                      const progress = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;
                      return (
                        <div 
                          className="absolute top-4 left-0 h-0.5 bg-gradient-to-r from-emerald-500 via-prmx-cyan to-prmx-purple transition-all duration-500"
                          style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                      );
                    })()}
                    
                    {/* Timeline points */}
                    <div className="relative flex justify-between">
                      {/* Created */}
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                          <CheckCircle2 className="w-4 h-4 text-white" />
                        </div>
                        <div className="mt-3 text-center">
                          <p className="text-xs font-medium text-emerald-500">Created</p>
                          <p className="text-[11px] text-text-tertiary mt-0.5">
                            {new Date(request.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          <p className="text-[10px] text-text-tertiary">
                            {new Date(request.createdAt * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })}
                          </p>
                        </div>
                      </div>
                      
                      {/* Expires */}
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center shadow-sm',
                          isExpired ? 'bg-rose-500' : now < request.expiresAt ? 'bg-amber-500' : 'bg-rose-500'
                        )}>
                          <Clock className="w-4 h-4 text-white" />
                        </div>
                        <div className="mt-3 text-center">
                          <p className={cn('text-xs font-medium', isExpired ? 'text-rose-500' : 'text-amber-500')}>
                            {isExpired ? 'Expired' : 'Expires'}
                          </p>
                          <p className="text-[11px] text-text-tertiary mt-0.5">
                            {new Date(request.expiresAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          <p className="text-[10px] text-text-tertiary">
                            {new Date(request.expiresAt * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })}
                          </p>
                        </div>
                      </div>
                      
                      {/* Coverage Start */}
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center shadow-sm transition-all',
                          now >= request.coverageStart 
                            ? 'bg-prmx-cyan' 
                            : 'bg-background-secondary border-2 border-border-secondary'
                        )}>
                          <Shield className={cn('w-4 h-4', now >= request.coverageStart ? 'text-white' : 'text-text-tertiary')} />
                        </div>
                        <div className="mt-3 text-center">
                          <p className={cn('text-xs font-medium', now >= request.coverageStart ? 'text-prmx-cyan' : 'text-text-tertiary')}>
                            Start
                          </p>
                          <p className="text-[11px] text-text-tertiary mt-0.5">
                            {new Date(request.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          <p className="text-[10px] text-text-tertiary">
                            {new Date(request.coverageStart * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })}
                          </p>
                        </div>
                      </div>
                      
                      {/* Coverage End */}
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center shadow-sm transition-all',
                          now >= request.coverageEnd 
                            ? 'bg-prmx-purple' 
                            : 'bg-background-secondary border-2 border-border-secondary'
                        )}>
                          <Calendar className={cn('w-4 h-4', now >= request.coverageEnd ? 'text-white' : 'text-text-tertiary')} />
                        </div>
                        <div className="mt-3 text-center">
                          <p className={cn('text-xs font-medium', now >= request.coverageEnd ? 'text-prmx-purple' : 'text-text-tertiary')}>
                            End
                          </p>
                          <p className="text-[11px] text-text-tertiary mt-0.5">
                            {new Date(request.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          <p className="text-[10px] text-text-tertiary">
                            {new Date(request.coverageEnd * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Mobile vertical timeline */}
                <div className="md:hidden space-y-4">
                  {[
                    { label: 'Created', time: request.createdAt, icon: CheckCircle2, color: 'emerald', done: true },
                    { label: isExpired ? 'Expired' : 'Expires', time: request.expiresAt, icon: Clock, color: isExpired ? 'rose' : 'amber', done: isExpired },
                    { label: 'Coverage Start', time: request.coverageStart, icon: Shield, color: 'cyan', done: now >= request.coverageStart },
                    { label: 'Coverage End', time: request.coverageEnd, icon: Calendar, color: 'purple', done: now >= request.coverageEnd },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                        item.done 
                          ? `bg-${item.color}-500` 
                          : 'bg-background-secondary border-2 border-border-secondary'
                      )}
                      style={item.done ? { backgroundColor: item.color === 'emerald' ? '#10b981' : item.color === 'rose' ? '#f43f5e' : item.color === 'amber' ? '#f59e0b' : item.color === 'cyan' ? '#22d3ee' : '#a855f7' } : {}}
                      >
                        <item.icon className={cn('w-3.5 h-3.5', item.done ? 'text-white' : 'text-text-tertiary')} />
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-sm font-medium">{item.label}</span>
                        <span className="text-xs text-text-tertiary">
                          {new Date(item.time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} {new Date(item.time * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Financial Terms */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-success" />
                <h3 className="text-lg font-semibold">Financial Terms</h3>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Per Share Terms */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
                    Per Share
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary/50">
                      <span className="text-text-secondary">Premium / share</span>
                      <span className="font-bold text-success text-lg">{formatUSDT(request.premiumPerShare, false)}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary/50">
                      <span className="text-text-secondary">Payout / share</span>
                      <span className="font-bold text-lg">{formatUSDT(request.payoutPerShare, false)}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary/50">
                      <span className="text-text-secondary">Collateral / share</span>
                      <span className="font-bold text-lg">{formatUSDT(calculateCollateral(1), false)}</span>
                    </div>
                  </div>
                </div>
                
                {/* Total Values */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
                    Totals
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary/50">
                      <span className="text-text-secondary">Total Shares</span>
                      <span className="font-bold text-lg">{request.totalShares}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary/50">
                      <span className="text-text-secondary">Total Premium</span>
                      <span className="font-bold text-success text-lg">
                        {formatUSDT(BigInt(request.totalShares) * request.premiumPerShare, false)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-border-secondary">
                      <span className="text-text-secondary">Max Payout</span>
                      <span className="font-bold text-text-primary text-xl">
                        {formatUSDT(BigInt(request.totalShares) * request.payoutPerShare, false)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* ROI Indicator */}
              <div className="mt-6 p-4 rounded-xl bg-gray-50 dark:bg-background-tertiary/50 border border-gray-200 dark:border-border-secondary">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="font-medium">Underwriter Return on Collateral</p>
                      <p className="text-sm text-text-secondary">If no event occurs during coverage period</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">+{roiPercentage.toFixed(1)}%</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Requester Info */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-prmx-purple" />
                <h3 className="text-lg font-semibold">Requester</h3>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-border-secondary flex items-center justify-center">
                    <Users className="w-6 h-6 text-gray-500 dark:text-text-secondary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono">{formatAddress(request.requester)}</code>
                      {isOwner && <Badge variant="cyan">You</Badge>}
                    </div>
                    <p className="text-sm text-text-secondary mt-1">Policy Holder</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copiedAddress ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  onClick={() => handleCopyAddress(request.requester)}
                >
                  {copiedAddress ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Action Sidebar */}
        <div className="space-y-6">
          {/* Accept Card (for non-owners) */}
          {!isOwner && (
            <Card className="sticky top-6 z-10 bg-background-primary">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-prmx-cyan" />
                  <h3 className="text-lg font-semibold">Become an Underwriter</h3>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {canAccept ? (
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Shares to Accept
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={sharesToAccept}
                          onChange={(e) => setSharesToAccept(Math.max(1, Math.min(remainingShares, parseInt(e.target.value) || 1)))}
                          min={1}
                          max={remainingShares}
                          className="text-center text-lg font-bold"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSharesToAccept(remainingShares)}
                        >
                          Max
                        </Button>
                      </div>
                      <p className="text-xs text-text-tertiary mt-2 text-center">
                        {remainingShares} available
                      </p>
                    </div>
                    
                    {/* Cost Breakdown */}
                    <div className="p-4 rounded-xl bg-background-tertiary/50 space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Collateral Required</span>
                        <span className="font-medium">{formatUSDT(collateralNeeded, false)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Premium Earned</span>
                        <span className="font-medium text-success">−{formatUSDT(premiumToEarn, false)}</span>
                      </div>
                      <hr className="border-border-secondary" />
                      <div className="flex justify-between">
                        <span className="font-medium">Net Investment</span>
                        <span className="font-bold text-lg">{formatUSDT(collateralNeeded - premiumToEarn, false)}</span>
                      </div>
                    </div>
                    
                    {/* What You Get */}
                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-background-tertiary/50 border border-gray-200 dark:border-border-secondary space-y-2">
                      <p className="font-medium text-sm flex items-center gap-2">
                        <Zap className="w-4 h-4 text-text-secondary" />
                        What you get:
                      </p>
                      <ul className="text-xs text-text-secondary space-y-1 ml-6">
                        <li>• {sharesToAccept} LP token{sharesToAccept > 1 ? 's' : ''}</li>
                        <li>• Premium: {formatUSDT(premiumToEarn, false)} (upfront)</li>
                        <li>• If no event: keep collateral + premium</li>
                        <li>• If event: payout to policyholder</li>
                      </ul>
                    </div>
                    
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={handleAccept}
                      loading={isAccepting}
                      icon={<CheckCircle2 className="w-5 h-5" />}
                    >
                      Accept {sharesToAccept} Share{sharesToAccept > 1 ? 's' : ''}
                    </Button>
                    
                    {/* Policy link if shares already filled */}
                    {request.filledShares > 0 && (
                      <div className="pt-4 border-t border-border-secondary mt-4">
                        <p className="text-xs text-text-secondary mb-2">
                          A policy exists with {request.filledShares} shares underwritten.
                        </p>
                        <Link href={`/v3/policies/${request.id}`}>
                          <Button variant="ghost" size="sm" className="w-full" icon={<ExternalLink className="w-4 h-4" />}>
                            View Policy Details
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    {request.status === 'FullyFilled' ? (
                      <>
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-success/10 flex items-center justify-center">
                          <CheckCircle2 className="w-8 h-8 text-success" />
                        </div>
                        <p className="font-semibold text-lg mb-2">Fully Underwritten</p>
                        <p className="text-sm text-text-secondary mb-4">All shares have been accepted by underwriters</p>
                        <Link href={`/v3/policies/${request.id}`}>
                          <Button variant="secondary" className="w-full" icon={<ExternalLink className="w-4 h-4" />}>
                            View Policy Details
                          </Button>
                        </Link>
                      </>
                    ) : isExpired ? (
                      <>
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-error/10 flex items-center justify-center">
                          <Clock className="w-8 h-8 text-error" />
                        </div>
                        <p className="font-semibold text-lg mb-2">Request Expired</p>
                        <p className="text-sm text-text-secondary">This request is no longer accepting underwriters</p>
                      </>
                    ) : request.status === 'Cancelled' ? (
                      <>
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-background-tertiary flex items-center justify-center">
                          <XCircle className="w-8 h-8 text-text-tertiary" />
                        </div>
                        <p className="font-semibold text-lg mb-2">Request Cancelled</p>
                        <p className="text-sm text-text-secondary">The requester cancelled this request</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-warning/10 flex items-center justify-center">
                          <AlertCircle className="w-8 h-8 text-warning" />
                        </div>
                        <p className="font-semibold text-lg mb-2">Cannot Accept</p>
                        <p className="text-sm text-text-secondary">You cannot accept this request</p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* Owner Actions */}
          {isOwner && (
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">Manage Your Request</h3>
              </CardHeader>
              <CardContent className="p-6">
                {canCancel ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-warning/10 border border-warning/30">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-sm">Cancel unfilled shares</p>
                          <p className="text-xs text-text-secondary mt-1">
                            Cancelling will refund the premium for {remainingShares} remaining shares ({formatUSDT(BigInt(remainingShares) * request.premiumPerShare, false)})
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={handleCancel}
                      loading={isCancelling}
                      icon={<XCircle className="w-4 h-4" />}
                    >
                      Cancel Remaining Shares
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    {request.status === 'FullyFilled' ? (
                      <>
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-success/10 flex items-center justify-center">
                          <CheckCircle2 className="w-8 h-8 text-success" />
                        </div>
                        <p className="font-semibold text-lg mb-2">Request Fulfilled!</p>
                        <p className="text-sm text-text-secondary mb-4">
                          All shares have been accepted. Your policy is now active.
                        </p>
                        <Link href={`/v3/policies/${request.id}`}>
                          <Button className="w-full" icon={<ArrowRight className="w-4 h-4" />}>
                            View Policy
                          </Button>
                        </Link>
                      </>
                    ) : request.status === 'Cancelled' ? (
                      <>
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-background-tertiary flex items-center justify-center">
                          <XCircle className="w-8 h-8 text-text-tertiary" />
                        </div>
                        <p className="font-semibold text-lg mb-2">Request Cancelled</p>
                        <p className="text-sm text-text-secondary">Premium has been refunded</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-background-tertiary flex items-center justify-center">
                          <Clock className="w-8 h-8 text-text-tertiary" />
                        </div>
                        <p className="font-semibold text-lg mb-2">Request Expired</p>
                        <p className="text-sm text-text-secondary">
                          {request.filledShares > 0 
                            ? 'Partially filled - a policy was created with filled shares'
                            : 'Premium has been refunded'}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* DAO Expire Action */}
          {canExpire && (
            <Card className="border-warning/30 bg-warning/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-warning" />
                  <h3 className="font-semibold">DAO Action</h3>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">
                    This request has passed its expiry time. Trigger expiry to refund the unfilled premium to the requester.
                  </p>
                  
                  <div className="p-3 rounded-lg bg-background-tertiary/50 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Unfilled Shares</span>
                      <span className="font-medium">{remainingShares}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Refund Amount</span>
                      <span className="font-medium">
                        {formatUSDT(BigInt(remainingShares) * request.premiumPerShare, false)}
                      </span>
                    </div>
                  </div>
                  
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleExpire}
                    loading={isExpiring}
                    icon={<Clock className="w-4 h-4" />}
                  >
                    Trigger Expiry
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
