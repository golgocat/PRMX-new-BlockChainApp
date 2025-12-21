'use client';

import { useState, useEffect } from 'react';
import { 
  Shield, 
  MapPin, 
  Calendar, 
  Droplets, 
  ChevronLeft,
  ChevronRight,
  Check,
  Info,
  RefreshCw,
  Clock,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { DatePicker } from '@/components/ui/DatePicker';
import { addDays, startOfDay } from 'date-fns';
import { useWalletStore, useFormattedBalance, useIsDao } from '@/stores/walletStore';
import { useMarkets, useQuoteRequests } from '@/hooks/useChainData';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import * as api from '@/lib/api';
import { formatUSDT, formatCoordinates, formatDateTimeUTC, secondsToDays } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Market, QuoteRequest } from '@/types';

const steps = [
  { id: 1, title: 'Select Market' },
  { id: 2, title: 'Coverage Details' },
  { id: 3, title: 'Request Quote' },
  { id: 4, title: 'Apply Coverage' },
];

// Format timezone offset as string (e.g., "UTC+9")
const formatTimezoneOffset = (offsetHours: number): string => {
  const sign = offsetHours >= 0 ? '+' : '';
  return `UTC${sign}${offsetHours}`;
};

export default function NewPolicyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isConnected, selectedAccount } = useWalletStore();
  const { usdtBalance } = useWalletStore();
  const { usdtFormatted } = useFormattedBalance();
  const isDao = useIsDao();
  
  const { markets, loading: marketsLoading } = useMarkets();
  const { quotes, refresh: refreshQuotes } = useQuoteRequests();
  
  // Get marketId from URL params (from landing page quote calculator)
  const preselectedMarketId = searchParams.get('marketId');
  
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quoteRequestId, setQuoteRequestId] = useState<number | null>(null);
  const [currentQuote, setCurrentQuote] = useState<QuoteRequest | null>(null);
  const [policyId, setPolicyId] = useState<number | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  
  // Form state
  const [shares, setShares] = useState('1');
  const [coverageStartDate, setCoverageStartDate] = useState<Date | undefined>(undefined);
  const [policyVersion, setPolicyVersion] = useState<'V1' | 'V2'>('V1');
  const [v2DurationDays, setV2DurationDays] = useState(2); // 2-7 days for V2
  
  // Duration depends on version: V1 = 1 day, V2 = user-selected (2-7 days)
  const coverageDurationDays = policyVersion === 'V2' ? v2DurationDays : 1;
  
  // Check if selected market supports V2 (only Manila, marketId = 0)
  const isV2Available = selectedMarket?.id === 0;

  // Pre-select market from URL params (from landing page quote calculator)
  useEffect(() => {
    if (!marketsLoading && markets.length > 0 && preselectedMarketId && !selectedMarket) {
      const market = markets.find(m => m.id === parseInt(preselectedMarketId));
      if (market) {
        setSelectedMarket(market);
        setCurrentStep(2); // Skip to Coverage Details step
      }
    }
  }, [markets, marketsLoading, preselectedMarketId, selectedMarket]);

  // Poll for quote result
  useEffect(() => {
    if (quoteRequestId === null || currentStep !== 3) return;
    
    const pollInterval = setInterval(async () => {
      await refreshQuotes();
      const quote = quotes.find(q => q.id === quoteRequestId);
      if (quote) {
        setCurrentQuote(quote);
        if (quote.result) {
          clearInterval(pollInterval);
        }
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [quoteRequestId, currentStep, quotes, refreshQuotes]);

  // Calculate minimum start date based on market lead time
  const minLeadTimeDays = selectedMarket 
    ? secondsToDays(selectedMarket.windowRules.minLeadTimeSecs) 
    : 0;
  const minStartDate = addDays(startOfDay(new Date()), minLeadTimeDays);
  
  // Calculate coverage dates (Unix timestamps for API)
  // Coverage is from 00:00:00 to 23:59:59 in the MARKET'S local timezone
  // For Tokyo (UTC+9): 00:00 Tokyo = 15:00 UTC previous day
  // Timezone offset now comes from on-chain market data
  const marketTimezoneOffset = selectedMarket?.timezoneOffsetHours ?? 0;
  const coverageStart = coverageStartDate 
    ? (Date.UTC(
        coverageStartDate.getFullYear(),
        coverageStartDate.getMonth(),
        coverageStartDate.getDate(),
        0, 0, 0
      ) / 1000) - (marketTimezoneOffset * 3600)  // Subtract timezone offset to get UTC
    : 0;
  // End time is 23:59:59 in market's local time (24 hours - 1 second from start)
  const coverageEnd = coverageStart + (coverageDurationDays * 86400) - 1;
  const sharesNum = parseInt(shares) || 1;
  const maxPayout = sharesNum * 100; // $100 per share

  const handleMarketSelect = (market: Market) => {
    setSelectedMarket(market);
    // Set default values based on market constraints
    const leadTimeDays = secondsToDays(market.windowRules.minLeadTimeSecs);
    const defaultStartDate = addDays(startOfDay(new Date()), leadTimeDays);
    setShares('1');
    setCoverageStartDate(defaultStartDate);
    // Reset to V1 by default; V2 only available for Manila (market.id === 0)
    setPolicyVersion('V1');
    setV2DurationDays(2);
    setCurrentStep(2);
  };

  const handleRequestQuote = async () => {
    if (!selectedMarket || !isConnected) return;
    
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    setIsSubmitting(true);
    try {
      let requestId: number;
      
      if (policyVersion === 'V2' && isV2Available) {
        // V2 quote request for Manila with cumulative rainfall
        requestId = await api.requestQuoteV2(keypair, {
          marketId: selectedMarket.id,
          coverageStart,
          coverageEnd,
          latitude: selectedMarket.centerLatitude,
          longitude: selectedMarket.centerLongitude,
          shares: sharesNum,
          durationDays: v2DurationDays,
        });
      } else {
        // V1 quote request (24-hour rolling)
        requestId = await api.requestQuote(keypair, {
          marketId: selectedMarket.id,
          coverageStart,
          coverageEnd,
          latitude: selectedMarket.centerLatitude,
          longitude: selectedMarket.centerLongitude,
          shares: sharesNum,
        });
      }
      
      if (requestId < 0) {
        throw new Error('Failed to get quote ID from chain event');
      }
      
      setQuoteRequestId(requestId);
      setCurrentStep(3);
      toast.success('Quote requested! Calculating premium...');
      
      // Step 2: Simulate off-chain worker by submitting quote result
      // In production, the off-chain worker would do this automatically
      // For testing, we submit a mock probability (10% = 100,000 ppm)
      const mockProbabilityPpm = 100000; // 10% probability
      await api.submitQuote(keypair, requestId, mockProbabilityPpm);
      
      // Refresh quotes to get the result
      await refreshQuotes();
      toast.success('Quote calculated successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to request quote');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplyCoverage = async () => {
    if (!currentQuote?.result || !isConnected) return;
    
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    // Check if user has enough balance
    const premium = currentQuote.result.premiumUsdt;
    if (usdtBalance < premium) {
      toast.error(`Insufficient balance. Need ${formatUSDT(premium)}, have ${usdtFormatted}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const newPolicyId = await api.applyCoverage(keypair, currentQuote.id);
      setPolicyId(newPolicyId);
      setCurrentStep(4);
      toast.success('Coverage applied successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply coverage');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back to Policies
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Get Coverage</h1>
            <p className="text-text-secondary mt-1">Apply for rainfall insurance</p>
          </div>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to request insurance quotes and apply for coverage
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

  if (isDao) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back to Policies
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Get Coverage</h1>
            <p className="text-text-secondary mt-1">Apply for rainfall insurance</p>
          </div>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-warning" />
            <h3 className="text-lg font-semibold mb-2">DAO Admin Role</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              DAO Admin accounts cannot purchase coverage. Please switch to a Customer account to get insurance.
            </p>
            <Link href="/policies">
              <Button variant="secondary">Back to Policies</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/policies">
          <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Get Coverage</h1>
          <p className="text-text-secondary mt-1">Apply for parametric rainfall insurance</p>
        </div>
      </div>

      {/* Progress Steps */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    currentStep > step.id 
                      ? 'bg-success text-white' 
                      : currentStep === step.id 
                      ? 'bg-prmx-cyan text-white' 
                      : 'bg-background-tertiary text-text-secondary'
                  }`}>
                    {currentStep > step.id ? <Check className="w-4 h-4" /> : step.id}
                  </div>
                  <span className={`hidden sm:block text-sm ${
                    currentStep >= step.id ? 'text-text-primary' : 'text-text-tertiary'
                  }`}>
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-12 lg:w-24 h-0.5 mx-2 transition-colors ${
                    currentStep > step.id ? 'bg-success' : 'bg-background-tertiary'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step Content */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Select a Market</h2>
            <p className="text-text-secondary">Choose the region you want coverage for</p>
          </CardHeader>
          <CardContent>
            {marketsLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-text-tertiary" />
              </div>
            ) : markets.length === 0 ? (
              <div className="text-center py-8">
                <MapPin className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
                <p className="text-text-secondary">No markets available yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {markets.filter(m => m.status === 'Open').map((market) => (
                  <div
                    key={market.id}
                    onClick={() => handleMarketSelect(market)}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedMarket?.id === market.id
                        ? 'border-prmx-cyan bg-prmx-cyan/5'
                        : 'border-border-secondary hover:border-prmx-cyan/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center">
                        <MapPin className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{market.name}</h4>
                          {/* V1/V2 badges - Manila (id=0) supports V2 */}
                          {market.id === 0 ? (
                            <div className="flex gap-1">
                              <Badge variant="default" className="text-xs px-1.5 py-0.5">V1</Badge>
                              <Badge variant="purple" className="text-xs px-1.5 py-0.5">V2</Badge>
                            </div>
                          ) : (
                            <Badge variant="default" className="text-xs px-1.5 py-0.5">V1</Badge>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary">
                          {formatCoordinates(market.centerLatitude, market.centerLongitude)}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Strike</span>
                        <span>{market.strikeValue} mm</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Duration</span>
                        {market.id === 0 ? (
                          <span className="text-prmx-purple font-medium">24h or 2-7d</span>
                        ) : (
                          <span className="text-prmx-cyan font-medium">24 hours</span>
                        )}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Lead time</span>
                        <span>≥{secondsToDays(market.windowRules.minLeadTimeSecs)} days</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === 2 && selectedMarket && (
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Coverage Details</h2>
            <p className="text-text-secondary">Configure your insurance parameters</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Selected Market Summary */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-prmx-gradient flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold">{selectedMarket.name}</h4>
                  <p className="text-sm text-text-secondary">Strike: {selectedMarket.strikeValue} mm</p>
                </div>
              </div>
            </div>

            {/* V1/V2 Version Selector (only for Manila) */}
            {isV2Available && (
              <div className="p-4 rounded-xl bg-prmx-purple/5 border border-prmx-purple/20">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-prmx-purple" />
                  Policy Version
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPolicyVersion('V1')}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      policyVersion === 'V1'
                        ? 'border-prmx-cyan bg-prmx-cyan/5'
                        : 'border-border-secondary hover:border-prmx-cyan/50'
                    }`}
                  >
                    <div className="font-semibold mb-1">V1 - Standard</div>
                    <p className="text-sm text-text-secondary">
                      24-hour rolling rainfall trigger. Fixed 1-day coverage window.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPolicyVersion('V2')}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      policyVersion === 'V2'
                        ? 'border-prmx-purple bg-prmx-purple/5'
                        : 'border-border-secondary hover:border-prmx-purple/50'
                    }`}
                  >
                    <div className="font-semibold mb-1 flex items-center gap-2">
                      V2 - Cumulative
                      <Badge variant="purple">NEW</Badge>
                    </div>
                    <p className="text-sm text-text-secondary">
                      Cumulative rainfall trigger. 2-7 day window with early trigger.
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* Coverage Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Number of Shares"
                type="number"
                min="1"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                hint={`$100 payout per share (max: $${maxPayout})`}
              />
              <DatePicker
                label="Coverage Start Date"
                value={coverageStartDate}
                onChange={setCoverageStartDate}
                minDate={minStartDate}
                placeholder="Select start date"
                hint={minLeadTimeDays > 0 
                  ? `Minimum ${minLeadTimeDays} day${minLeadTimeDays > 1 ? 's' : ''} lead time required`
                  : 'Select when coverage begins'
                }
              />
              {policyVersion === 'V2' && isV2Available ? (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Coverage Duration
                  </label>
                  <select
                    className="select-field w-full"
                    value={v2DurationDays}
                    onChange={(e) => setV2DurationDays(Number(e.target.value))}
                  >
                    {[2, 3, 4, 5, 6, 7].map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-text-tertiary mt-1.5">
                    V2 policies support 2-7 day coverage windows
                  </p>
                </div>
              ) : (
                <Input
                  label="Coverage Duration"
                  type="text"
                  value="24 hours"
                  readOnly
                  hint="V1 policies use 24 hours coverage"
                />
              )}
            </div>

            {/* Summary */}
            <div className={`p-4 rounded-xl border ${
              policyVersion === 'V2' 
                ? 'bg-prmx-purple/5 border-prmx-purple/20' 
                : 'bg-prmx-cyan/5 border-prmx-cyan/20'
            }`}>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Info className={`w-4 h-4 ${policyVersion === 'V2' ? 'text-prmx-purple' : 'text-prmx-cyan'}`} />
                Coverage Summary
                {policyVersion === 'V2' && (
                  <Badge variant="purple">V2 Cumulative</Badge>
                )}
              </h4>
              <div className="space-y-3 text-sm">
                {/* Local Time Display */}
                <div className={`p-3 rounded-lg border ${
                  policyVersion === 'V2' 
                    ? 'bg-prmx-purple/10 border-prmx-purple/20' 
                    : 'bg-prmx-cyan/10 border-prmx-cyan/20'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className={`w-4 h-4 ${policyVersion === 'V2' ? 'text-prmx-purple' : 'text-prmx-cyan'}`} />
                    <span className={`font-medium ${policyVersion === 'V2' ? 'text-prmx-purple' : 'text-prmx-cyan'}`}>
                      {selectedMarket?.name} Local Time ({formatTimezoneOffset(marketTimezoneOffset)})
                    </span>
                  </div>
                  {policyVersion === 'V2' && isV2Available ? (
                    <div>
                      <p className="font-mono text-lg">
                        {coverageStartDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' — '}
                        {coverageStartDate && addDays(coverageStartDate, v2DurationDays - 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <p className="text-xs text-prmx-purple mt-1">
                        {v2DurationDays} days • Cumulative rainfall • Early trigger enabled
                      </p>
                    </div>
                  ) : (
                    <p className="font-mono text-lg">
                      {coverageStartDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} 
                      {' '}00:00 — 23:59
                    </p>
                  )}
                </div>
                
                {/* UTC Equivalent */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-text-secondary">Start (UTC)</span>
                    <p className="font-medium font-mono text-xs">{formatDateTimeUTC(coverageStart)}</p>
                </div>
                <div>
                    <span className="text-text-secondary">End (UTC)</span>
                    <p className="font-medium font-mono text-xs">{formatDateTimeUTC(coverageEnd)}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border-secondary">
                <div>
                  <span className="text-text-secondary">Total Shares</span>
                  <p className="font-medium">{sharesNum}</p>
                </div>
                <div>
                  <span className="text-text-secondary">Max Payout</span>
                  <p className="font-medium text-success">${maxPayout} USDT</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setCurrentStep(1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button onClick={handleRequestQuote} loading={isSubmitting} className="flex-1">
                Request Quote <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Quote Result</h2>
            <p className="text-text-secondary">
              {currentQuote?.result 
                ? 'Review your quote and apply for coverage'
                : 'Waiting for off-chain worker to calculate premium...'}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {!currentQuote?.result ? (
              <div className="text-center py-12">
                <RefreshCw className="w-12 h-12 mx-auto mb-4 animate-spin text-prmx-cyan" />
                <p className="text-text-secondary">
                  Processing your quote request...
                </p>
                <p className="text-xs text-text-tertiary mt-2">
                  The off-chain worker is calculating the premium using historical rainfall data
                </p>
              </div>
            ) : (
              <>
                {/* Quote Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-4 rounded-xl bg-background-tertiary/50 space-y-3">
                    <h4 className="font-semibold">Coverage Details</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Market</span>
                        <span>{selectedMarket?.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Shares</span>
                        <span>{currentQuote.shares}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Period ({formatTimezoneOffset(marketTimezoneOffset)})</span>
                        <span>00:00 — 23:59</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Max Payout</span>
                        <span className="text-success">{formatUSDT(BigInt(currentQuote.shares * 100_000_000))}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-prmx-gradient/10 border border-prmx-cyan/20 space-y-3">
                    <h4 className="font-semibold">Premium Quote</h4>
                    <div className="space-y-2">
                      <div className="text-3xl font-bold text-prmx-cyan">
                        {formatUSDT(currentQuote.result.premiumUsdt)}
                      </div>
                      <div className="text-sm text-text-secondary">
                        Fair Premium: {formatUSDT(currentQuote.result.fairPremiumUsdt)}
                      </div>
                      <div className="text-sm text-text-secondary">
                        Event Probability: {(Number(currentQuote.result.probabilityPercent) / 100).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Balance Check */}
                <div className={`p-4 rounded-xl border ${
                  usdtBalance >= currentQuote.result.premiumUsdt
                    ? 'bg-success/5 border-success/20'
                    : 'bg-error/5 border-error/20'
                }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-text-secondary">Your Balance</p>
                      <p className="font-semibold">{usdtFormatted}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-text-secondary">Premium Required</p>
                      <p className="font-semibold">{formatUSDT(currentQuote.result.premiumUsdt)}</p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => {
                    setCurrentStep(2);
                    setQuoteRequestId(null);
                    setCurrentQuote(null);
                  }}>
                    <ChevronLeft className="w-4 h-4 mr-1" /> Modify
                  </Button>
                  <Button 
                    onClick={handleApplyCoverage} 
                    loading={isSubmitting} 
                    disabled={usdtBalance < currentQuote.result.premiumUsdt}
                    className="flex-1"
                  >
                    Apply Coverage <Shield className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === 4 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Coverage Applied!</h2>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Your insurance policy has been created successfully. 
              Policy ID: <span className="text-prmx-cyan">#{policyId}</span>
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/policies">
                <Button variant="secondary">View All Policies</Button>
              </Link>
              <Link href={`/policies/${policyId}`}>
                <Button>View Policy Details</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
