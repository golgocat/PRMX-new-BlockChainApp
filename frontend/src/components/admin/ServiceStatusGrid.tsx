'use client';

import { CheckCircle2, XCircle, Database, Activity, Server, Link as LinkIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { ServiceHealth, OracleV2Health, OracleV3Health } from '@/types/admin';

interface ServiceStatusGridProps {
  services: {
    oracle_v2: OracleV2Health;
    oracle_v3: OracleV3Health;
    database: ServiceHealth;
    chain: ServiceHealth;
  };
}

export function ServiceStatusGrid({ services }: ServiceStatusGridProps) {
  const formatLastCheck = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = Date.now();
    const diff = now - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const ServiceCard = ({ 
    title, 
    service, 
    icon: Icon, 
    metric 
  }: { 
    title: string; 
    service: ServiceHealth; 
    icon: any;
    metric?: string | number;
  }) => {
    const isOnline = service.status === 'online';
    
    return (
      <Card className="bg-background-secondary/50">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon className={cn(
                "w-5 h-5",
                isOnline ? "text-success" : "text-error"
              )} />
              <h4 className="font-medium text-sm">{title}</h4>
            </div>
            {isOnline ? (
              <CheckCircle2 className="w-5 h-5 text-success" />
            ) : (
              <XCircle className="w-5 h-5 text-error" />
            )}
          </div>
          
          <div className="space-y-1">
            <Badge 
              variant={isOnline ? "success" : "error"} 
              className="text-xs"
            >
              {service.status === 'online' ? 'Online' : 'Offline'}
            </Badge>
            
            {metric && (
              <p className="text-xs text-text-secondary mt-2">
                {metric}
              </p>
            )}
            
            <p className="text-xs text-text-tertiary mt-1">
              Last checked: {formatLastCheck(service.last_check)}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <ServiceCard
        title="Oracle V2"
        service={services.oracle_v2}
        icon={Server}
        metric={services.oracle_v2.policies_monitored !== undefined 
          ? `${services.oracle_v2.policies_monitored} policies monitored`
          : undefined
        }
      />
      <ServiceCard
        title="Oracle V3"
        service={services.oracle_v3}
        icon={Activity}
        metric={
          services.oracle_v3.snapshots_24h !== undefined || services.oracle_v3.observations_24h !== undefined
            ? `${services.oracle_v3.snapshots_24h || 0} snapshots, ${services.oracle_v3.observations_24h || 0} obs (24h)`
            : undefined
        }
      />
      <ServiceCard
        title="Database"
        service={services.database}
        icon={Database}
      />
      <ServiceCard
        title="Chain"
        service={services.chain}
        icon={LinkIcon}
      />
    </div>
  );
}

