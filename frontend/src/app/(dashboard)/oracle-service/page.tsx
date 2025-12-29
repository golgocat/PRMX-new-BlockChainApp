'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Activity, 
  RefreshCw, 
  Zap,
  Clock,
  CheckCircle2,
  AlertTriangle,
  CloudRain,
  Shield,
  ExternalLink,
  Wifi,
  WifiOff,
  List,
  ChevronUp,
  ChevronDown,
  Droplets,
  Code,
  Copy,
  Plus
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Modal } from '@/components/ui/Modal';
import { SkeletonMonitorCard, SkeletonStatsCard } from '@/components/ui/Skeleton';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { V2Monitor, V2MonitorStats, Policy } from '@/types';

export default function OracleV2Page() {
  const [monitors, setMonitors] = useState<V2Monitor[]>([]);
  const [stats, setStats] = useState<V2MonitorStats | null>(null);
  const [policies, setPolicies] = useState<Map<number, Policy>>(new Map());
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serviceHealthy, setServiceHealthy] = useState<boolean | null>(null);
  
  // State for expanded hourly readings
  const [expandedMonitors, setExpandedMonitors] = useState<Set<string>>(new Set());
  const [bucketData, setBucketData] = useState<Map<string, api.V2Bucket[]>>(new Map());
  const [loadingBuckets, setLoadingBuckets] = useState<Set<string>>(new Set());
  
  // State for raw data modal
  const [selectedBucket, setSelectedBucket] = useState<api.V2Bucket | null>(null);
  const [showRawDataModal, setShowRawDataModal] = useState(false);
  
  // State for backfilling
  const [backfillingMonitors, setBackfillingMonitors] = useState<Set<string>>(new Set());
  
  // Backfill missing hourly buckets for a monitor
  const handleBackfill = async (monitorId: string) => {
    setBackfillingMonitors(prev => new Set(prev).add(monitorId));
    try {
      const result = await api.backfillV2MonitorBuckets(monitorId);
      if (result.success) {
        toast.success(`Backfilled ${result.backfilled_buckets} missing hours`);
        // Refresh bucket data
        const buckets = await api.getV2MonitorBuckets(monitorId);
        setBucketData(prev => new Map(prev).set(monitorId, buckets));
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error('Failed to backfill missing data');
      console.error('Backfill error:', err);
    } finally {
      setBackfillingMonitors(prev => {
        const next = new Set(prev);
        next.delete(monitorId);
        return next;
      });
    }
  };
  
  // Toggle monitor expansion and fetch bucket data
  const toggleMonitorExpanded = async (monitorId: string) => {
    const newExpanded = new Set(expandedMonitors);
    
    if (newExpanded.has(monitorId)) {
      newExpanded.delete(monitorId);
    } else {
      newExpanded.add(monitorId);
      
      // Fetch bucket data if not already loaded
      if (!bucketData.has(monitorId)) {
        setLoadingBuckets(prev => new Set(prev).add(monitorId));
        try {
          const buckets = await api.getV2MonitorBuckets(monitorId);
          setBucketData(prev => new Map(prev).set(monitorId, buckets));
        } catch (err) {
          console.error('Failed to fetch buckets for', monitorId, err);
        } finally {
          setLoadingBuckets(prev => {
            const next = new Set(prev);
            next.delete(monitorId);
            return next;
          });
        }
      }
    }
    
    setExpandedMonitors(newExpanded);
  };

  const fetchData = async () => {
    // Check health independently - don't let other API failures affect this
    try {
      const health = await api.checkV2OracleHealth();
      setServiceHealthy(health);
    } catch (err) {
      console.error('Health check failed:', err);
      setServiceHealthy(false);
    }
    
    // Fetch data - failures here shouldn't affect health status
    try {
      const [monitorsData, statsData, policiesData] = await Promise.all([
        api.getV2Monitors(),
        api.getV2MonitorStats(),
        api.getPolicies(),
      ]);
      setMonitors(monitorsData);
      
      // Create policy lookup map
      const policyMap = new Map<number, Policy>();
      policiesData.forEach(p => policyMap.set(p.id, p));
      setPolicies(policyMap);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to fetch V2 oracle data:', err);
      // Don't set serviceHealthy to false here - health check is separate
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchData();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getStateBadge = (state: V2Monitor['state']) => {
    switch (state) {
      case 'monitoring':
        return <Badge variant="cyan" className="text-xs"><Activity className="w-3 h-3 mr-1" />Monitoring</Badge>;
      case 'triggered':
        return <Badge variant="success" className="text-xs"><Zap className="w-3 h-3 mr-1" />Triggered</Badge>;
      case 'matured':
        return <Badge variant="warning" className="text-xs"><Clock className="w-3 h-3 mr-1" />Matured</Badge>;
      case 'reported':
        return <Badge variant="default" className="text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />Reported</Badge>;
      default:
        return <Badge variant="default" className="text-xs">{state}</Badge>;
    }
  };

  // Helper to get UTC offset string (e.g., "UTC+9" for Tokyo)
  const getUtcOffsetString = () => {
    const offsetMinutes = new Date().getTimezoneOffset();
    const offsetHours = -offsetMinutes / 60; // Negate because getTimezoneOffset returns opposite sign
    const sign = offsetHours >= 0 ? '+' : '';
    return `UTC${sign}${offsetHours}`;
  };

  const formatDate = (timestamp: number, includeTimezone = true) => {
    if (!timestamp || timestamp === 0) return 'N/A';
    const dateStr = new Date(timestamp * 1000).toLocaleString();
    return includeTimezone ? `${dateStr} (${getUtcOffsetString()})` : dateStr;
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            V2 Oracle Monitors
            {serviceHealthy !== null && (
              serviceHealthy ? (
                <span className="flex items-center gap-1 text-sm font-normal text-success">
                  <Wifi className="w-4 h-4" />
                  Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm font-normal text-error">
                  <WifiOff className="w-4 h-4" />
                  Offline
                </span>
              )
            )}
          </h1>
          <p className="text-text-secondary mt-1">
            Cumulative rainfall tracking for V2 policies (Manila)
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw className={cn('w-4 h-4 transition-transform', isRefreshing && 'animate-spin')} />}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Monitors"
            value={stats.total}
            icon={<Shield className="w-5 h-5" />}
          />
          <StatCard
            title="Active Monitoring"
            value={stats.monitoring}
            icon={<Activity className="w-5 h-5" />}
            iconColor="bg-prmx-cyan/10 text-prmx-cyan"
          />
          <StatCard
            title="Triggered"
            value={stats.triggered}
            icon={<Zap className="w-5 h-5" />}
            iconColor="bg-success/10 text-success"
          />
          <StatCard
            title="Reported"
            value={stats.reported}
            icon={<CheckCircle2 className="w-5 h-5" />}
            iconColor="bg-prmx-purple/10 text-prmx-purple"
          />
        </div>
      )}

      {/* Info Card */}
      <Card className="bg-gradient-to-r from-prmx-purple/5 to-prmx-cyan/5 border-prmx-purple/20">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-prmx-gradient flex items-center justify-center flex-shrink-0">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">V2 Oracle Service</h3>
              <p className="text-text-secondary mb-4">
                V2 policies use cumulative rainfall tracking with early trigger support. 
                The off-chain oracle fetches AccuWeather data and automatically reports 
                when the threshold is reached or coverage ends.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-text-tertiary">Market</span>
                  <p className="font-medium">Manila Only</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Duration</span>
                  <p className="font-medium">2-7 Days</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Event Type</span>
                  <p className="font-medium">Cumulative Rainfall</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Early Trigger</span>
                  <p className="font-medium text-success">Enabled</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Monitors */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-prmx-cyan" />
              Active Monitors
            </h2>
            <Badge variant="cyan">{monitors.filter(m => m.state === 'monitoring').length} Monitoring</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4 transition-fade-in">
              {[1, 2, 3].map((i) => (
                <SkeletonMonitorCard key={i} />
              ))}
            </div>
          ) : !serviceHealthy ? (
            <div className="py-12 text-center">
              <WifiOff className="w-12 h-12 mx-auto mb-3 text-error" />
              <h3 className="font-semibold mb-1 text-error">Oracle Service Unavailable</h3>
              <p className="text-text-secondary text-sm">
                The Oracle service is not running. Start it with: <code className="px-2 py-1 bg-background-tertiary rounded">npm start</code> in offchain-oracle-service/
              </p>
            </div>
          ) : monitors.filter(m => m.state === 'monitoring').length === 0 ? (
            <div className="py-12 text-center">
              <Activity className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
              <h3 className="font-semibold mb-1">No Active Monitors</h3>
              <p className="text-text-secondary text-sm">
                No policies are currently being monitored
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {monitors.filter(m => m.state === 'monitoring').map((monitor) => {
                const progressPercent = Math.min(100, (monitor.cumulative_mm / monitor.strike_mm) * 100);
                const isNearThreshold = progressPercent >= 75;
                const isTriggered = monitor.cumulative_mm >= monitor.strike_mm;
                const policy = policies.get(monitor.policy_id);
                const policyLabel = policy?.label || `policy-${monitor.policy_id}`;
                
                return (
                  <div 
                    key={monitor._id}
                    className={cn(
                      "p-4 rounded-xl border transition-all",
                      isTriggered 
                        ? "border-success/30 bg-success/5" 
                        : isNearThreshold 
                          ? "border-warning/30 bg-warning/5"
                          : "border-border-secondary bg-background-tertiary/30"
                    )}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          isTriggered ? "bg-success/20" : "bg-prmx-gradient"
                        )}>
                          {isTriggered ? (
                            <Zap className="w-5 h-5 text-success" />
                          ) : (
                            <CloudRain className="w-5 h-5 text-white" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{policyLabel}</h3>
                            {getStateBadge(monitor.state)}
                          </div>
                          <p className="text-xs text-text-tertiary">
                            Policy ID: #{monitor.policy_id} • Monitor: {monitor._id}
                          </p>
                        </div>
                      </div>
                      <Link href={`/policies/${monitor.policy_id}`}>
                        <Button variant="ghost" size="sm" icon={<ExternalLink className="w-4 h-4" />}>
                          View Policy
                        </Button>
                      </Link>
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-text-secondary">Cumulative Rainfall</span>
                        <span className={cn(
                          "font-mono font-semibold",
                          isTriggered ? "text-success" : isNearThreshold ? "text-warning" : "text-prmx-cyan"
                        )}>
                          {(monitor.cumulative_mm / 10).toFixed(1)} / {(monitor.strike_mm / 10).toFixed(1)} mm
                        </span>
                      </div>
                      <div className="h-3 bg-background-secondary rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            isTriggered ? "bg-success" : isNearThreshold ? "bg-warning" : "bg-prmx-cyan"
                          )}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-text-tertiary mt-1">
                        <span>0 mm</span>
                        <span>{progressPercent.toFixed(0)}% of threshold</span>
                        <span>{(monitor.strike_mm / 10).toFixed(1)} mm</span>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-text-tertiary">Coverage Start</span>
                        <p className="font-medium">{formatDate(monitor.coverage_start)}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Coverage End</span>
                        <p className="font-medium">{formatDate(monitor.coverage_end)}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Last Fetch</span>
                        <p className="font-medium">
                          {monitor.last_fetch_at > 0 
                            ? `${new Date(monitor.last_fetch_at * 1000).toLocaleTimeString()} (${getUtcOffsetString()})`
                            : 'Never'}
                        </p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Location Key</span>
                        <p className="font-mono text-xs">{monitor.location_key}</p>
                      </div>
                    </div>

                    {/* Report Info */}
                    {monitor.report_tx_hash && (
                      <div className="mt-4 pt-4 border-t border-border-secondary">
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="w-4 h-4 text-success" />
                          <span className="text-text-secondary">Report submitted:</span>
                          <code className="text-prmx-cyan truncate">{monitor.report_tx_hash}</code>
                        </div>
                      </div>
                    )}
                    
                    {/* Show Hourly Readings Button */}
                    <button
                      onClick={() => toggleMonitorExpanded(monitor._id)}
                      className="w-full flex items-center justify-center gap-2 py-3 mt-4 text-sm text-prmx-cyan hover:text-prmx-cyan/80 transition-colors border-t border-border-secondary"
                    >
                      <List className="w-4 h-4" />
                      {loadingBuckets.has(monitor._id) ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Loading...
                        </>
                      ) : expandedMonitors.has(monitor._id) ? (
                        <>
                          Hide Hourly Readings
                          <ChevronUp className="w-4 h-4" />
                        </>
                      ) : (
                        <>
                          Show Hourly Readings
                          {bucketData.get(monitor._id)?.length !== undefined && (
                            <span className="text-text-tertiary">({bucketData.get(monitor._id)?.length})</span>
                          )}
                          <ChevronDown className="w-4 h-4" />
                        </>
                      )}
                    </button>
                    
                    {/* Expanded Hourly Readings */}
                    {expandedMonitors.has(monitor._id) && (
                      <div className="pt-4 mt-2 border-t border-border-secondary">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold flex items-center gap-2">
                            <Droplets className="w-4 h-4 text-prmx-cyan" />
                            Raw Bucket Data (Hourly Readings)
                          </h4>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBackfill(monitor._id);
                            }}
                            disabled={backfillingMonitors.has(monitor._id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-prmx-purple/10 text-prmx-purple hover:bg-prmx-purple/20 transition-colors disabled:opacity-50"
                            title="Fill in missing hours with 0mm readings"
                          >
                            {backfillingMonitors.has(monitor._id) ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Backfilling...
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" />
                                Backfill Missing
                              </>
                            )}
                          </button>
                        </div>
                        
                        {loadingBuckets.has(monitor._id) ? (
                          <div className="flex items-center justify-center py-8">
                            <RefreshCw className="w-5 h-5 animate-spin text-prmx-cyan" />
                          </div>
                        ) : (bucketData.get(monitor._id)?.length || 0) > 0 ? (
                          <>
                            <div className="max-h-64 overflow-y-auto space-y-2">
                              {bucketData.get(monitor._id)?.map((bucket, idx) => {
                                const hourDate = new Date(bucket.hour_utc);
                                const rainfallMm = bucket.mm / 10; // Convert from scaled value
                                const hasRawData = !!bucket.raw_data;
                                
                                return (
                                  <div 
                                    key={bucket._id}
                                    onClick={() => {
                                      setSelectedBucket(bucket);
                                      setShowRawDataModal(true);
                                    }}
                                    className={cn(
                                      'flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-all hover:ring-1 hover:ring-prmx-cyan/50',
                                      idx === 0 
                                        ? 'bg-prmx-cyan/10 border border-prmx-cyan/30' 
                                        : 'bg-background-tertiary/30 hover:bg-background-tertiary/50'
                                    )}
                                    title="Click to view raw AccuWeather data"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-3 h-3 text-text-tertiary" />
                                      <span className="text-text-secondary">
                                        {hourDate.toLocaleTimeString([], { 
                                          hour: '2-digit', 
                                          minute: '2-digit',
                                          hour12: true 
                                        })}
                                      </span>
                                      <span className="text-text-tertiary text-xs">
                                        {hourDate.toLocaleDateString([], { 
                                          month: 'short', 
                                          day: 'numeric' 
                                        })}
                                      </span>
                                      <span className="text-prmx-cyan text-xs font-medium">
                                        ({getUtcOffsetString()})
                                      </span>
                                      {idx === 0 && (
                                        <Badge variant="cyan" className="text-xs ml-1">Latest</Badge>
                                      )}
                                      {bucket.backfilled && (
                                        <Badge variant="secondary" className="text-xs ml-1">Backfilled</Badge>
                                      )}
                                      {hasRawData && !bucket.backfilled && (
                                        <Code className="w-3 h-3 text-text-tertiary ml-1" />
                                      )}
                                    </div>
                                    <div className={cn(
                                      'font-mono font-semibold',
                                      rainfallMm > 0 ? 'text-prmx-cyan' : 'text-text-tertiary'
                                    )}>
                                      {rainfallMm.toFixed(1)} mm
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            
                            {/* Summary */}
                            <div className="mt-3 pt-3 border-t border-border-secondary flex items-center justify-between text-sm">
                              <span className="text-text-secondary">Total (Sum of readings)</span>
                              <span className="font-semibold text-prmx-cyan">
                                {(bucketData.get(monitor._id)?.reduce((sum, b) => sum + b.mm, 0) || 0) / 10} mm
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="text-center text-text-tertiary text-sm py-4">
                            No hourly readings available yet
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settled Monitors (Triggered or Matured) */}
      {!loading && serviceHealthy && monitors.filter(m => m.state !== 'monitoring').length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-success" />
                Settled Monitors
              </h2>
              <div className="flex items-center gap-2">
                <Badge variant="success">{monitors.filter(m => m.state === 'triggered').length} Triggered</Badge>
                <Badge variant="default">{monitors.filter(m => m.state === 'matured' || m.state === 'reported').length} Matured</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {monitors.filter(m => m.state !== 'monitoring').map((monitor) => {
                const progressPercent = Math.min(100, (monitor.cumulative_mm / monitor.strike_mm) * 100);
                const isTriggered = monitor.state === 'triggered';
                const policy = policies.get(monitor.policy_id);
                const policyLabel = policy?.label || `policy-${monitor.policy_id}`;
                
                return (
                  <div 
                    key={monitor._id}
                    className={cn(
                      "p-4 rounded-xl border transition-all",
                      isTriggered 
                        ? "border-success/30 bg-success/5" 
                        : "border-text-tertiary/30 bg-background-tertiary/20"
                    )}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          isTriggered ? "bg-success/20" : "bg-text-tertiary/20"
                        )}>
                          {isTriggered ? (
                            <Zap className="w-5 h-5 text-success" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5 text-text-tertiary" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{policyLabel}</h3>
                            {getStateBadge(monitor.state)}
                          </div>
                          <p className="text-xs text-text-tertiary">
                            Policy ID: #{monitor.policy_id} • Monitor: {monitor._id}
                          </p>
                        </div>
                      </div>
                      <Link href={`/policies/${monitor.policy_id}`}>
                        <Button variant="ghost" size="sm" icon={<ExternalLink className="w-4 h-4" />}>
                          View Policy
                        </Button>
                      </Link>
                    </div>

                    {/* Final Result */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-text-secondary">Final Cumulative Rainfall</span>
                        <span className={cn(
                          "font-mono font-semibold",
                          isTriggered ? "text-success" : "text-text-secondary"
                        )}>
                          {(monitor.cumulative_mm / 10).toFixed(1)} / {(monitor.strike_mm / 10).toFixed(1)} mm
                        </span>
                      </div>
                      <div className="h-3 bg-background-secondary rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            isTriggered ? "bg-success" : "bg-text-tertiary"
                          )}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-text-tertiary mt-1">
                        <span>0 mm</span>
                        <span className={isTriggered ? "text-success font-medium" : ""}>
                          {isTriggered ? '✓ Threshold Exceeded' : `${progressPercent.toFixed(0)}% (No Event)`}
                        </span>
                        <span>{(monitor.strike_mm / 10).toFixed(1)} mm</span>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-text-tertiary">Coverage Start</span>
                        <p className="font-medium">{formatDate(monitor.coverage_start)}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Coverage End</span>
                        <p className="font-medium">{formatDate(monitor.coverage_end)}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Trigger Time</span>
                        <p className="font-medium">
                          {monitor.trigger_time 
                            ? `${new Date(monitor.trigger_time * 1000).toLocaleString()} (${getUtcOffsetString()})`
                            : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Location Key</span>
                        <p className="font-mono text-xs">{monitor.location_key}</p>
                      </div>
                    </div>

                    {/* Report Info */}
                    {monitor.report_tx_hash && (
                      <div className="mt-4 pt-4 border-t border-border-secondary">
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="w-4 h-4 text-success" />
                          <span className="text-text-secondary">Report submitted:</span>
                          <code className="text-prmx-cyan truncate">{monitor.report_tx_hash}</code>
                        </div>
                      </div>
                    )}
                    
                    {/* Show Hourly Readings Button */}
                    <button
                      onClick={() => toggleMonitorExpanded(monitor._id)}
                      className="w-full flex items-center justify-center gap-2 py-3 mt-4 text-sm text-prmx-cyan hover:text-prmx-cyan/80 transition-colors border-t border-border-secondary"
                    >
                      <List className="w-4 h-4" />
                      {loadingBuckets.has(monitor._id) ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Loading...
                        </>
                      ) : expandedMonitors.has(monitor._id) ? (
                        <>
                          Hide Hourly Readings
                          <ChevronUp className="w-4 h-4" />
                        </>
                      ) : (
                        <>
                          Show Hourly Readings
                          {bucketData.get(monitor._id)?.length !== undefined && (
                            <span className="text-text-tertiary">({bucketData.get(monitor._id)?.length})</span>
                          )}
                          <ChevronDown className="w-4 h-4" />
                        </>
                      )}
                    </button>
                    
                    {/* Expanded Hourly Readings */}
                    {expandedMonitors.has(monitor._id) && (
                      <div className="pt-4 mt-2 border-t border-border-secondary">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold flex items-center gap-2">
                            <Droplets className="w-4 h-4 text-prmx-cyan" />
                            Raw Bucket Data (Hourly Readings)
                          </h4>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBackfill(monitor._id);
                            }}
                            disabled={backfillingMonitors.has(monitor._id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-prmx-purple/10 text-prmx-purple hover:bg-prmx-purple/20 transition-colors disabled:opacity-50"
                            title="Fill in missing hours with 0mm readings"
                          >
                            {backfillingMonitors.has(monitor._id) ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Backfilling...
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" />
                                Backfill Missing
                              </>
                            )}
                          </button>
                        </div>
                        
                        {loadingBuckets.has(monitor._id) ? (
                          <div className="flex items-center justify-center py-8">
                            <RefreshCw className="w-5 h-5 animate-spin text-prmx-cyan" />
                          </div>
                        ) : (bucketData.get(monitor._id)?.length || 0) > 0 ? (
                          <>
                            <div className="max-h-64 overflow-y-auto space-y-2">
                              {bucketData.get(monitor._id)?.map((bucket, idx) => {
                                const hourDate = new Date(bucket.hour_utc);
                                const rainfallMm = bucket.mm / 10;
                                const hasRawData = !!bucket.raw_data;
                                
                                return (
                                  <div 
                                    key={bucket._id}
                                    onClick={() => {
                                      setSelectedBucket(bucket);
                                      setShowRawDataModal(true);
                                    }}
                                    className={cn(
                                      'flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-all hover:ring-1 hover:ring-prmx-cyan/50',
                                      idx === 0 
                                        ? 'bg-prmx-cyan/10 border border-prmx-cyan/30' 
                                        : 'bg-background-tertiary/30 hover:bg-background-tertiary/50'
                                    )}
                                    title="Click to view raw AccuWeather data"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-3 h-3 text-text-tertiary" />
                                      <span className="text-text-secondary">
                                        {hourDate.toLocaleTimeString([], { 
                                          hour: '2-digit', 
                                          minute: '2-digit',
                                          hour12: true 
                                        })}
                                      </span>
                                      <span className="text-text-tertiary text-xs">
                                        {hourDate.toLocaleDateString([], { 
                                          month: 'short', 
                                          day: 'numeric' 
                                        })}
                                      </span>
                                      <span className="text-prmx-cyan text-xs font-medium">
                                        ({getUtcOffsetString()})
                                      </span>
                                      {idx === 0 && (
                                        <Badge variant="cyan" className="text-xs ml-1">Latest</Badge>
                                      )}
                                      {bucket.backfilled && (
                                        <Badge variant="secondary" className="text-xs ml-1">Backfilled</Badge>
                                      )}
                                      {hasRawData && !bucket.backfilled && (
                                        <Code className="w-3 h-3 text-text-tertiary ml-1" />
                                      )}
                                    </div>
                                    <div className={cn(
                                      'font-mono font-semibold',
                                      rainfallMm > 0 ? 'text-prmx-cyan' : 'text-text-tertiary'
                                    )}>
                                      {rainfallMm.toFixed(1)} mm
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            
                            {/* Summary */}
                            <div className="mt-3 pt-3 border-t border-border-secondary flex items-center justify-between text-sm">
                              <span className="text-text-secondary">Total (Sum of readings)</span>
                              <span className="font-semibold text-prmx-cyan">
                                {(bucketData.get(monitor._id)?.reduce((sum, b) => sum + b.mm, 0) || 0) / 10} mm
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="text-center text-text-tertiary text-sm py-4">
                            No hourly readings available
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Raw Data Modal */}
      <Modal
        isOpen={showRawDataModal}
        onClose={() => {
          setShowRawDataModal(false);
          setSelectedBucket(null);
        }}
        title="Raw AccuWeather Data"
        size="lg"
      >
        {selectedBucket && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="p-4 rounded-xl bg-prmx-cyan/10 border border-prmx-cyan/30">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-text-secondary">Bucket ID</span>
                  <p className="font-mono text-sm font-semibold">{selectedBucket._id}</p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">Rainfall (Display)</span>
                  <p className="font-mono font-semibold text-prmx-cyan">{(selectedBucket.mm / 10).toFixed(1)} mm</p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">Hour (UTC)</span>
                  <p className="font-mono text-sm">{selectedBucket.hour_utc}</p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">Local Time</span>
                  <p className="font-mono text-sm">{new Date(selectedBucket.hour_utc).toLocaleString()} <span className="text-prmx-cyan">({getUtcOffsetString()})</span></p>
                </div>
                {selectedBucket.fetched_at && (
                  <div className="col-span-2">
                    <span className="text-sm text-text-secondary">Fetched At</span>
                    <p className="font-mono text-sm">{new Date(selectedBucket.fetched_at).toLocaleString()} <span className="text-prmx-cyan">({getUtcOffsetString()})</span></p>
                  </div>
                )}
              </div>
            </div>

            {/* Precipitation Summary from Raw Data */}
            {selectedBucket.raw_data && (
              <div className="p-4 rounded-xl bg-prmx-purple/10 border border-prmx-purple/30">
                <div className="flex items-center gap-2 mb-3">
                  <Droplets className="w-4 h-4 text-prmx-purple" />
                  <span className="font-semibold">Precipitation Summary</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-text-tertiary">Past Hour</span>
                    <p className="font-mono font-semibold text-prmx-cyan">
                      {(selectedBucket.raw_data as Record<string, unknown>)?._extracted 
                        ? ((selectedBucket.raw_data as Record<string, { pastHourMm?: number }>)?._extracted?.pastHourMm || 0)
                        : (selectedBucket.mm / 10)} mm
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Past 3 Hours</span>
                    <p className="font-mono font-semibold">
                      {((selectedBucket.raw_data as Record<string, { past3HoursMm?: number }>)?._extracted?.past3HoursMm || 0)} mm
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Past 6 Hours</span>
                    <p className="font-mono font-semibold">
                      {((selectedBucket.raw_data as Record<string, { past6HoursMm?: number }>)?._extracted?.past6HoursMm || 0)} mm
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Past 12 Hours</span>
                    <p className="font-mono font-semibold">
                      {((selectedBucket.raw_data as Record<string, { past12HoursMm?: number }>)?._extracted?.past12HoursMm || 0)} mm
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Past 24 Hours</span>
                    <p className="font-mono font-semibold">
                      {((selectedBucket.raw_data as Record<string, { past24HoursMm?: number }>)?._extracted?.past24HoursMm || 0)} mm
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Weather Info */}
            {selectedBucket.raw_data && (
              <div className="p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary">
                <div className="flex items-center gap-2 mb-3">
                  <CloudRain className="w-4 h-4 text-text-secondary" />
                  <span className="font-semibold">Weather Conditions</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-text-tertiary">Weather</span>
                    <p className="font-medium">{(selectedBucket.raw_data as Record<string, string>)?.WeatherText || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Has Precipitation</span>
                    <p className="font-medium">
                      {(selectedBucket.raw_data as Record<string, boolean>)?.HasPrecipitation ? 'Yes' : 'No'}
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Temperature</span>
                    <p className="font-medium">
                      {((selectedBucket.raw_data as Record<string, { Metric?: { Value?: number } }>)?.Temperature?.Metric?.Value || 'N/A')}°C
                    </p>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Humidity</span>
                    <p className="font-medium">
                      {(selectedBucket.raw_data as Record<string, number>)?.RelativeHumidity || 'N/A'}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Raw JSON Data */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-prmx-purple" />
                <span className="font-semibold">Raw AccuWeather Response</span>
              </div>
              {selectedBucket.raw_data ? (
                <pre className="p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary overflow-x-auto text-xs font-mono text-text-secondary max-h-64 overflow-y-auto">
                  {JSON.stringify(selectedBucket.raw_data, null, 2)}
                </pre>
              ) : (
                <div className="p-4 rounded-xl bg-warning/10 border border-warning/30 text-sm text-text-secondary">
                  <strong className="text-warning">Note:</strong> No raw data available for this bucket. 
                  This may be an older bucket created before raw data storage was enabled.
                </div>
              )}
            </div>

            {/* Note */}
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
              <p className="text-xs text-text-secondary">
                <strong className="text-warning">Note:</strong> The <code className="px-1 py-0.5 rounded bg-background-tertiary">mm</code> field 
                is stored in <strong>tenths of mm</strong> (e.g., 10 = 1.0mm). 
                The display value above shows the converted value.
              </p>
            </div>

            {/* Copy Button */}
            {selectedBucket.raw_data && (
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(selectedBucket.raw_data, null, 2));
                  toast.success('Raw data copied to clipboard!');
                }}
                className="w-full"
                icon={<Copy className="w-4 h-4" />}
              >
                Copy Raw JSON
              </Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

