/**
 * Configuration for V2 Oracle Service
 * Extended with V3 Ingest API settings
 */
export declare const config: {
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
};
