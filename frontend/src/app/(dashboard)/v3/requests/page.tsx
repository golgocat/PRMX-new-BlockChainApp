'use client';

import { useState, useCallback } from 'react';
import { 
  ShoppingCart,
  Plus, 
  Search, 
  Clock,
  ChevronRight,
  RefreshCw,
  MapPin,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { formatId } from '@/lib/api-v3';

type TabValue = 'open' | 'my' | 'all';

function getStatusBadge(status: V3RequestStatus, expiresAt: number, filledShares: number = 0) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = expiresAt <= now;
  
  // Partially filled + expired = Policy was created with partial shares
  if (status === 'PartiallyFilled' && isExpired) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="success">Policy Created</Badge>
        <span className="text-[10px] text-text-tertiary">{filledShares} shares</span>
      </div>
    );
  }
  
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
      // Expired status with filled shares means a policy was created
      if (filledShares > 0) {
        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant="success">Policy Created</Badge>
            <span className="text-[10px] text-text-tertiary">{filledShares} shares</span>
          </div>
        );
      }
      return <Badge variant="error">Expired</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
}

export default function V3RequestsPage() {
  const { isConnected, selectedAccount } = useWalletStore();
  
  const { requests: openRequests, loading: openLoading, refresh: refreshOpen, isRefreshing: isRefreshingOpen } = useV3OpenRequests();
  const { requests: allRequests, loading: allLoading, refresh: refreshAll, isRefreshing: isRefreshingAll } = useV3Requests();
  const { requests: myRequests, loading: myLoading, refresh: refreshMy, isRefreshing: isRefreshingMy } = useV3MyRequests();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>('open');
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isRefreshingButton, setIsRefreshingButton] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

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
      isRefreshing = isRefreshingMy;
      break;
    case 'all':
    default:
      requests = allRequests;
      loading = allLoading;
      isRefreshing = isRefreshingAll;
  }

  const filteredRequests = requests
    .filter((request) => {
      const eventInfo = getEventTypeInfo(request.eventSpec.eventType);
      const searchLower = searchQuery.toLowerCase();
      return (
        request.id.toLowerCase().includes(searchLower) ||
        request.location?.name.toLowerCase().includes(searchLower) ||
        eventInfo?.label.toLowerCase().includes(searchLower) ||
        request.requester.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => sortOrder === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id));

  const handleRefresh = useCallback(async () => {
    setIsRefreshingButton(true);
    try {
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
    } finally {
      // Ensure animation is visible for at least 500ms
      setTimeout(() => setIsRefreshingButton(false), 500);
    }
  }, [activeTab, refreshOpen, refreshMy, refreshAll]);

  if (!isConnected) {
    return (
      <div className="space-y-8 pt-4">
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
    <div className="space-y-8 pt-4">
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
            icon={<RefreshCw className={cn('w-4 h-4 transition-transform', isRefreshingButton && 'animate-spin')} />}
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
                placeholder="Search by #, location, event type..."
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
                <TableHeaderCell>
                  <button 
                    onClick={() => setSortOrder(s => s === 'asc' ? 'desc' : 'asc')}
                    className="flex items-center gap-1 hover:text-prmx-cyan transition-colors"
                  >
                    Request
                    {sortOrder === 'asc' ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : (
                      <ArrowDown className="w-3 h-3" />
                    )}
                  </button>
                </TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Coverage</TableHeaderCell>
                <TableHeaderCell>Shares</TableHeaderCell>
                <TableHeaderCell>Premium<br />/Share</TableHeaderCell>
                <TableHeaderCell>Collateral</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-10 w-40 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-20 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-20 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-12 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-12 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-16 bg-background-tertiary/50 rounded" /></TableCell>
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
                />
              ) : (
                filteredRequests.map((request) => {
                  const eventInfo = getEventTypeInfo(request.eventSpec.eventType);
                  const remainingShares = getRemainingShares(request);
                  const isOwner = request.requester === selectedAccount?.address;
                  const canAccept = isRequestAcceptable(request) && !isOwner && remainingShares > 0;
                  
                  // For filled requests, show total collateral locked
                  // For open requests, show collateral needed for remaining shares
                  const collateralToShow = request.status === 'FullyFilled' 
                    ? calculateCollateral(request.totalShares)
                    : calculateCollateral(remainingShares);
                  
                  return (
                    <TableRow key={request.id} className={cn(isRefreshing && 'opacity-50')}>
                      <TableCell>
                        {(() => {
                          // Format short request ID for avatar
                          const shortId = typeof request.id === 'string' && request.id.startsWith('0x') 
                            ? request.id.slice(2, 10) 
                            : String(request.id).slice(0, 8);
                          return (
                            <Link href={`/v3/requests/${request.id}`} className="flex items-center gap-3 group">
                              <div 
                                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-mono text-xs font-bold shadow-sm flex-shrink-0"
                                style={{
                                  background: `linear-gradient(135deg, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 30}, 70%, 50%) 0%, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 60}, 80%, 40%) 100%)`
                                }}
                              >
                                {shortId.slice(0, 4)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-medium text-text-primary group-hover:text-prmx-cyan transition-colors">{shortId}...</span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 uppercase">
                                    REQ
                                  </span>
                                </div>
                                <p className="text-xs text-text-tertiary">
                                  {eventInfo?.label} ≥ {formatThresholdValue(
                                    request.eventSpec.threshold.value, 
                                    request.eventSpec.threshold.unit
                                  )}
                                </p>
                              </div>
                            </Link>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-text-tertiary" />
                          <span>{request.location?.name || `Loc #${request.locationId}`}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {new Date(request.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                            {' → '}
                            {new Date(request.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          {isRequestAcceptable(request) && (
                            <p className="text-xs text-warning flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTimeRemaining(request.expiresAt)}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium">{request.totalShares - remainingShares}</span>
                          <span className="text-text-tertiary"> / {request.totalShares} filled</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-success font-medium">{formatUSDT(request.premiumPerShare, false)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{formatUSDT(collateralToShow, false)}</span>
                        {request.status === 'FullyFilled' && (
                          <span className="text-xs text-text-tertiary block">locked</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {getStatusBadge(request.status, request.expiresAt, request.filledShares)}
                          {isOwner && (
                            <Badge variant="cyan" className="block w-fit">You</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {/* If policy was created (filled or partially filled + expired), link to policy */}
                        {(request.status === 'FullyFilled' || 
                          (request.filledShares > 0 && (request.status === 'Expired' || request.expiresAt <= Math.floor(Date.now() / 1000)))) ? (
                          <Link 
                            href={`/v3/policies/${request.id}`}
                            className="group flex items-center gap-1 text-sm text-prmx-cyan hover:text-prmx-cyan/80 transition-colors"
                          >
                            <span>Policy</span>
                            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                          </Link>
                        ) : canAccept ? (
                          <Link href={`/v3/requests/${request.id}`}>
                            <Button variant="primary" size="sm">
                              Accept
                            </Button>
                          </Link>
                        ) : (
                          <Link 
                            href={`/v3/requests/${request.id}`}
                            className="group flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
                          >
                            <span>Request</span>
                            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                          </Link>
                        )}
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

