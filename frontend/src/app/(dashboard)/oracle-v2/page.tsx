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
  WifiOff
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';
import type { V2Monitor, V2MonitorStats, Policy } from '@/types';

export default function OracleV2Page() {
  const [monitors, setMonitors] = useState<V2Monitor[]>([]);
  const [stats, setStats] = useState<V2MonitorStats | null>(null);
  const [policies, setPolicies] = useState<Map<number, Policy>>(new Map());
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serviceHealthy, setServiceHealthy] = useState<boolean | null>(null);

  const fetchData = async () => {
    try {
      const [monitorsData, statsData, health, policiesData] = await Promise.all([
        api.getV2Monitors(),
        api.getV2MonitorStats(),
        api.checkV2OracleHealth(),
        api.getPolicies(),
      ]);
      setMonitors(monitorsData);
      
      // Create policy lookup map
      const policyMap = new Map<number, Policy>();
      policiesData.forEach(p => policyMap.set(p.id, p));
      setPolicies(policyMap);
      setStats(statsData);
      setServiceHealthy(health);
    } catch (err) {
      console.error('Failed to fetch V2 oracle data:', err);
      setServiceHealthy(false);
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

  const formatDate = (timestamp: number) => {
    if (!timestamp || timestamp === 0) return 'N/A';
    return new Date(timestamp * 1000).toLocaleString();
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
          icon={<RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />}
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

      {/* Monitors List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Active Monitors</h2>
            <Badge variant="cyan">{monitors.length} Monitors</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-text-tertiary" />
              <p className="text-text-secondary mt-3">Loading monitors...</p>
            </div>
          ) : !serviceHealthy ? (
            <div className="py-12 text-center">
              <WifiOff className="w-12 h-12 mx-auto mb-3 text-error" />
              <h3 className="font-semibold mb-1 text-error">Oracle Service Unavailable</h3>
              <p className="text-text-secondary text-sm">
                The V2 Oracle service is not running. Start it with: <code className="px-2 py-1 bg-background-tertiary rounded">npm start</code> in oracle-v2/
              </p>
            </div>
          ) : monitors.length === 0 ? (
            <div className="py-12 text-center">
              <Activity className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
              <h3 className="font-semibold mb-1">No V2 Monitors</h3>
              <p className="text-text-secondary text-sm">
                Create a V2 policy to start monitoring cumulative rainfall
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {monitors.map((monitor) => {
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
                            ? new Date(monitor.last_fetch_at * 1000).toLocaleTimeString()
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
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

