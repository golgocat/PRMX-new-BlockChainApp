'use client';

import { useState } from 'react';
import { 
  Globe2, 
  MapPin, 
  Droplets, 
  TrendingUp, 
  Users, 
  Search,
  Filter,
  ArrowUpRight,
  Info,
  Plus,
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Modal } from '@/components/ui/Modal';
import { formatCoordinates, formatBasisPoints, secondsToDays } from '@/lib/utils';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useMarkets, usePolicies, useRainfallData } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function MarketsPage() {
  const { selectedAccount, isConnected } = useWalletStore();
  const isDao = useIsDao();
  
  const { markets, loading, error, refresh } = useMarkets();
  const { policies } = usePolicies();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Create market form state
  const [newMarket, setNewMarket] = useState({
    name: '',
    centerLatitude: '',
    centerLongitude: '',
    timezoneOffsetHours: '0', // UTC offset in hours (e.g., 8 for Manila, 9 for Tokyo)
    strikeValue: '50',
    daoMarginBp: '2000',
    minDurationDays: '0',  // 0 for testing (allows immediate coverage)
    maxDurationDays: '7',
    minLeadTimeDays: '0',  // 0 for testing (no lead time required)
  });

  const filteredMarkets = markets.filter((market) => {
    const matchesSearch = market.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || market.status.toLowerCase() === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalActivePolicies = policies.filter(p => p.status === 'Active').length;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleCreateMarket = async () => {
    if (!isDao || !selectedAccount) {
      toast.error('Only DAO Admin can create markets');
      return;
    }

    if (!newMarket.name || !newMarket.centerLatitude || !newMarket.centerLongitude) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsCreating(true);
    try {
      const keypair = useWalletStore.getState().getKeypair();
      if (!keypair) throw new Error('No keypair available');

      await api.createMarket(keypair, {
        name: newMarket.name,
        centerLatitude: Math.round(parseFloat(newMarket.centerLatitude) * 1_000_000),
        centerLongitude: Math.round(parseFloat(newMarket.centerLongitude) * 1_000_000),
        timezoneOffsetHours: parseInt(newMarket.timezoneOffsetHours),
        strikeValue: parseInt(newMarket.strikeValue),
        daoMarginBp: parseInt(newMarket.daoMarginBp),
        minDurationSecs: parseInt(newMarket.minDurationDays) * 86400,
        maxDurationSecs: parseInt(newMarket.maxDurationDays) * 86400,
        minLeadTimeSecs: parseInt(newMarket.minLeadTimeDays) * 86400,
      });

      toast.success('Market created successfully!');
      setShowCreateModal(false);
      setNewMarket({
        name: '',
        centerLatitude: '',
        centerLongitude: '',
        timezoneOffsetHours: '0',
        strikeValue: '50',
        daoMarginBp: '2000',
        minDurationDays: '0',
        maxDurationDays: '7',
        minLeadTimeDays: '0',
      });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create market');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Markets</h1>
          <p className="text-text-secondary mt-1">Explore available insurance markets by region</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          {isDao && (
            <Button icon={<Plus className="w-5 h-5" />} onClick={() => setShowCreateModal(true)}>
              Create Market
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          title="Total Markets"
          value={loading ? '...' : markets.length}
          icon={<Globe2 className="w-5 h-5" />}
        />
        <StatCard
          title="Active Policies"
          value={totalActivePolicies}
          icon={<Users className="w-5 h-5" />}
          iconColor="bg-prmx-purple/10 text-prmx-purple-light"
        />
        <StatCard
          title="Open Markets"
          value={markets.filter(m => m.status === 'Open').length}
          icon={<TrendingUp className="w-5 h-5" />}
          iconColor="bg-success/10 text-success"
        />
        <StatCard
          title="Avg. Strike"
          value={markets.length > 0 
            ? `${Math.round(markets.reduce((s, m) => s + m.strikeValue, 0) / markets.length)} mm`
            : '0 mm'
          }
          icon={<Droplets className="w-5 h-5" />}
          iconColor="bg-info/10 text-info"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-64">
              <Input
                placeholder="Search markets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="w-5 h-5" />}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-text-tertiary" />
              <select
                className="select-field !w-auto"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Markets Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-8 h-8 animate-spin text-text-tertiary" />
        </div>
      ) : filteredMarkets.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Globe2 className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">
              {markets.length === 0 ? 'No markets created yet' : 'No markets found'}
            </h3>
            <p className="text-text-secondary mb-4">
              {markets.length === 0 
                ? 'Be the first to create an insurance market' 
                : 'Try adjusting your search or filter criteria'}
            </p>
            {isDao && markets.length === 0 && (
              <Button onClick={() => setShowCreateModal(true)}>
                Create First Market
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMarkets.map((market) => {
            const marketPolicies = policies.filter(p => p.marketId === market.id);
            const activePolicies = marketPolicies.filter(p => p.status === 'Active').length;

            return (
              <Link key={market.id} href={`/markets/${market.id}`}>
                <Card hover className="h-full">
                  <CardContent className="p-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-prmx-gradient flex items-center justify-center">
                          <Globe2 className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold">{market.name}</h3>
                            {/* V1/V2 Badge - Manila (id=0) supports V2 */}
                            {market.id === 0 ? (
                              <div className="flex gap-1">
                                <Badge variant="default" className="text-xs px-1.5 py-0.5">V1</Badge>
                                <Badge variant="purple" className="text-xs px-1.5 py-0.5">V2</Badge>
                              </div>
                            ) : (
                              <Badge variant="default" className="text-xs px-1.5 py-0.5">V1</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-text-secondary">
                            <MapPin className="w-3 h-3" />
                            {formatCoordinates(market.centerLatitude, market.centerLongitude)}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status={market.status} />
                    </div>

                    {/* Market Info */}
                    <div className="mb-4 p-3 rounded-xl bg-background-tertiary/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-text-secondary flex items-center gap-1">
                          <Droplets className="w-4 h-4" />
                          Strike Threshold
                        </span>
                        <span className="font-semibold">{market.strikeValue} mm</span>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-text-tertiary">Active Policies</p>
                        <p className="font-semibold">{activePolicies}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-tertiary">Total Policies</p>
                        <p className="font-semibold">{marketPolicies.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-tertiary">DAO Margin</p>
                        <p className="font-semibold">{formatBasisPoints(market.riskParameters.daoMarginBp)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-tertiary">Coverage Duration</p>
                        <p className="font-semibold text-prmx-cyan">24 hours</p>
                      </div>
                    </div>

                    {/* Action */}
                    <div className="flex items-center justify-between pt-4 border-t border-border-secondary">
                      <div className="flex items-center gap-1 text-xs text-text-tertiary">
                        <Info className="w-3 h-3" />
                        <span>Lead time: {secondsToDays(market.windowRules.minLeadTimeSecs)} days</span>
                      </div>
                      <span className="text-prmx-cyan flex items-center gap-1 text-sm">
                        View Details <ArrowUpRight className="w-4 h-4" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create Market Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Market"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Market Name *"
            placeholder="e.g., Manila"
            value={newMarket.name}
            onChange={(e) => setNewMarket({ ...newMarket, name: e.target.value })}
          />
          
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Center Latitude *"
              type="number"
              step="0.0001"
              placeholder="e.g., 14.5995"
              value={newMarket.centerLatitude}
              onChange={(e) => setNewMarket({ ...newMarket, centerLatitude: e.target.value })}
              hint="Decimal degrees"
            />
            <Input
              label="Center Longitude *"
              type="number"
              step="0.0001"
              placeholder="e.g., 120.9842"
              value={newMarket.centerLongitude}
              onChange={(e) => setNewMarket({ ...newMarket, centerLongitude: e.target.value })}
              hint="Decimal degrees"
            />
          </div>

          <Input
            label="Timezone (UTC offset) *"
            type="number"
            min="-12"
            max="14"
            placeholder="e.g., 8 for UTC+8"
            value={newMarket.timezoneOffsetHours}
            onChange={(e) => setNewMarket({ ...newMarket, timezoneOffsetHours: e.target.value })}
            hint="Hours from UTC (e.g., 8 for Manila, 9 for Tokyo, -5 for New York)"
          />

          <Input
            label="Strike Value (mm)"
            type="number"
            placeholder="50"
            value={newMarket.strikeValue}
            onChange={(e) => setNewMarket({ ...newMarket, strikeValue: e.target.value })}
            hint="24-hour rainfall threshold to trigger payout"
          />

          <Input
            label="DAO Margin (basis points)"
            type="number"
            placeholder="2000"
            value={newMarket.daoMarginBp}
            onChange={(e) => setNewMarket({ ...newMarket, daoMarginBp: e.target.value })}
            hint="2000 = 20% margin over fair premium"
          />

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Min Duration (days)"
              type="number"
              value={newMarket.minDurationDays}
              onChange={(e) => setNewMarket({ ...newMarket, minDurationDays: e.target.value })}
            />
            <Input
              label="Max Duration (days)"
              type="number"
              value={newMarket.maxDurationDays}
              onChange={(e) => setNewMarket({ ...newMarket, maxDurationDays: e.target.value })}
            />
            <Input
              label="Min Lead Time (days)"
              type="number"
              value={newMarket.minLeadTimeDays}
              onChange={(e) => setNewMarket({ ...newMarket, minLeadTimeDays: e.target.value })}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleCreateMarket} loading={isCreating} className="flex-1">
              Create Market
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
