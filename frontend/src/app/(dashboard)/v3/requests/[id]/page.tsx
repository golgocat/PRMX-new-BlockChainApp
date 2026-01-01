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
          <CardContent className="py-12 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-text-tertiary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Connect Your Wallet</h3>
            <p className="text-sm text-text-tertiary mb-6 max-w-sm mx-auto">
              Connect to view request details and participate in P2P marketplace
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
          <div className="h-40 bg-background-tertiary/50 rounded-lg" />
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <div className="h-52 bg-background-tertiary/50 rounded-lg" />
              <div className="h-40 bg-background-tertiary/50 rounded-lg" />
            </div>
            <div className="h-80 bg-background-tertiary/50 rounded-lg" />
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
          <CardContent className="py-12 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-rose-500/10 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Request Not Found</h3>
            <p className="text-sm text-text-tertiary mb-6">
              {error || 'The request does not exist or has been removed'}
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
              
              {/* Subtle avatar */}
              <div 
                className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-mono text-sm font-bold flex-shrink-0 bg-gradient-to-br from-slate-600 to-slate-700"
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
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Status Header */}
          <div className="px-5 py-4 border-b border-border-primary/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', statusConfig.bgColor)}>
                  <StatusIcon className={cn('w-4 h-4', statusConfig.color)} />
                </div>
                <span className={cn('font-semibold', statusConfig.color)}>{statusConfig.label}</span>
              </div>
              {!isExpired && (request.status === 'Pending' || request.status === 'PartiallyFilled') && (
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Expires in {formatTimeRemaining(request.expiresAt)}</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Content */}
          <div className="p-5">
            <div className="flex flex-col md:flex-row gap-5">
              {/* Event Icon & Type */}
              <div className="flex-shrink-0">
                <div className="w-16 h-16 rounded-lg bg-background-tertiary/50 flex items-center justify-center text-3xl">
                  {eventInfo?.icon || '📋'}
                </div>
              </div>
              
              {/* Event Details */}
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold mb-1">
                  {eventInfo?.label || request.eventSpec.eventType}
                </h2>
                <p className="text-sm text-text-secondary mb-3">
                  {eventInfo?.description || 'Climate risk insurance coverage'}
                </p>
                
                <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {request.location?.name || `Location #${request.locationId}`}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    Trigger: {formatThresholdValue(request.eventSpec.threshold.value, request.eventSpec.threshold.unit)}
                  </span>
                </div>
              </div>
              
              {/* Key Financial Summary */}
              <div className="flex-shrink-0">
                <div className="px-4 py-3 rounded-lg bg-background-tertiary/30">
                  <p className="text-xs text-text-tertiary mb-1">Max Payout</p>
                  <p className="text-xl font-bold text-prmx-cyan">
                    {formatUSDT(BigInt(request.totalShares) * request.payoutPerShare, false)}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Fill Progress */}
            <div className="mt-5 pt-4 border-t border-border-primary/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-text-tertiary" />
                  <span className="text-xs text-text-tertiary">Underwriting Progress</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-bold">{request.filledShares}</span>
                  <span className="text-text-tertiary">/</span>
                  <span className="text-text-secondary">{request.totalShares} shares</span>
                </div>
              </div>
              <div className="relative h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                <div 
                  className="absolute inset-y-0 left-0 bg-prmx-cyan transition-all duration-500 ease-out"
                  style={{ width: `${fillPercentage}%` }}
                />
              </div>
              {remainingShares > 0 && !isExpired && (
                <p className="text-xs text-text-tertiary mt-2">
                  <Zap className="w-3 h-3 inline mr-1 text-amber-500" />
                  {remainingShares} share{remainingShares > 1 ? 's' : ''} available
                </p>
              )}
            </div>
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
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                  </div>
                  <h3 className="text-base font-semibold">Financial Terms</h3>
                </div>
              </div>
              
              {/* Content */}
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Per Share Terms */}
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Per Share</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                        <span className="text-sm text-text-secondary">Premium</span>
                        <span className="text-sm font-semibold text-emerald-500">{formatUSDT(request.premiumPerShare, false)}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                        <span className="text-sm text-text-secondary">Payout</span>
                        <span className="text-sm font-semibold">{formatUSDT(request.payoutPerShare, false)}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                        <span className="text-sm text-text-secondary">Collateral</span>
                        <span className="text-sm font-semibold">{formatUSDT(calculateCollateral(1), false)}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Total Values */}
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Totals</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                        <span className="text-sm text-text-secondary">Total Shares</span>
                        <span className="text-sm font-semibold">{request.totalShares}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                        <span className="text-sm text-text-secondary">Total Premium</span>
                        <span className="text-sm font-semibold text-emerald-500">
                          {formatUSDT(BigInt(request.totalShares) * request.premiumPerShare, false)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gradient-to-r from-emerald-500/5 to-transparent">
                        <span className="text-sm text-text-secondary">Max Payout</span>
                        <span className="text-base font-bold">
                          {formatUSDT(BigInt(request.totalShares) * request.payoutPerShare, false)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* ROI Indicator */}
                <div className="mt-4 pt-4 border-t border-border-primary/30">
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Underwriter ROI</p>
                        <p className="text-xs text-text-tertiary">If no event occurs</p>
                      </div>
                    </div>
                    <span className="text-xl font-bold text-emerald-500">+{roiPercentage.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Requester Info */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-prmx-purple/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-prmx-purple" />
                  </div>
                  <h3 className="text-base font-semibold">Requester</h3>
                </div>
              </div>
              
              {/* Content */}
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                      <Users className="w-5 h-5 text-text-tertiary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono font-medium">{formatAddress(request.requester)}</code>
                        {isOwner && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-prmx-cyan/10 text-prmx-cyan uppercase">You</span>
                        )}
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">Policy Holder</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCopyAddress(request.requester)}
                    className="p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors"
                    title="Copy address"
                  >
                    {copiedAddress ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-text-tertiary hover:text-prmx-cyan" />
                    )}
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Action Sidebar */}
        <div className="space-y-6">
          {/* Accept Card (for non-owners) */}
          {!isOwner && (
            <Card className="sticky top-6 z-10 bg-background-primary overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-prmx-cyan" />
                    </div>
                    <h3 className="text-base font-semibold">Become an Underwriter</h3>
                  </div>
                </div>
                
                {/* Content */}
                <div className="p-5">
                  {canAccept ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs text-text-tertiary uppercase tracking-wide mb-2">
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
                        <p className="text-xs text-text-tertiary mt-1.5 text-center">
                          {remainingShares} available
                        </p>
                      </div>
                      
                      {/* Cost Breakdown */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                          <span className="text-sm text-text-secondary">Collateral</span>
                          <span className="text-sm font-medium">{formatUSDT(collateralNeeded, false)}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                          <span className="text-sm text-text-secondary">Premium</span>
                          <span className="text-sm font-medium text-emerald-500">−{formatUSDT(premiumToEarn, false)}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gradient-to-r from-prmx-cyan/5 to-transparent">
                          <span className="text-sm font-medium">Net Investment</span>
                          <span className="text-base font-bold">{formatUSDT(collateralNeeded - premiumToEarn, false)}</span>
                        </div>
                      </div>
                      
                      {/* What You Get */}
                      <div className="pt-3 border-t border-border-primary/30">
                        <p className="text-xs text-text-tertiary mb-2">What you get:</p>
                        <ul className="text-xs text-text-secondary space-y-1">
                          <li className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-prmx-cyan" />
                            {sharesToAccept} LP token{sharesToAccept > 1 ? 's' : ''}
                          </li>
                          <li className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-emerald-500" />
                            Premium: {formatUSDT(premiumToEarn, false)} upfront
                          </li>
                          <li className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-text-tertiary" />
                            No event: keep collateral + premium
                          </li>
                        </ul>
                      </div>
                      
                      <Button
                        className="w-full"
                        size="lg"
                        onClick={handleAccept}
                        loading={isAccepting}
                        icon={<CheckCircle2 className="w-4 h-4" />}
                      >
                        Accept {sharesToAccept} Share{sharesToAccept > 1 ? 's' : ''}
                      </Button>
                      
                      {/* Policy link if shares already filled */}
                      {request.filledShares > 0 && (
                        <div className="pt-3 border-t border-border-primary/30">
                          <p className="text-xs text-text-tertiary mb-2">
                            Policy exists with {request.filledShares} shares underwritten.
                          </p>
                          <Link href={`/v3/policies/${request.id}`}>
                            <Button variant="ghost" size="sm" className="w-full" icon={<ExternalLink className="w-3.5 h-3.5" />}>
                              View Policy
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      {request.status === 'FullyFilled' ? (
                        <>
                          <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                          </div>
                          <p className="font-semibold mb-1">Fully Underwritten</p>
                          <p className="text-xs text-text-tertiary mb-4">All shares accepted</p>
                          <Link href={`/v3/policies/${request.id}`}>
                            <Button variant="secondary" size="sm" className="w-full" icon={<ExternalLink className="w-3.5 h-3.5" />}>
                              View Policy
                            </Button>
                          </Link>
                        </>
                      ) : isExpired ? (
                        <>
                          <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-rose-500/10 flex items-center justify-center">
                            <Clock className="w-5 h-5 text-rose-500" />
                          </div>
                          <p className="font-semibold mb-1">Request Expired</p>
                          <p className="text-xs text-text-tertiary">No longer accepting underwriters</p>
                        </>
                      ) : request.status === 'Cancelled' ? (
                        <>
                          <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                            <XCircle className="w-5 h-5 text-text-tertiary" />
                          </div>
                          <p className="font-semibold mb-1">Request Cancelled</p>
                          <p className="text-xs text-text-tertiary">Cancelled by requester</p>
                        </>
                      ) : (
                        <>
                          <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-amber-500/10 flex items-center justify-center">
                            <AlertCircle className="w-5 h-5 text-amber-500" />
                          </div>
                          <p className="font-semibold mb-1">Cannot Accept</p>
                          <p className="text-xs text-text-tertiary">You cannot accept this request</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Owner Actions */}
          {isOwner && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-prmx-purple/10 flex items-center justify-center">
                      <Users className="w-4 h-4 text-prmx-purple" />
                    </div>
                    <h3 className="text-base font-semibold">Manage Request</h3>
                  </div>
                </div>
                
                {/* Content */}
                <div className="p-5">
                  {canCancel ? (
                    <div className="space-y-4">
                      <div className="py-2 px-3 rounded-lg bg-amber-500/5">
                        <div className="flex items-start gap-2.5">
                          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium">Cancel unfilled shares</p>
                            <p className="text-xs text-text-tertiary mt-0.5">
                              Refund: {formatUSDT(BigInt(remainingShares) * request.premiumPerShare, false)} ({remainingShares} shares)
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
                        Cancel Remaining
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      {request.status === 'FullyFilled' ? (
                        <>
                          <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                          </div>
                          <p className="font-semibold mb-1">Request Fulfilled!</p>
                          <p className="text-xs text-text-tertiary mb-4">Policy is now active</p>
                          <Link href={`/v3/policies/${request.id}`}>
                            <Button size="sm" className="w-full" icon={<ArrowRight className="w-3.5 h-3.5" />}>
                              View Policy
                            </Button>
                          </Link>
                        </>
                      ) : request.status === 'Cancelled' ? (
                        <>
                          <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                            <XCircle className="w-5 h-5 text-text-tertiary" />
                          </div>
                          <p className="font-semibold mb-1">Request Cancelled</p>
                          <p className="text-xs text-text-tertiary">Premium refunded</p>
                        </>
                      ) : (
                        <>
                          <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
                            <Clock className="w-5 h-5 text-text-tertiary" />
                          </div>
                          <p className="font-semibold mb-1">Request Expired</p>
                          <p className="text-xs text-text-tertiary">
                            {request.filledShares > 0 
                              ? 'Policy created with filled shares'
                              : 'Premium refunded'}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* DAO Expire Action */}
          {canExpire && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold">DAO Action</h3>
                      <p className="text-xs text-text-tertiary">Request expired</p>
                    </div>
                  </div>
                </div>
                
                {/* Content */}
                <div className="p-5 space-y-4">
                  <p className="text-xs text-text-tertiary">
                    Trigger expiry to refund unfilled premium to requester.
                  </p>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                      <span className="text-sm text-text-secondary">Unfilled Shares</span>
                      <span className="text-sm font-medium">{remainingShares}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
                      <span className="text-sm text-text-secondary">Refund Amount</span>
                      <span className="text-sm font-medium">
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
