/**
 * Configuration for PRMX Off-chain Oracle Service
 * Supports V2 monitoring and V3 Ingest API
 */

import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

// Determine environment
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Validate HMAC secret in production
function getHmacSecret(): string {
  const secret = process.env.V3_INGEST_HMAC_SECRET;
  
  if (isProduction) {
    if (!secret) {
      throw new Error('V3_INGEST_HMAC_SECRET is required in production mode');
    }
    if (secret.length < 32) {
      throw new Error('V3_INGEST_HMAC_SECRET must be at least 32 characters in production');
    }
    if (secret === 'default-dev-secret-change-in-production') {
      throw new Error('V3_INGEST_HMAC_SECRET cannot use default value in production');
    }
  }
  
  return secret || 'default-dev-secret-change-in-production';
}

export const config = {
  // Environment
  isProduction,
  isTest,
  
  // MongoDB connection
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/prmx-oracle',
  
  // PRMX Node WebSocket URL
  wsUrl: process.env.WS_URL || 'ws://127.0.0.1:9944',
  
  // AccuWeather API
  accuweatherApiKey: process.env.ACCUWEATHER_API_KEY || '',
  accuweatherBaseUrl: 'https://dataservice.accuweather.com',
  
  // Reporter account mnemonic - uses dedicated Oracle account to avoid nonce conflicts
  // with test scripts and DAO operations
  reporterMnemonic: process.env.REPORTER_MNEMONIC || '//Oracle',
  
  // Polling interval (default: 30 minutes)
  pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '1800000', 10),
  
  // Manila location key (cached for efficiency)
  manilaLocationKey: process.env.MANILA_LOCATION_KEY || '264885',
  
  // Manila market ID (hardcoded for V2)
  manilaMarketId: 0,
  
  // REST API port
  apiPort: parseInt(process.env.API_PORT || '3001', 10),
  
  // =========================================================================
  // V3 Ingest API Settings
  // =========================================================================
  
  // HMAC secret for V3 ingest authentication (validated in production)
  v3IngestHmacSecret: getHmacSecret(),
  
  // Enable dev mode (skip auth validation) - NEVER true in production
  v3DevMode: isProduction ? false : process.env.V3_DEV_MODE === 'true',
  
  // Nonce window for replay protection (5 minutes default, 2 min in production)
  v3NonceWindowMs: parseInt(process.env.V3_NONCE_WINDOW_MS || (isProduction ? '120000' : '300000'), 10),
  
  // Maximum requests per minute per IP (rate limiting)
  v3RateLimitPerMinute: parseInt(process.env.V3_RATE_LIMIT_PER_MINUTE || '60', 10),
  
  // Enable request logging (useful for debugging, disable in prod)
  v3RequestLogging: process.env.V3_REQUEST_LOGGING === 'true',
};

