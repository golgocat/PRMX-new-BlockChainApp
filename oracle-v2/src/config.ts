/**
 * Configuration for V2 Oracle Service
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // MongoDB connection
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/prmx-oracle-v2',
  
  // PRMX Node WebSocket URL
  wsUrl: process.env.WS_URL || 'ws://127.0.0.1:9944',
  
  // AccuWeather API
  accuweatherApiKey: process.env.ACCUWEATHER_API_KEY || '',
  accuweatherBaseUrl: 'https://dataservice.accuweather.com',
  
  // Reporter account mnemonic
  reporterMnemonic: process.env.REPORTER_MNEMONIC || '//Alice',
  
  // Polling interval (default: 30 minutes)
  pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '1800000', 10),
  
  // Manila location key (cached for efficiency)
  manilaLocationKey: process.env.MANILA_LOCATION_KEY || '264885',
  
  // Manila market ID (hardcoded for V2)
  manilaMarketId: 0,
  
  // REST API port
  apiPort: parseInt(process.env.API_PORT || '3001', 10),
};

