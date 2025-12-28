'use client';

import { useState, useCallback } from 'react';
import { 
  ShoppingCart,
  Plus, 
  Search, 
  Clock,
  ChevronRight,
  RefreshCw,
  Users,
  DollarSign,
  MapPin,
  Calendar
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { formatUSDT, formatTimeRemaining, formatDateTimeUTCCompact, formatAddress } from '@/lib/utils';
import { useWalletStore } from '@/stores/walletStore';
import { useV3OpenRequests, useV3Requests, useV3MyRequests } from '@/hooks/useV3ChainData';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { cn } from '@/lib/utils';
import { 
  V3Request, 
  V3RequestStatus, 
  getEventTypeInfo, 
  formatThresholdValue,
  getRemainingShares,
  isRequestAcceptable,
  calculateCollateral
} from '@/types/v3';

type TabValue = 'open' | 'my' | 'all';

function getStatusBadge(status: V3RequestStatus, expiresAt: number) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = expiresAt <= now;
  
  if (status === 'Pending' && isExpired) {
    return <Badge variant="error">Expired</Badge>;
  }
  
  switch (status) {
    case 'Pending':
      return <Badge variant="warning">Pending</Badge>;
    case 'PartiallyFilled':
      return <Badge variant="info">Partial</Badge>;
    case 'FullyFilled':
      return <Badge variant="success">Filled</Badge>;
    case 'Cancelled':
      return <Badge variant="default">Cancelled</Badge>;
    case 'Expired':
      return <Badge variant="error">Expired</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
}

export default function V3RequestsPage() {
  const { isConnected, selectedAccount } = useWalletStore();
  
  const { requests: openRequests, loading: openLoading, refresh: refreshOpen, isRefreshing: isRefreshingOpen } = useV3OpenRequests();
  const { requests: allRequests, loading: allLoading, refresh: refreshAll, isRefreshing: isRefreshingAll } = useV3Requests();
  const { requests: myRequests, loading: myLoading, refresh: refreshMy } = useV3MyRequests();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>('open');
  const [showWalletModal, setShowWalletModal] = useState(false);

  // Determine which requests to show
  let requests: V3Request[];
  let loading: boolean;
  let isRefreshing: boolean;
  
  switch (activeTab) {
    case 'open':
      requests = openRequests;
      loading = openLoading;
      isRefreshing = isRefreshingOpen;
      break;
    case 'my':
      requests = myRequests;
      loading = myLoading;
      isRefreshing = false;
      break;
    case 'all':
    default:
      requests = allRequests;
      loading = allLoading;
      isRefreshing = isRefreshingAll;
  }

  const filteredRequests = requests.filter((request) => {
    const eventInfo = getEventTypeInfo(request.eventSpec.eventType);
    const searchLower = searchQuery.toLowerCase();
    return (
      request.location?.name.toLowerCase().includes(searchLower) ||
      eventInfo?.label.toLowerCase().includes(searchLower) ||
      request.requester.toLowerCase().includes(searchLower)
    );
  });

  // Stats
  const totalOpenRequests = openRequests.length;
  const totalOpenShares = openRequests.reduce((sum, r) => sum + getRemainingShares(r), 0);
  const totalVolume = openRequests.reduce(
    (sum, r) => sum + BigInt(r.totalShares) * r.premiumPerShare, 
    BigInt(0)
  );
  const avgPremiumPerShare = openRequests.length > 0
    ? openRequests.reduce((sum, r) => sum + Number(r.premiumPerShare), 0) / openRequests.length
    : 0;

  const handleRefresh = useCallback(async () => {
    switch (activeTab) {
      case 'open':
        await refreshOpen();
        break;
      case 'my':
        await refreshMy();
        break;
      case 'all':
        await refreshAll();
        break;
    }
  }, [activeTab, refreshOpen, refreshMy, refreshAll]);

  if (!isConnected) {
    return (
      <div className="space-y-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
          </div>
          <h1 className="text-3xl font-bold">Climate Risk Marketplace</h1>
          <p className="text-text-secondary mt-1">Peer-to-peer weather protection requests</p>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to browse and accept underwrite requests, or create your own protection requests
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
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
          </div>
          <h1 className="text-3xl font-bold">Climate Risk Marketplace</h1>
          <p className="text-text-secondary mt-1">Peer-to-peer weather protection requests</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('w-4 h-4 transition-transform', isRefreshing && 'animate-spin')} />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          <Link href="/v3/requests/new">
            <Button icon={<Plus className="w-5 h-5" />}>
              Create Request
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          title="Open Requests"
          value={openLoading ? '...' : totalOpenRequests}
          icon={<ShoppingCart className="w-5 h-5" />}
        />
        <StatCard
          title="Available Shares"
          value={openLoading ? '...' : totalOpenShares}
          icon={<Users className="w-5 h-5" />}
          iconColor="bg-prmx-purple/10 text-prmx-purple"
        />
        <StatCard
          title="Total Premium Volume"
          value={openLoading ? '...' : formatUSDT(totalVolume)}
          icon={<DollarSign className="w-5 h-5" />}
          iconColor="bg-success/10 text-success"
        />
        <StatCard
          title="Avg Premium/Share"
          value={openLoading ? '...' : formatUSDT(BigInt(Math.round(avgPremiumPerShare)))}
          icon={<DollarSign className="w-5 h-5" />}
          iconColor="bg-prmx-cyan/10 text-prmx-cyan"
        />
      </div>

      {/* Request List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Tabs defaultValue="open" onChange={(v) => setActiveTab(v as TabValue)}>
              <TabsList>
                <TabsTrigger value="open">Open ({openRequests.length})</TabsTrigger>
                <TabsTrigger value="my">My Requests ({myRequests.length})</TabsTrigger>
                <TabsTrigger value="all">All ({allRequests.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1">
              <Input
                placeholder="Search by location, event type, or requester..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="w-5 h-5" />}
                className="max-w-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Event Type</TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Coverage Period</TableHeaderCell>
                <TableHeaderCell>Shares</TableHeaderCell>
                <TableHeaderCell>Premium/Share</TableHeaderCell>
                <TableHeaderCell>Collateral Needed</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 w-24 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-28 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-32 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-16 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-16 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-20 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-6 w-16 bg-background-tertiary/50 rounded-full" /></TableCell>
                      <TableCell><div className="h-8 w-8 bg-background-tertiary/50 rounded" /></TableCell>
                    </TableRow>
                  ))}
                </>
              ) : filteredRequests.length === 0 ? (
                <TableEmpty
                  icon={<ShoppingCart className="w-8 h-8" />}
                  title="No requests found"
                  description={
                    activeTab === 'my' 
                      ? "You haven't created any requests yet" 
                      : activeTab === 'open'
                        ? "No open requests at the moment"
                        : "No requests match your search"
                  }
                  action={
                    activeTab === 'my' ? (
                      <Link href="/v3/requests/new">
                        <Button size="sm" icon={<Plus className="w-4 h-4" />}>
                          Create Request
                        </Button>
                      </Link>
                    ) : undefined
                  }
                />
              ) : (
                filteredRequests.map((request) => {
                  const eventInfo = getEventTypeInfo(request.eventSpec.eventType);
                  const remainingShares = getRemainingShares(request);
                  const isOwner = request.requester === selectedAccount?.address;
                  const canAccept = isRequestAcceptable(request) && !isOwner && remainingShares > 0;
                  const collateralPerShare = calculateCollateral(1);
                  const totalCollateralNeeded = calculateCollateral(remainingShares);
                  
                  return (
                    <TableRow key={request.id} className={cn(isRefreshing && 'opacity-50')}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-prmx-gradient flex items-center justify-center">
                            <span className="text-lg">{eventInfo?.icon || '🌡️'}</span>
                          </div>
                          <div>
                            <p className="font-medium">{eventInfo?.label || request.eventSpec.eventType}</p>
                            <p className="text-xs text-text-tertiary">
                              {formatThresholdValue(
                                request.eventSpec.threshold.value, 
                                request.eventSpec.threshold.unit
                              )}
                              {request.eventSpec.earlyTrigger && ' (early trigger)'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-text-tertiary" />
                          <span>{request.location?.name || `Loc #${request.locationId}`}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-text-tertiary" />
                            {formatDateTimeUTCCompact(request.coverageStart)} - {formatDateTimeUTCCompact(request.coverageEnd)}
                          </p>
                          {isRequestAcceptable(request) && (
                            <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
                              <Clock className="w-3 h-3" />
                              Expires in {formatTimeRemaining(request.expiresAt)}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium">{remainingShares}</span>
                          <span className="text-text-tertiary"> / {request.totalShares}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-success font-medium">{formatUSDT(request.premiumPerShare)}</span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{formatUSDT(collateralPerShare)}/share</p>
                          <p className="text-xs text-text-tertiary">
                            Total: {formatUSDT(totalCollateralNeeded)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {getStatusBadge(request.status, request.expiresAt)}
                          {isOwner && (
                            <Badge variant="cyan" className="block w-fit">You</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/v3/requests/${request.id}`}>
                          <Button 
                            variant={canAccept ? 'primary' : 'ghost'} 
                            size="sm"
                          >
                            {canAccept ? 'Accept' : <ChevronRight className="w-4 h-4" />}
                          </Button>
                        </Link>
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

