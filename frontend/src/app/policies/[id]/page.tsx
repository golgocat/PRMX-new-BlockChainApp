'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Shield, 
  ChevronLeft, 
  MapPin, 
  Calendar, 
  Users,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  Droplets,
  CloudRain,
  Wallet,
  ArrowRight,
  Copy,
  Check,
  Lock
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useMarkets } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import { formatUSDT, formatDate, formatDateTimeUTC, formatAddress, formatCoordinates, formatTimeRemaining } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Policy, Market, PolicyDefiInfo } from '@/types';
import type { SettlementResult } from '@/lib/api';

export default function PolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const policyId = Number(params.id);
  
  const { isConnected } = useWalletStore();
  const isDao = useIsDao();
  const { markets } = useMarkets();
  
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);
  const [poolInfo, setPoolInfo] = useState<{ address: string; balance: bigint } | null>(null);
  const [defiInfo, setDefiInfo] = useState<PolicyDefiInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    if (poolInfo?.address) {
      await navigator.clipboard.writeText(poolInfo.address);
      setCopied(true);
      toast.success('Pool address copied!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    if (isNaN(policyId) || policyId < 0) {
      router.push('/policies');
      return;
    }
    
    loadPolicy();
    
    // Auto-refresh every 10 seconds for real-time settlement updates
    const interval = setInterval(() => {
      loadPolicy();
    }, 10000);
    
    return () => clearInterval(interval);
  }, [policyId]);

  const loadPolicy = async () => {
    setLoading(true);
    try {
      const policies = await api.getPolicies();
      const found = policies.find(p => p.id === policyId);
      if (found) {
        setPolicy(found);
        // Load market info
        const marketInfo = markets.find(m => m.id === found.marketId);
        if (marketInfo) {
          setMarket(marketInfo);
        } else {
          const m = await api.getMarket(found.marketId);
          setMarket(m);
        }
        // Load pool info (address + balance)
        try {
          const pool = await api.getPolicyPoolInfo(policyId);
          setPoolInfo(pool);
        } catch (poolErr) {
          console.error('Failed to load pool info:', poolErr);
        }
        // Load DeFi allocation info
        try {
          const defi = await api.getPolicyDefiInfo(policyId);
          setDefiInfo(defi);
        } catch (defiErr) {
          console.error('Failed to load DeFi info:', defiErr);
        }
        // Load settlement result if policy is settled
        if (found.status === 'Settled') {
          const result = await api.getSettlementResult(policyId);
          setSettlementResult(result);
        }
      }
    } catch (err) {
      console.error('Failed to load policy:', err);
      toast.error('Failed to load policy details');
    } finally {
      setLoading(false);
    }
  };

  const handleSettle = async (eventOccurred: boolean) => {
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect wallet');
      return;
    }

    setSettling(true);
    try {
      await api.settlePolicy(keypair, policyId, eventOccurred);
      toast.success(`Policy settled ${eventOccurred ? '(event occurred - payout!)' : '(no event)'}`);
      await loadPolicy();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to settle policy');
    } finally {
      setSettling(false);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const isExpired = policy && policy.coverageEnd <= now;
  const isActive = policy?.status === 'Active';
  const canSettle = isDao && isActive && isExpired;

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Policy Details</h1>
            <p className="text-text-secondary mt-1">Loading...</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <RefreshCw className="w-12 h-12 mx-auto mb-4 animate-spin text-prmx-cyan" />
            <p className="text-text-secondary">Loading policy details...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Policy Not Found</h1>
            <p className="text-text-secondary mt-1">The requested policy does not exist</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Policy not found</h3>
            <p className="text-text-secondary mb-6">
              This policy may have been removed or never existed.
            </p>
            <Link href="/policies">
              <Button>Back to Policies</Button>
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
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">Policy {policy.label}</h1>
              <StatusBadge status={policy.status} />
            </div>
            <p className="text-text-secondary mt-1">
              {market?.name || `Market #${policy.marketId}`} Coverage
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={loadPolicy} icon={<RefreshCw className="w-4 h-4" />}>
          Refresh
        </Button>
      </div>

      {/* Main Info Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Policy Overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-prmx-cyan" />
              Policy Overview
            </h2>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Market Info */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-prmx-gradient flex items-center justify-center">
                    <MapPin className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{market?.name || `Market #${policy.marketId}`}</h3>
                    {market && (
                      <p className="text-sm text-text-secondary">
                        {formatCoordinates(market.centerLatitude, market.centerLongitude)}
                      </p>
                    )}
                  </div>
                </div>
                <Link href={`/oracle?marketId=${policy.marketId}`}>
                  <Button variant="secondary" size="sm" icon={<Droplets className="w-4 h-4" />}>
                    View Rainfall
                  </Button>
                </Link>
              </div>
              {market && (
                <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                  <div>
                    <span className="text-text-secondary">Strike Value</span>
                    <p className="font-medium">{market.strikeValue} mm (24h rolling)</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Payout per Share</span>
                    <p className="font-medium">{formatUSDT(market.payoutPerShare)}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Coverage Period */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-border-secondary">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-text-secondary" />
                  <span className="text-sm text-text-secondary">Coverage Start (UTC)</span>
                </div>
                <p className="font-semibold text-lg">{formatDateTimeUTC(policy.coverageStart)}</p>
              </div>
              <div className="p-4 rounded-xl border border-border-secondary">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-text-secondary" />
                  <span className="text-sm text-text-secondary">Coverage End (UTC)</span>
                </div>
                <p className="font-semibold text-lg">{formatDateTimeUTC(policy.coverageEnd)}</p>
              </div>
            </div>

            {/* Time Remaining */}
            {isActive && (
              <div className={`p-4 rounded-xl ${isExpired ? 'bg-warning/10 border border-warning/30' : 'bg-prmx-cyan/10 border border-prmx-cyan/30'}`}>
                <div className="flex items-center gap-2">
                  <Clock className={`w-5 h-5 ${isExpired ? 'text-warning' : 'text-prmx-cyan'}`} />
                  <span className="font-medium">
                    {isExpired ? 'Coverage Expired - Awaiting Settlement' : formatTimeRemaining(policy.coverageEnd)}
                  </span>
                </div>
              </div>
            )}

            {/* Holder Info */}
            <div className="p-4 rounded-xl border border-border-secondary">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-text-secondary" />
                <span className="text-sm text-text-secondary">Policy Holder</span>
              </div>
              <p className="font-mono text-sm">{policy.holder}</p>
            </div>

            {/* Created At */}
            <div className="p-4 rounded-xl border border-border-secondary">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-text-secondary" />
                <span className="text-sm text-text-secondary">Policy Created (UTC)</span>
              </div>
              <p className="font-semibold">{formatDateTimeUTC(policy.createdAt)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-success" />
                Financial Summary
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl bg-success/10 border border-success/30">
                <span className="text-sm text-text-secondary">Max Payout</span>
                <p className="text-2xl font-bold text-success">{formatUSDT(policy.maxPayout)}</p>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Shares</span>
                  <span className="font-medium">{Number(policy.shares)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Premium Paid</span>
                  <span className="font-medium">{formatUSDT(policy.premiumPaid)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Capital Pool</span>
                  <span className="font-medium">{formatUSDT(policy.capitalPool.totalCapital)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pool Account Info */}
          {poolInfo && (
            <Card className="border-prmx-purple/30">
              <CardHeader className="pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Lock className="w-5 h-5 text-prmx-purple" />
                  Locked Funds
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Pool Balance */}
                <div className="p-4 rounded-xl bg-prmx-purple/10 border border-prmx-purple/30">
                  <span className="text-sm text-text-secondary">Pool Balance</span>
                  <p className="text-2xl font-bold text-prmx-purple-light">
                    {formatUSDT(poolInfo.balance)}
                  </p>
                </div>
                
                {/* Pool Address */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Pool Address</span>
                    <button
                      onClick={handleCopyAddress}
                      className="flex items-center gap-1 text-xs text-prmx-cyan hover:text-prmx-cyan/80 transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-3 rounded-lg bg-background-tertiary/50 border border-border-secondary">
                    <p className="font-mono text-xs break-all text-text-secondary">
                      {poolInfo.address}
                    </p>
                  </div>
                </div>
                
                <p className="text-xs text-text-tertiary">
                  Funds are locked in this derived account until policy settlement.
                </p>
              </CardContent>
            </Card>
          )}

          {/* DeFi Allocation Card */}
          {defiInfo && (
            <Card className={defiInfo.isAllocatedToDefi ? 'border-success/30' : 'border-border-secondary'}>
              <CardHeader className="pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-success" />
                  DeFi Yield Strategy
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Investment Status */}
                <div className={`p-4 rounded-xl ${
                  defiInfo.isAllocatedToDefi 
                    ? 'bg-success/10 border border-success/30' 
                    : 'bg-background-tertiary/50 border border-border-secondary'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">Status</span>
                    <Badge 
                      variant={defiInfo.isAllocatedToDefi ? 'success' : 'default'}
                      className="text-xs"
                    >
                      {defiInfo.investmentStatus === 'Invested' && '🟢 Allocated to DeFi'}
                      {defiInfo.investmentStatus === 'NotInvested' && '⚪ Not Allocated'}
                      {defiInfo.investmentStatus === 'Unwinding' && '🔄 Unwinding'}
                      {defiInfo.investmentStatus === 'Settled' && '✓ Settled'}
                      {defiInfo.investmentStatus === 'Failed' && '❌ Failed'}
                    </Badge>
                  </div>
                  {defiInfo.isAllocatedToDefi && (
                    <p className="text-xs text-text-secondary">
                      Locked funds are generating yield via Hydration Stableswap
                    </p>
                  )}
                </div>

                {/* Position Details (if allocated) */}
                {defiInfo.position && (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-text-secondary text-sm">Principal Allocated</span>
                      <span className="font-medium text-success">
                        {formatUSDT(defiInfo.position.principalUsdt)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary text-sm">LP Shares</span>
                      <span className="font-medium">
                        {Number(defiInfo.position.lpShares).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                {/* Info tooltip */}
                <div className="p-3 rounded-lg bg-prmx-cyan/5 border border-prmx-cyan/20">
                  <p className="text-xs text-text-secondary">
                    💡 Policy funds may be allocated to DeFi strategies to generate yield. 
                    The DAO guarantees coverage of potential losses.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Settlement Actions (DAO only) */}
          {canSettle && (
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold">Settlement</h2>
                <p className="text-sm text-text-secondary">Settle this expired policy</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={() => handleSettle(true)}
                  loading={settling}
                  className="w-full bg-success hover:bg-success/90"
                  icon={<CheckCircle2 className="w-4 h-4" />}
                >
                  Event Occurred (Pay Out)
                </Button>
                <Button
                  onClick={() => handleSettle(false)}
                  loading={settling}
                  variant="secondary"
                  className="w-full"
                  icon={<XCircle className="w-4 h-4" />}
                >
                  No Event (Return Capital)
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Settlement Result Card */}
          {policy.status === 'Settled' && (
            <Card className={settlementResult?.eventOccurred ? 'border-success/30' : 'border-prmx-cyan/30'}>
              <CardHeader className="pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  Settlement Result
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {settlementResult ? (
                  <>
                    {/* Event Status */}
                    <div className={`p-4 rounded-xl ${settlementResult.eventOccurred ? 'bg-success/10 border border-success/30' : 'bg-prmx-cyan/10 border border-prmx-cyan/30'}`}>
                      <div className="flex items-center gap-3 mb-2">
                        {settlementResult.eventOccurred ? (
                          <CloudRain className="w-6 h-6 text-success" />
                        ) : (
                          <CheckCircle2 className="w-6 h-6 text-prmx-cyan" />
                        )}
                        <div>
                          <p className="font-semibold">
                            {settlementResult.eventOccurred ? 'Event Occurred' : 'No Event'}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {settlementResult.eventOccurred 
                              ? 'Rainfall exceeded strike threshold' 
                              : 'Rainfall stayed below strike threshold'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* DeFi Position Unwound Indicator */}
                    {defiInfo && defiInfo.investmentStatus === 'Settled' && defiInfo.position && (
                      <div className="p-3 rounded-lg bg-prmx-purple/5 border border-prmx-purple/20">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-4 h-4 text-prmx-purple" />
                          <span className="text-sm font-medium">DeFi Position Unwound</span>
                        </div>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Principal Invested</span>
                            <span className="font-medium">{formatUSDT(defiInfo.position.principalUsdt)}</span>
                          </div>
                          <p className="text-xs text-text-tertiary mt-2">
                            Position was unwound from DeFi strategy at settlement
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Financial Outcome */}
                    <div className="space-y-3">
                      {settlementResult.eventOccurred ? (
                        <>
                        <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                          <div className="flex items-center gap-2 mb-1">
                            <Wallet className="w-4 h-4 text-success" />
                            <span className="text-sm text-text-secondary">Payout to Policyholder</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-xl font-bold text-success">
                              {formatUSDT(settlementResult.payoutToHolder)}
                            </p>
                            <ArrowRight className="w-4 h-4 text-text-tertiary" />
                            <span className="text-sm text-text-secondary truncate">
                              {formatAddress(policy.holder)}
                            </span>
                          </div>
                        </div>
                          
                          {/* Partial Payout Warning (when payout < maxPayout) */}
                          {settlementResult.payoutToHolder < policy.maxPayout && (
                            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                              <div className="flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-warning mt-0.5" />
                                <div>
                                  <p className="text-sm font-medium text-warning">Partial Payout</p>
                                  <p className="text-xs text-text-secondary mt-1">
                                    Payout was {formatUSDT(settlementResult.payoutToHolder)} instead of the full {formatUSDT(policy.maxPayout)} due to DeFi losses that exceeded DAO coverage capacity.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                        <div className="p-3 rounded-lg bg-prmx-cyan/5 border border-prmx-cyan/20">
                          <div className="flex items-center gap-2 mb-1">
                            <TrendingUp className="w-4 h-4 text-prmx-cyan" />
                            <span className="text-sm text-text-secondary">Returned to LPs</span>
                          </div>
                          <p className="text-xl font-bold text-prmx-cyan">
                            {formatUSDT(settlementResult.returnedToLps)}
                          </p>
                        </div>

                          {/* LP Loss Warning (when returned < expected pool balance) */}
                          {defiInfo?.position && settlementResult.returnedToLps < defiInfo.position.principalUsdt && (
                            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                              <div className="flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-warning mt-0.5" />
                                <div>
                                  <p className="text-sm font-medium text-warning">LP Loss Absorbed</p>
                                  <p className="text-xs text-text-secondary mt-1">
                                    LPs received {formatUSDT(settlementResult.returnedToLps)} instead of full principal due to DeFi losses. 
                                    The DAO covered what it could.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* DAO Contribution Note (show when DeFi was involved) */}
                    {defiInfo?.position && (
                      <div className="p-2 rounded-lg bg-prmx-cyan/5">
                        <p className="text-xs text-text-secondary text-center">
                          🛡️ DAO provided loss coverage for DeFi-allocated funds
                        </p>
                      </div>
                    )}

                    {/* Settlement Time */}
                    <div className="pt-2 border-t border-border-secondary">
                      <div className="flex items-center gap-2 text-xs text-text-tertiary">
                        <Clock className="w-3 h-3" />
                        Settled on {formatDateTimeUTC(settlementResult.settledAt)}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-success" />
                    <p className="text-sm text-text-secondary">
                      Policy has been settled
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Capital Pool Details */}
      {policy.capitalPool.lpHolders && policy.capitalPool.lpHolders.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-prmx-purple" />
              LP Capital Pool
            </h2>
            <p className="text-sm text-text-secondary">
              Liquidity providers backing this policy
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {policy.capitalPool.lpHolders.map((holder: string, index: number) => (
                <div key={index} className="p-3 rounded-lg bg-background-tertiary/50">
                  <p className="font-mono text-xs truncate">{formatAddress(holder)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
