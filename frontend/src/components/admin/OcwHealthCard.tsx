'use client';

import { Activity, RefreshCw, Clock, Shield, FileText, Database as DatabaseIcon } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ServiceStatusGrid } from './ServiceStatusGrid';
import { cn } from '@/lib/utils';
import type { OcwHealthData } from '@/types/admin';

interface OcwHealthCardProps {
  healthData: OcwHealthData | null;
  loading?: boolean;
}

export function OcwHealthCard({ healthData, loading }: OcwHealthCardProps) {
  if (loading || !healthData) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5" />
            OCW Health Status
          </h3>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-32 bg-background-tertiary/50 rounded" />
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 bg-background-tertiary/50 rounded" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = () => {
    switch (healthData.overall_status) {
      case 'healthy':
        return <Badge variant="success" className="text-sm px-3 py-1">Healthy</Badge>;
      case 'degraded':
        return <Badge variant="warning" className="text-sm px-3 py-1">Degraded</Badge>;
      case 'down':
        return <Badge variant="error" className="text-sm px-3 py-1">Down</Badge>;
    }
  };

  const getStatusReason = () => {
    const { overall_status, services, metrics, timestamp } = healthData;
    const now = Math.floor(Date.now() / 1000);
    
    if (overall_status === 'healthy') {
      return null;
    }
    
    if (overall_status === 'down') {
      const offlineServices = Object.entries(services)
        .filter(([_, service]) => service.status === 'offline')
        .map(([name, _]) => name.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()));
      
      if (offlineServices.length > 0) {
        return `${offlineServices.join(', ')} ${offlineServices.length === 1 ? 'is' : 'are'} offline`;
      }
      return 'All services are offline';
    }
    
    // degraded status
    const onlineCount = Object.values(services).filter(s => s.status === 'online').length;
    const hoursSinceLastOp = metrics.last_successful_operation > 0 
      ? (now - metrics.last_successful_operation) / 3600 
      : Infinity;
    
    const reasons: string[] = [];
    
    if (onlineCount < 4) {
      const offlineServices = Object.entries(services)
        .filter(([_, service]) => service.status === 'offline')
        .map(([name, _]) => name.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()));
      reasons.push(`${offlineServices.join(', ')} ${offlineServices.length === 1 ? 'is' : 'are'} offline`);
    }
    
    if (hoursSinceLastOp >= 1) {
      if (hoursSinceLastOp < 24) {
        reasons.push(`No activity in the last ${Math.floor(hoursSinceLastOp)} hours`);
      } else {
        reasons.push(`No activity in the last ${Math.floor(hoursSinceLastOp / 24)} days`);
      }
    }
    
    return reasons.length > 0 ? reasons.join(' • ') : 'Service degraded';
  };

  const formatTimestamp = (timestamp: number) => {
    if (timestamp === 0) return 'Never';
    const date = new Date(timestamp * 1000);
    const now = Date.now();
    const diff = now - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-prmx-cyan" />
              <h3 className="text-lg font-semibold">OCW Health Status</h3>
            </div>
            {getStatusBadge()}
          </div>
          {getStatusReason() && (
            <p className="text-sm text-text-secondary flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" />
              {getStatusReason()}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Service Status Grid */}
        <ServiceStatusGrid services={healthData.services} />

        {/* Activity Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-background-tertiary/50">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-text-tertiary" />
              <p className="text-xs text-text-secondary">Policies Monitored</p>
            </div>
            <p className="text-2xl font-bold">{healthData.metrics.policies_monitored}</p>
          </div>

          <div className="p-4 rounded-lg bg-background-tertiary/50">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-text-tertiary" />
              <p className="text-xs text-text-secondary">Snapshots (24h)</p>
            </div>
            <p className="text-2xl font-bold">{healthData.metrics.snapshots_last_24h}</p>
          </div>

          <div className="p-4 rounded-lg bg-background-tertiary/50">
            <div className="flex items-center gap-2 mb-2">
              <DatabaseIcon className="w-4 h-4 text-text-tertiary" />
              <p className="text-xs text-text-secondary">Observations (24h)</p>
            </div>
            <p className="text-2xl font-bold">{healthData.metrics.observations_last_24h}</p>
          </div>

          <div className="p-4 rounded-lg bg-background-tertiary/50">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-text-tertiary" />
              <p className="text-xs text-text-secondary">Last Operation</p>
            </div>
            <p className="text-sm font-medium">
              {formatTimestamp(healthData.metrics.last_successful_operation)}
            </p>
          </div>
        </div>

        {/* Last Updated */}
        <div className="flex items-center justify-end gap-2 text-xs text-text-tertiary">
          <RefreshCw className="w-3 h-3" />
          <span>Auto-refreshing every 30s • Last updated: {formatTimestamp(healthData.timestamp)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

