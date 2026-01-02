/**
 * Admin API functions for OCW health monitoring
 */

import type { OcwHealthResponse, OcwHealthData } from '@/types/admin';
import { getApi } from '@/lib/api';

const ORACLE_SERVICE_URL = process.env.NEXT_PUBLIC_ORACLE_SERVICE_URL || 'http://localhost:3001';

/**
 * Fetch comprehensive OCW health status
 */
export async function getOcwHealthStatus(): Promise<OcwHealthData> {
  try {
    const response = await fetch(`${ORACLE_SERVICE_URL}/admin/health`, {
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
    }

    const data: OcwHealthResponse = await response.json();
    
    if (!data.success) {
      throw new Error('Health check returned unsuccessful response');
    }

    return data.data;
  } catch (error) {
    console.error('Failed to fetch OCW health status:', error);
    
    // Return a degraded status if the service is unreachable
    const now = Math.floor(Date.now() / 1000);
    return {
      overall_status: 'down',
      timestamp: now,
      services: {
        oracle_v2: { status: 'offline', last_check: now },
        oracle_v3: { status: 'offline', last_check: now },
        database: { status: 'offline', last_check: now },
        chain: { status: 'offline', last_check: now },
      },
      metrics: {
        policies_monitored: 0,
        snapshots_last_24h: 0,
        observations_last_24h: 0,
        last_successful_operation: 0,
      },
    };
  }
}

/**
 * Check V1 Oracle API key status (AccuWeather + R Pricing)
 * Since keys are stored in offchain local storage (not queryable via RPC),
 * we check for evidence of OCW activity:
 * - AccuWeather: market location configs, rolling state
 * - R Pricing: quote requests with results
 */
export async function checkV1OracleKey(): Promise<{ 
  configured: boolean; 
  hasPending: boolean;
  accuweatherConfigured: boolean;
  rPricingConfigured: boolean;
  rPricingUsingFallback: boolean;
}> {
  try {
    const api = await getApi();
    
    // First, try to check offchain storage directly for the API key
    let offchainKeyExists = false;
    try {
      const storageKey = '0x' + Buffer.from('prmx-oracle::accuweather-api-key').toString('hex');
      const offchainValue = await (api.rpc as any).offchain.localStorageGet('PERSISTENT', storageKey);
      offchainKeyExists = offchainValue && offchainValue.isSome;
    } catch {
      // Offchain RPC might not be available in all environments
    }
    
    // Also check AccuWeather API key evidence from on-chain data
    const markets = await api.query.prmxMarkets.markets.entries();
    let hasLocationConfig = false;
    let hasRollingState = false;
    
    // Check first few markets for location configs and rolling state
    for (const [key, _] of markets.slice(0, 10)) {
      try {
        const marketId = (key.args[0] as any).toNumber();
        
        // Check for location config
        const locationConfig = await api.query.prmxOracle.marketLocationConfig(marketId);
        if ((locationConfig as any).isSome) {
          hasLocationConfig = true;
        }
        
        // Check for rolling state (indicates rainfall data has been fetched)
        const rollingState = await api.query.prmxOracle.rollingState(marketId);
        if ((rollingState as any).isSome) {
          hasRollingState = true;
          break; // If we found one, that's enough evidence
        }
      } catch {
        // Skip if query fails
      }
    }
    
    // AccuWeather is configured if key exists in offchain storage OR there's on-chain evidence
    const accuweatherConfigured = offchainKeyExists || hasLocationConfig || hasRollingState;
    
    // Check R Pricing API key evidence and detect fallback usage
    let rPricingConfigured = false;
    let rPricingUsingFallback = false;
    
    try {
      // Check quote results to see if R Pricing is configured and if fallback is used
      const quoteResults = await api.query.prmxQuote.quoteResults.entries();
      const quoteRequests = await api.query.prmxQuote.quoteRequests.entries();
      
      // Create a map of quote requests by quote ID
      const requestMap = new Map<number, any>();
      for (const [key, value] of quoteRequests) {
        const quoteId = (key.args[0] as any).toNumber();
        const requestData = (value as any).toJSON();
        requestMap.set(quoteId, requestData);
      }
      
      if (quoteResults.length > 0) {
        rPricingConfigured = true;
        
        // Check if any quotes are using fallback (fixed 1% = 10,000 ppm for markets without actuarial model)
        // Markets without actuarial model (market_id != 0) always use fallback
        // We check if there are Ready/Consumed quotes for non-Manila markets (market_id != 0)
        for (const [key, value] of quoteResults) {
          const quoteId = (key.args[0] as any).toNumber();
          const request = requestMap.get(quoteId);
          
          if (request) {
            const marketId = request.marketId || request.market_id || 0;
            // Markets other than Manila (market_id = 0) use fixed 1% fallback probability
            if (marketId !== 0) {
              rPricingUsingFallback = true;
              break;
            }
          }
        }
      } else {
        // Check for quotes with Ready/Consumed status (indicates R API or fallback was used)
        for (const [key, _] of quoteRequests.slice(0, 20)) {
          try {
            const quoteId = (key.args[0] as any).toNumber();
            const status = await api.query.prmxQuote.quoteStatus(quoteId);
            const statusStr = status.toString();
            if (statusStr && statusStr !== 'Pending' && statusStr !== '0') {
              rPricingConfigured = true;
              
              // Check if this quote is for a non-Manila market (uses fallback)
              const requestData = requestMap.get(quoteId);
              if (requestData) {
                const marketId = requestData.marketId || requestData.market_id || 0;
                if (marketId !== 0) {
                  rPricingUsingFallback = true;
                }
              }
              
              break;
            }
          } catch {
            // Skip if query fails
          }
        }
      }
    } catch {
      // If quote pallet queries fail, assume not configured
    }
    
    // Overall configured if either key is configured
    const configured = accuweatherConfigured || rPricingConfigured;
    
    // Also check for pending AccuWeather key (in case it was just set)
    const pendingKey = await api.query.prmxOracle.pendingApiKey();
    const hasPending = (pendingKey as any).isSome;
    
    return {
      configured: configured || hasPending,
      hasPending,
      accuweatherConfigured: accuweatherConfigured || hasPending,
      rPricingConfigured,
      rPricingUsingFallback,
    };
  } catch (error) {
    console.error('Failed to check V1 oracle key:', error);
    return { 
      configured: false, 
      hasPending: false, 
      accuweatherConfigured: false, 
      rPricingConfigured: false,
      rPricingUsingFallback: false,
    };
  }
}

/**
 * Check V2 Oracle status
 * V2 uses an off-chain service, so we check:
 * 1. If there are authorized reporters on-chain
 * 2. If the V2 service is online (from health check)
 */
export async function checkV2OracleStatus(): Promise<{ 
  hasAuthorizedReporters: boolean; 
  reporterCount: number;
  serviceOnline: boolean;
}> {
  try {
    const api = await getApi();
    const reporters = await api.query.prmxOracle.authorizedV2Reporters.entries();
    
    const authorized = reporters.filter(([_, isAuthorized]) => (isAuthorized as any).isTrue);
    const hasAuthorizedReporters = authorized.length > 0;
    
    // Check if V2 service is online (from health endpoint)
    let serviceOnline = false;
    try {
      const healthResponse = await fetch(`${ORACLE_SERVICE_URL}/admin/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        if (healthData.success && healthData.data?.services?.oracle_v2?.status === 'online') {
          serviceOnline = true;
        }
      }
    } catch {
      // Service check failed, assume offline
    }
    
    return {
      hasAuthorizedReporters,
      reporterCount: authorized.length,
      serviceOnline,
    };
  } catch (error) {
    console.error('Failed to check V2 oracle status:', error);
    return { hasAuthorizedReporters: false, reporterCount: 0, serviceOnline: false };
  }
}

/**
 * Check V3 Oracle secrets status
 * Since V3 secrets are stored in offchain storage (not queryable via RPC),
 * we check if there's evidence of OCW activity (snapshots in the last 24h)
 */
export async function checkV3OracleSecrets(): Promise<{
  hmacSecret: boolean;
  accuweatherKey: boolean;
  ingestUrl: boolean;
}> {
  try {
    // Check oracle service for recent V3 activity
    const response = await fetch(`${ORACLE_SERVICE_URL}/ingest/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) {
        // If there are snapshots or observations, assume OCW is configured
        const hasActivity = (data.data.snapshots_count || 0) > 0 || (data.data.observations_count || 0) > 0;
        
        // Also check for recent activity (last 24h) from health endpoint
        const healthResponse = await fetch(`${ORACLE_SERVICE_URL}/admin/health`, {
          signal: AbortSignal.timeout(5000),
        });
        
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          if (healthData.success && healthData.data?.metrics) {
            const recentActivity = 
              (healthData.data.metrics.snapshots_last_24h || 0) > 0 ||
              (healthData.data.metrics.observations_last_24h || 0) > 0;
            
            const configured = hasActivity || recentActivity;
            return {
              hmacSecret: configured,
              accuweatherKey: configured,
              ingestUrl: configured,
            };
          }
        }
        
        // Fallback: if we have any activity history, assume configured
        return {
          hmacSecret: hasActivity,
          accuweatherKey: hasActivity,
          ingestUrl: hasActivity,
        };
      }
    }
    
    return { hmacSecret: false, accuweatherKey: false, ingestUrl: false };
  } catch (error) {
    console.error('Failed to check V3 oracle secrets:', error);
    return { hmacSecret: false, accuweatherKey: false, ingestUrl: false };
  }
}
