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
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useWalletStore } from '@/stores/walletStore';
import { useV3Request } from '@/hooks/useV3ChainData';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { acceptV3Request, cancelV3Request } from '@/lib/api-v3';
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

function getStatusBadge(status: V3RequestStatus, expiresAt: number) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = expiresAt <= now;
  
  if (status === 'Pending' && isExpired) {
    return <Badge variant="error" className="text-sm px-3 py-1">Expired</Badge>;
  }
  
  switch (status) {
    case 'Pending':
      return <Badge variant="warning" className="text-sm px-3 py-1">Pending Acceptance</Badge>;
    case 'PartiallyFilled':
      return <Badge variant="info" className="text-sm px-3 py-1">Partially Filled</Badge>;
    case 'FullyFilled':
      return <Badge variant="success" className="text-sm px-3 py-1">Fully Filled</Badge>;
    case 'Cancelled':
      return <Badge variant="default" className="text-sm px-3 py-1">Cancelled</Badge>;
    case 'Expired':
      return <Badge variant="error" className="text-sm px-3 py-1">Expired</Badge>;
    default:
      return <Badge variant="default" className="text-sm px-3 py-1">{status}</Badge>;
  }
}

export default function V3RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id ? parseInt(params.id as string) : null;
  
  const { isConnected, selectedAccount, getKeypair } = useWalletStore();
  const { request, loading, error, refresh } = useV3Request(requestId);
  
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [sharesToAccept, setSharesToAccept] = useState<number>(1);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
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
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
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
  
  if (!isConnected) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto">
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
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to view and interact with this request
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
      <div className="space-y-8 max-w-6xl mx-auto">
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
  
  if (error || !request) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto">
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
            <XCircle className="w-16 h-16 mx-auto mb-4 text-error" />
            <h3 className="text-lg font-semibold mb-2">Request Not Found</h3>
            <p className="text-text-secondary mb-6">
              {error || 'The request you are looking for does not exist'}
            </p>
            <Link href="/v3/requests">
              <Button>Back to Marketplace</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const now = Math.floor(Date.now() / 1000);
  const isExpired = request.expiresAt <= now;
  
  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/v3/requests">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="purple" className="text-xs">V3 P2P</Badge>
              {isOwner && <Badge variant="cyan">Your Request</Badge>}
            </div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <span className="text-4xl">{eventInfo?.icon}</span>
              Request #{request.id}
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
                {getStatusBadge(request.status, request.expiresAt)}
                {!isExpired && request.status !== 'FullyFilled' && request.status !== 'Cancelled' && (
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Clock className="w-4 h-4" />
                    <span>Expires in {formatTimeRemaining(request.expiresAt)}</span>
                  </div>
                )}
              </div>
              
              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-text-secondary">Fill Progress</span>
                  <span className="font-medium">
                    {request.filledShares} / {request.totalShares} shares
                  </span>
                </div>
                <div className="h-3 bg-background-tertiary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-prmx-gradient transition-all"
                    style={{ width: `${(request.filledShares / request.totalShares) * 100}%` }}
                  />
                </div>
              </div>
              
              {remainingShares > 0 && !isExpired && (
                <p className="text-sm text-text-secondary">
                  <Users className="w-4 h-4 inline mr-1" />
                  {remainingShares} shares still available for underwriters
                </p>
              )}
            </CardContent>
          </Card>
          
          {/* Event Details */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Coverage Details</h3>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-text-secondary mb-1">Event Type</p>
                    <p className="font-medium text-lg">
                      {eventInfo?.label || request.eventSpec.eventType}
                    </p>
                    {eventInfo?.description && (
                      <p className="text-sm text-text-tertiary">{eventInfo.description}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-text-secondary mb-1">Trigger Threshold</p>
                    <p className="font-medium text-lg">
                      {formatThresholdValue(request.eventSpec.threshold.value, request.eventSpec.threshold.unit)}
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-text-secondary mb-1">
                      <MapPin className="w-4 h-4 inline mr-1" />
                      Location
                    </p>
                    <p className="font-medium text-lg">{request.location?.name || `Location #${request.locationId}`}</p>
                  </div>
                  <div>
                    <p className="text-sm text-text-secondary mb-1">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      Coverage Period
                    </p>
                    <p className="font-medium">
                      {formatDateTimeUTCCompact(request.coverageStart)}
                    </p>
                    <p className="text-text-secondary">to</p>
                    <p className="font-medium">
                      {formatDateTimeUTCCompact(request.coverageEnd)}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Financial Terms */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Financial Terms</h3>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Per Share Rates */}
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-3">Per Share</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-border-secondary">
                      <span className="text-text-secondary">Premium</span>
                      <span className="font-semibold text-success">{formatUSDT(request.premiumPerShare)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-secondary">
                      <span className="text-text-secondary">Payout</span>
                      <span className="font-semibold">{formatUSDT(request.payoutPerShare)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-text-secondary">Collateral</span>
                      <span className="font-semibold">{formatUSDT(calculateCollateral(1))}</span>
                    </div>
                  </div>
                </div>
                
                {/* Totals */}
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-3">Totals</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-border-secondary">
                      <span className="text-text-secondary">Shares</span>
                      <span className="font-semibold">{request.totalShares}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-secondary">
                      <span className="text-text-secondary">Total Premium</span>
                      <span className="font-semibold text-success">
                        {formatUSDT(BigInt(request.totalShares) * request.premiumPerShare)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-text-secondary">Max Payout</span>
                      <span className="font-semibold text-prmx-cyan text-lg">
                        {formatUSDT(BigInt(request.totalShares) * request.payoutPerShare)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Requester Info */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Requester</h3>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-prmx-gradient flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <code className="text-sm">{formatAddress(request.requester)}</code>
                  {isOwner && <Badge variant="cyan" className="ml-2">You</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Action Sidebar */}
        <div className="space-y-6">
          {/* Accept Card (for non-owners) */}
          {!isOwner && (
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">Accept Request</h3>
              </CardHeader>
              <CardContent className="p-6">
                {canAccept ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Shares to Accept
                      </label>
                      <Input
                        type="number"
                        value={sharesToAccept}
                        onChange={(e) => setSharesToAccept(Math.max(1, Math.min(remainingShares, parseInt(e.target.value) || 1)))}
                        min={1}
                        max={remainingShares}
                      />
                      <p className="text-xs text-text-tertiary mt-1">
                        Max: {remainingShares} shares
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-background-tertiary/50 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Collateral Required</span>
                        <span className="font-medium">{formatUSDT(collateralNeeded)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Premium Earned</span>
                        <span className="font-medium text-success">+{formatUSDT(premiumToEarn)}</span>
                      </div>
                      <hr className="border-border-primary" />
                      <div className="flex justify-between">
                        <span className="font-medium">Net Cost</span>
                        <span className="font-bold">{formatUSDT(collateralNeeded - premiumToEarn)}</span>
                      </div>
                    </div>
                    
                    <div className="p-3 rounded-lg bg-prmx-cyan/10 border border-prmx-cyan/30">
                      <p className="text-xs text-text-secondary">
                        <Shield className="w-4 h-4 inline mr-1 text-prmx-cyan" />
                        You will receive {sharesToAccept} LP token(s) representing your stake.
                        If no event occurs, you keep the collateral + premium.
                      </p>
                    </div>
                    
                    <Button
                      className="w-full"
                      onClick={handleAccept}
                      loading={isAccepting}
                      icon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      Accept {sharesToAccept} Share{sharesToAccept > 1 ? 's' : ''}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    {request.status === 'FullyFilled' ? (
                      <>
                        <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-success" />
                        <p className="font-medium">Fully Filled</p>
                        <p className="text-sm text-text-secondary">All shares have been accepted</p>
                      </>
                    ) : isExpired ? (
                      <>
                        <Clock className="w-12 h-12 mx-auto mb-3 text-error" />
                        <p className="font-medium">Request Expired</p>
                        <p className="text-sm text-text-secondary">This request is no longer accepting</p>
                      </>
                    ) : request.status === 'Cancelled' ? (
                      <>
                        <XCircle className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
                        <p className="font-medium">Request Cancelled</p>
                        <p className="text-sm text-text-secondary">The requester cancelled this request</p>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-warning" />
                        <p className="font-medium">Cannot Accept</p>
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
                <h3 className="text-lg font-semibold">Manage Request</h3>
              </CardHeader>
              <CardContent className="p-6">
                {canCancel ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
                      <p className="text-sm">
                        <AlertCircle className="w-4 h-4 inline mr-1 text-warning" />
                        Cancelling will refund the unfilled premium for {remainingShares} remaining shares.
                      </p>
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
                        <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-success" />
                        <p className="font-medium">Request Fulfilled</p>
                        <p className="text-sm text-text-secondary">
                          All shares have been accepted. Your policy is active!
                        </p>
                        <Link href={`/v3/policies/${request.id}`}>
                          <Button size="sm" className="mt-4">
                            View Policy
                          </Button>
                        </Link>
                      </>
                    ) : request.status === 'Cancelled' ? (
                      <>
                        <XCircle className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
                        <p className="font-medium">Request Cancelled</p>
                        <p className="text-sm text-text-secondary">Premium has been refunded</p>
                      </>
                    ) : (
                      <>
                        <Clock className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
                        <p className="font-medium">Request Expired</p>
                        <p className="text-sm text-text-secondary">
                          {request.filledShares > 0 
                            ? 'Partially filled - policy created with filled shares'
                            : 'Premium has been refunded'}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* View Policy Link if filled */}
          {request.filledShares > 0 && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="w-5 h-5 text-prmx-cyan" />
                  <span className="font-medium">Policy Created</span>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  A V3 policy has been created with {request.filledShares} shares.
                </p>
                <Link href={`/v3/policies/${request.id}`}>
                  <Button variant="secondary" className="w-full">
                    View Policy Details
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

