/**
 * Configuration for PRMX Off-chain Oracle Service
 * Supports V2 monitoring and V3 Ingest API
 */
export declare const config: {
    isProduction: boolean;
    isTest: boolean;
    mongodbUri: string;
    wsUrl: string;
    accuweatherApiKey: string;
    accuweatherBaseUrl: string;
    reporterMnemonic: string;
    pollingIntervalMs: number;
    manilaLocationKey: string;
    manilaMarketId: number;
    apiPort: number;
    v3IngestHmacSecret: string;
    v3DevMode: boolean;
    v3NonceWindowMs: number;
    v3RateLimitPerMinute: number;
    v3RequestLogging: boolean;
};
