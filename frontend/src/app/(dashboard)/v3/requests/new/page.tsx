'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft,
  MapPin,
  Calendar,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Info
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useWalletStore } from '@/stores/walletStore';
import { useV3Locations } from '@/hooks/useV3ChainData';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { createV3Request } from '@/lib/api-v3';
import { 
  V3_EVENT_TYPES, 
  V3EventType,
  V3ThresholdUnit,
  formatThresholdValue,
  getEventTypeInfo 
} from '@/types/v3';
import { formatUSDT, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

// Constants
const MIN_SHARES = 1;
const MAX_SHARES = 1000;
const MIN_PREMIUM_USDT = 1; // $1 minimum premium per share
const PAYOUT_PER_SHARE = BigInt(100_000_000); // $100 with 6 decimals
const USDT_DECIMALS = 6;

type FormStep = 'event' | 'coverage' | 'terms' | 'review';

export default function NewV3RequestPage() {
  const router = useRouter();
  const { isConnected, selectedAccount, getKeypair } = useWalletStore();
  const { locations, loading: locationsLoading } = useV3Locations();
  
  const [step, setStep] = useState<FormStep>('event');
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state
  const [eventType, setEventType] = useState<V3EventType>('PrecipSumGte');
  const [thresholdValue, setThresholdValue] = useState<number>(50000); // 50mm default
  // Early trigger is always enabled for V3 - payout immediately when threshold is met
  const earlyTrigger = true;
  const [locationId, setLocationId] = useState<number | null>(null);
  const [coverageStart, setCoverageStart] = useState<string>('');
  const [coverageEnd, setCoverageEnd] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [totalShares, setTotalShares] = useState<number>(10);
  const [premiumPerShare, setPremiumPerShare] = useState<number>(5); // $5 default
  
  const eventInfo = useMemo(() => getEventTypeInfo(eventType), [eventType]);
  
  // Calculate totals
  const totalPremium = useMemo(() => {
    return BigInt(Math.round(premiumPerShare * 10 ** USDT_DECIMALS)) * BigInt(totalShares);
  }, [premiumPerShare, totalShares]);
  
  const maxPayout = useMemo(() => {
    return PAYOUT_PER_SHARE * BigInt(totalShares);
  }, [totalShares]);
  
  // Validation
  const eventErrors = useMemo(() => {
    const errors: string[] = [];
    if (!eventInfo) errors.push('Please select an event type');
    if (eventInfo && (thresholdValue < eventInfo.minThreshold || thresholdValue > eventInfo.maxThreshold)) {
      errors.push(`Threshold must be between ${formatThresholdValue(eventInfo.minThreshold, eventInfo.unit as V3ThresholdUnit)} and ${formatThresholdValue(eventInfo.maxThreshold, eventInfo.unit as V3ThresholdUnit)}`);
    }
    return errors;
  }, [eventInfo, thresholdValue]);
  
  const coverageErrors = useMemo(() => {
    const errors: string[] = [];
    const now = Date.now();
    const startTs = new Date(coverageStart).getTime();
    const endTs = new Date(coverageEnd).getTime();
    
    if (!coverageStart) errors.push('Coverage start date is required');
    if (!coverageEnd) errors.push('Coverage end date is required');
    if (locationId === null) errors.push('Please select a location');
    if (startTs < now) errors.push('Coverage start must be in the future');
    if (endTs <= startTs) errors.push('Coverage end must be after start');
    if (coverageStart && coverageEnd && (endTs - startTs) > 30 * 24 * 60 * 60 * 1000) {
      errors.push('Coverage period cannot exceed 30 days');
    }
    return errors;
  }, [coverageStart, coverageEnd, locationId]);
  
  const termsErrors = useMemo(() => {
    const errors: string[] = [];
    const now = Date.now();
    const expiryTs = new Date(expiresAt).getTime();
    const startTs = new Date(coverageStart).getTime();
    
    if (!expiresAt) errors.push('Request expiry is required');
    if (expiryTs < now) errors.push('Expiry must be in the future');
    if (startTs && expiryTs >= startTs) errors.push('Expiry must be before coverage start');
    if (totalShares < MIN_SHARES || totalShares > MAX_SHARES) {
      errors.push(`Shares must be between ${MIN_SHARES} and ${MAX_SHARES}`);
    }
    if (premiumPerShare < MIN_PREMIUM_USDT) {
      errors.push(`Premium must be at least $${MIN_PREMIUM_USDT} per share`);
    }
    return errors;
  }, [expiresAt, coverageStart, totalShares, premiumPerShare]);
  
  const canProceed = useCallback(() => {
    switch (step) {
      case 'event': return eventErrors.length === 0;
      case 'coverage': return coverageErrors.length === 0;
      case 'terms': return termsErrors.length === 0;
      case 'review': return true;
    }
  }, [step, eventErrors, coverageErrors, termsErrors]);
  
  const handleSubmit = async () => {
    const keypair = getKeypair();
    if (!keypair || locationId === null) {
      toast.error('Wallet not connected or location not selected');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const requestId = await createV3Request(keypair, {
        locationId,
        eventSpec: {
          eventType,
          threshold: {
            value: thresholdValue,
            unit: eventInfo!.unit as V3ThresholdUnit,
          },
          earlyTrigger,
        },
        totalShares,
        premiumPerShare: BigInt(Math.round(premiumPerShare * 10 ** USDT_DECIMALS)),
        coverageStart: Math.floor(new Date(coverageStart).getTime() / 1000),
        coverageEnd: Math.floor(new Date(coverageEnd).getTime() / 1000),
        expiresAt: Math.floor(new Date(expiresAt).getTime() / 1000),
      });
      
      toast.success(`Request #${requestId} created successfully!`);
      router.push(`/v3/requests/${requestId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create request');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  if (!isConnected) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/v3/requests">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="purple" className="text-xs">V3 P2P</Badge>
            </div>
            <h1 className="text-3xl font-bold">Create Underwrite Request</h1>
          </div>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to create an underwrite request
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
  
  const selectedLocation = locations.find(l => l.id === locationId);
  
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/v3/requests">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
            Back
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
          </div>
          <h1 className="text-3xl font-bold">Create Underwrite Request</h1>
          <p className="text-text-secondary mt-1">Request weather protection coverage from underwriters</p>
        </div>
      </div>
      
      {/* Progress Steps */}
      <div className="flex items-center justify-between">
        {(['event', 'coverage', 'terms', 'review'] as FormStep[]).map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors",
              step === s 
                ? "bg-prmx-gradient text-white" 
                : (['event', 'coverage', 'terms', 'review'].indexOf(step) > i)
                  ? "bg-success text-white"
                  : "bg-background-tertiary text-text-tertiary"
            )}>
              {(['event', 'coverage', 'terms', 'review'].indexOf(step) > i) ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                i + 1
              )}
            </div>
            <span className={cn(
              "ml-2 font-medium capitalize",
              step === s ? "text-text-primary" : "text-text-tertiary"
            )}>
              {s}
            </span>
            {i < 3 && (
              <div className={cn(
                "w-16 h-0.5 mx-4",
                (['event', 'coverage', 'terms', 'review'].indexOf(step) > i)
                  ? "bg-success"
                  : "bg-background-tertiary"
              )} />
            )}
          </div>
        ))}
      </div>
      
      {/* Form Content */}
      <Card>
        <CardContent className="p-8">
          {/* Step 1: Event Selection */}
          {step === 'event' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">Select Weather Event</h3>
                <p className="text-text-secondary">Choose the weather event you want protection against</p>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {V3_EVENT_TYPES.map((event) => (
                  <button
                    key={event.type}
                    onClick={() => {
                      setEventType(event.type);
                      setThresholdValue(event.defaultThreshold);
                    }}
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all text-left",
                      eventType === event.type
                        ? "border-prmx-cyan bg-prmx-cyan/10"
                        : "border-border-primary hover:border-border-primary/50 hover:bg-background-tertiary/50"
                    )}
                  >
                    <div className="text-3xl mb-2">{event.icon}</div>
                    <h4 className="font-medium">{event.label}</h4>
                    <p className="text-xs text-text-secondary mt-1">{event.description}</p>
                  </button>
                ))}
              </div>
              
              {eventInfo && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Threshold ({eventInfo.unitLabel})
                    </label>
                    <div className="flex items-center gap-4">
                      <Input
                        type="number"
                        value={thresholdValue / 1000}
                        onChange={(e) => setThresholdValue(Math.round(parseFloat(e.target.value) * 1000))}
                        className="max-w-xs"
                        min={eventInfo.minThreshold / 1000}
                        max={eventInfo.maxThreshold / 1000}
                        step={0.1}
                      />
                      <span className="text-text-secondary">{eventInfo.unitLabel}</span>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                      Range: {formatThresholdValue(eventInfo.minThreshold, eventInfo.unit as V3ThresholdUnit)} - {formatThresholdValue(eventInfo.maxThreshold, eventInfo.unit as V3ThresholdUnit)}
                    </p>
                  </div>
                </div>
              )}
              
              {eventErrors.length > 0 && (
                <div className="p-4 rounded-lg bg-error/10 border border-error/30">
                  {eventErrors.map((error, i) => (
                    <p key={i} className="text-sm text-error flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> {error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Step 2: Coverage Details */}
          {step === 'coverage' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">Coverage Details</h3>
                <p className="text-text-secondary">Select location and coverage period</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  <MapPin className="w-4 h-4 inline mr-1" /> Location
                </label>
                {locationsLoading ? (
                  <div className="h-12 bg-background-tertiary/50 rounded-xl animate-pulse" />
                ) : (
                  <select
                    value={locationId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLocationId(val ? parseInt(val, 10) : null);
                    }}
                    className="select-field w-full"
                  >
                    <option value="">Select a location...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Calendar className="w-4 h-4 inline mr-1" /> Coverage Start
                  </label>
                  <Input
                    type="datetime-local"
                    value={coverageStart}
                    onChange={(e) => setCoverageStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Calendar className="w-4 h-4 inline mr-1" /> Coverage End
                  </label>
                  <Input
                    type="datetime-local"
                    value={coverageEnd}
                    onChange={(e) => setCoverageEnd(e.target.value)}
                    min={coverageStart}
                  />
                </div>
              </div>
              
              {coverageErrors.length > 0 && (
                <div className="p-4 rounded-lg bg-error/10 border border-error/30 space-y-1">
                  {coverageErrors.map((error, i) => (
                    <p key={i} className="text-sm text-error flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> {error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Step 3: Terms */}
          {step === 'terms' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">Request Terms</h3>
                <p className="text-text-secondary">Set shares, premium, and expiry</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Total Shares
                  </label>
                  <Input
                    type="number"
                    value={totalShares}
                    onChange={(e) => setTotalShares(parseInt(e.target.value) || 1)}
                    min={MIN_SHARES}
                    max={MAX_SHARES}
                  />
                  <p className="text-xs text-text-tertiary mt-1">
                    Each share = $100 payout if event occurs
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <DollarSign className="w-4 h-4 inline mr-1" /> Premium Per Share (USDT)
                  </label>
                  <Input
                    type="number"
                    value={premiumPerShare}
                    onChange={(e) => setPremiumPerShare(parseFloat(e.target.value) || 1)}
                    min={MIN_PREMIUM_USDT}
                    step={0.5}
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  <Calendar className="w-4 h-4 inline mr-1" /> Request Expires At
                </label>
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  max={coverageStart}
                />
                <p className="text-xs text-text-tertiary mt-1">
                  Underwriters must accept before this time. Must be before coverage starts.
                </p>
              </div>
              
              <div className="p-4 rounded-lg bg-prmx-cyan/10 border border-prmx-cyan/30">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-prmx-cyan mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-prmx-cyan">Premium Escrow</p>
                    <p className="text-text-secondary mt-1">
                      Your total premium of <strong>{formatUSDT(totalPremium)}</strong> will be held in escrow.
                      It will be transferred to underwriters when they accept, or returned if the request expires.
                    </p>
                  </div>
                </div>
              </div>
              
              {termsErrors.length > 0 && (
                <div className="p-4 rounded-lg bg-error/10 border border-error/30 space-y-1">
                  {termsErrors.map((error, i) => (
                    <p key={i} className="text-sm text-error flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> {error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Step 4: Review */}
          {step === 'review' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">Review Your Request</h3>
                <p className="text-text-secondary">Confirm details before submitting</p>
              </div>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-medium text-text-secondary uppercase text-sm tracking-wide">Event Details</h4>
                  <div className="p-4 rounded-lg bg-background-tertiary/50 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{eventInfo?.icon}</span>
                      <div>
                        <p className="font-medium">{eventInfo?.label}</p>
                        <p className="text-sm text-text-secondary">
                          Threshold: {formatThresholdValue(thresholdValue, eventInfo?.unit as V3ThresholdUnit)}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <h4 className="font-medium text-text-secondary uppercase text-sm tracking-wide">Location</h4>
                  <div className="p-4 rounded-lg bg-background-tertiary/50">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-prmx-cyan" />
                      <span>{selectedLocation?.name || 'Unknown'}</span>
                    </div>
                  </div>
                  
                  <h4 className="font-medium text-text-secondary uppercase text-sm tracking-wide">Coverage Period</h4>
                  <div className="p-4 rounded-lg bg-background-tertiary/50 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Start</span>
                      <span>{new Date(coverageStart).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">End</span>
                      <span>{new Date(coverageEnd).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <h4 className="font-medium text-text-secondary uppercase text-sm tracking-wide">Financial Terms</h4>
                  <div className="p-4 rounded-lg bg-background-tertiary/50 space-y-3">
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Total Shares</span>
                      <span className="font-medium">{totalShares}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Premium/Share</span>
                      <span className="font-medium">{formatUSDT(BigInt(Math.round(premiumPerShare * 10 ** USDT_DECIMALS)))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Payout/Share</span>
                      <span className="font-medium">{formatUSDT(PAYOUT_PER_SHARE)}</span>
                    </div>
                    <hr className="border-border-primary" />
                    <div className="flex justify-between text-lg">
                      <span className="font-medium">Total Premium</span>
                      <span className="font-bold text-success">{formatUSDT(totalPremium)}</span>
                    </div>
                    <div className="flex justify-between text-lg">
                      <span className="font-medium">Max Payout</span>
                      <span className="font-bold text-prmx-cyan">{formatUSDT(maxPayout)}</span>
                    </div>
                  </div>
                  
                  <h4 className="font-medium text-text-secondary uppercase text-sm tracking-wide">Request Expiry</h4>
                  <div className="p-4 rounded-lg bg-background-tertiary/50">
                    <span>{new Date(expiresAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              
              <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-warning">Confirm Transaction</p>
                    <p className="text-text-secondary mt-1">
                      By clicking &quot;Create Request&quot;, you will deposit <strong>{formatUSDT(totalPremium)}</strong> USDT into escrow.
                      This amount will be transferred to underwriters when they accept your request.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-border-primary">
            <Button
              variant="secondary"
              onClick={() => {
                const steps: FormStep[] = ['event', 'coverage', 'terms', 'review'];
                const currentIndex = steps.indexOf(step);
                if (currentIndex > 0) setStep(steps[currentIndex - 1]);
              }}
              disabled={step === 'event'}
            >
              Back
            </Button>
            
            {step === 'review' ? (
              <Button
                onClick={handleSubmit}
                loading={isSubmitting}
                disabled={!canProceed()}
              >
                Create Request
              </Button>
            ) : (
              <Button
                onClick={() => {
                  const steps: FormStep[] = ['event', 'coverage', 'terms', 'review'];
                  const currentIndex = steps.indexOf(step);
                  if (currentIndex < steps.length - 1) setStep(steps[currentIndex + 1]);
                }}
                disabled={!canProceed()}
              >
                Continue
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

