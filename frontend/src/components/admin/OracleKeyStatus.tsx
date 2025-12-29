'use client';

import { useState, useEffect } from 'react';
import { Key, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import * as apiAdmin from '@/lib/api-admin';

interface KeyStatus {
  v1: { configured: boolean; hasPending: boolean; rPricingUsingFallback?: boolean } | null;
  v2: { hasAuthorizedReporters: boolean; reporterCount: number } | null;
  v3: { hmacSecret: boolean; accuweatherKey: boolean; ingestUrl: boolean } | null;
}

export function OracleKeyStatus() {
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({
    v1: null,
    v2: null,
    v3: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkKeys = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [v1, v2, v3] = await Promise.allSettled([
        apiAdmin.checkV1OracleKey(),
        apiAdmin.checkV2OracleStatus(),
        apiAdmin.checkV3OracleSecrets(),
      ]);
      
      setKeyStatus({
        v1: v1.status === 'fulfilled' ? v1.value : null,
        v2: v2.status === 'fulfilled' ? v2.value : null,
        v3: v3.status === 'fulfilled' ? v3.value : null,
      });
      
      // Collect errors if any
      const errors = [v1, v2, v3]
        .filter(r => r.status === 'rejected')
        .map(r => r.status === 'rejected' ? r.reason : null)
        .filter(Boolean);
      
      if (errors.length > 0) {
        console.warn('Some key status checks failed:', errors);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check key status');
      console.error('Key status check error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkKeys();
    // Refresh every 30 seconds
    const interval = setInterval(checkKeys, 30000);
    return () => clearInterval(interval);
  }, []);

  const StatusRow = ({ 
    version, 
    label, 
    status 
  }: { 
    version: 'v1' | 'v2' | 'v3';
    label: string;
    status: any;
  }) => {
    if (loading && status === null) {
      return (
        <div className="flex items-center justify-between p-4 rounded-lg bg-background-tertiary/50">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
            <div>
              <p className="font-medium">{label}</p>
              <p className="text-sm text-text-secondary">Checking...</p>
            </div>
          </div>
        </div>
      );
    }

    let isConfigured = false;
    let details: string[] = [];

    if (version === 'v1' && status) {
      isConfigured = status.configured || status.hasPending;
      const detailsList: string[] = [];
      
      if (status.accuweatherConfigured) {
        detailsList.push('AccuWeather API');
      }
      if (status.rPricingConfigured) {
        // Show R Pricing API status with fallback indicator if applicable
        if (status.rPricingUsingFallback) {
          detailsList.push('R Pricing API (using fallback)');
        } else {
          detailsList.push('R Pricing API');
        }
      }
      if (status.hasPending) {
        detailsList.push('Pending key');
      }
      
      if (detailsList.length === 0) {
        detailsList.push('Not configured');
      }
      
      details = detailsList;
    } else if (version === 'v2' && status) {
      // V2 uses off-chain service - keys are in service env vars, not on-chain
      // If service is online, it's configured (service being online means it has keys and is working)
      isConfigured = status.serviceOnline;
      const detailsList: string[] = [];
      if (status.serviceOnline) {
        detailsList.push('service online');
        if (status.reporterCount > 0) {
          detailsList.push(`${status.reporterCount} authorized reporter${status.reporterCount > 1 ? 's' : ''}`);
        }
      } else {
        detailsList.push('service offline');
        if (status.reporterCount > 0) {
          detailsList.push(`${status.reporterCount} authorized reporter${status.reporterCount > 1 ? 's' : ''}`);
        }
      }
      details = detailsList;
    } else if (version === 'v3' && status) {
      const allConfigured = status.hmacSecret && status.accuweatherKey && status.ingestUrl;
      isConfigured = allConfigured;
      if (status.hmacSecret) details.push('HMAC secret');
      if (status.accuweatherKey) details.push('AccuWeather key');
      if (status.ingestUrl) details.push('Ingest URL');
    }

    return (
      <div className="flex items-center justify-between p-4 rounded-lg bg-background-tertiary/50">
        <div className="flex items-center gap-3">
          {isConfigured ? (
            <CheckCircle2 className="w-5 h-5 text-success" />
          ) : (
            <XCircle className="w-5 h-5 text-error" />
          )}
          <div>
            <p className="font-medium">{label}</p>
            {details.length > 0 ? (
              <p className="text-sm text-text-secondary">{details.join(', ')}</p>
            ) : (
              <p className="text-sm text-text-secondary">Not configured</p>
            )}
          </div>
        </div>
        <Badge variant={isConfigured ? 'success' : 'error'} className="text-xs">
          {isConfigured ? 'Configured' : 'Not Configured'}
        </Badge>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-prmx-cyan" />
            <h3 className="text-lg font-semibold">Oracle Key Injections</h3>
          </div>
          <Badge variant="info" className="text-xs">DAO Only</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-error/10 border border-error/30">
            <AlertCircle className="w-5 h-5 text-error mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-error mb-1">Failed to Check Key Status</p>
              <p className="text-sm text-text-secondary">{error}</p>
            </div>
          </div>
        )}

        <StatusRow version="v1" label="V1 Oracle (AccuWeather & R Pricing API)" status={keyStatus.v1} />
        <StatusRow version="v2" label="V2 Oracle (Backend Service)" status={keyStatus.v2} />
        <StatusRow version="v3" label="V3 Oracle (OCW Secrets)" status={keyStatus.v3} />

        <div className="pt-2 border-t border-border-secondary">
          <p className="text-xs text-text-tertiary">
            Status is checked automatically every 30 seconds. V1/V3 keys are stored in offchain worker storage. V2 uses backend service (keys in env vars, not on-chain).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

