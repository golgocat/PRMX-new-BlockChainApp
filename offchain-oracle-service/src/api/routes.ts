/**
 * REST API routes for PRMX Off-chain Oracle Service
 * 
 * API Structure:
 *   /monitoring/* - V2 cumulative rainfall monitoring
 *   /ingest/*     - V3 OCW data ingestion
 *   /health       - Service health check
 */

import { Application, Request, Response } from 'express';
import { getMonitors, getBuckets, getEvidence, clearAllData, getObservationsV3, getSnapshotsV3, checkDatabaseHealth } from '../db/mongo.js';
import { runEvaluationCycle } from '../scheduler/monitor.js';
import { evaluateMonitor } from '../evaluator/cumulative.js';
import { fetchPrecipitation, fetchCurrentConditions, fetchHistorical24Hours } from '../accuweather/fetcher.js';
import { config } from '../config.js';
import { getApi } from '../chain/listener.js';
import crypto from 'crypto';

/**
 * Setup all API routes
 */
export function setupRoutes(app: Application): void {
  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'prmx-offchain-oracle-service',
      timestamp: new Date().toISOString(),
    });
  });

  // =========================================================================
  // Monitoring API (/monitoring/*) - V2 cumulative rainfall monitoring
  // =========================================================================

  // Get all monitors
  app.get('/monitoring/monitors', async (req: Request, res: Response) => {
    try {
      const monitors = getMonitors();
      const docs = await monitors.find({}).sort({ created_at: -1 }).toArray();
      
      res.json({
        success: true,
        data: docs,
        count: docs.length,
      });
    } catch (error) {
      console.error('Error fetching monitors:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monitors',
      });
    }
  });

  // Get single monitor by composite ID (market_id:policy_id)
  app.get('/monitoring/monitors/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const monitors = getMonitors();
      const doc = await monitors.findOne({ _id: id });
      
      if (!doc) {
        return res.status(404).json({
          success: false,
          error: `Monitor ${id} not found`,
        });
      }
      
      res.json({
        success: true,
        data: doc,
      });
    } catch (error) {
      console.error('Error fetching monitor:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monitor',
      });
    }
  });

  // Get monitor by policy_id (convenience endpoint)
  app.get('/monitoring/policies/:policyId/monitor', async (req: Request, res: Response) => {
    try {
      const policyId = parseInt(req.params.policyId, 10);
      if (isNaN(policyId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid policy ID',
        });
      }
      
      const monitors = getMonitors();
      const doc = await monitors.findOne({ policy_id: policyId });
      
      if (!doc) {
        return res.status(404).json({
          success: false,
          error: `No V2 monitor found for policy ${policyId}`,
        });
      }
      
      res.json({
        success: true,
        data: doc,
      });
    } catch (error) {
      console.error('Error fetching monitor by policy:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monitor',
      });
    }
  });

  // Get hourly buckets for a monitor
  app.get('/monitoring/monitors/:id/buckets', async (req: Request, res: Response) => {
    try {
      const { id } = req.params; // Format: "market_id:policy_id"
      const buckets = getBuckets();
      
      // Query by monitor_id which matches the format "market_id:policy_id"
      const docs = await buckets
        .find({ monitor_id: id })
        .sort({ hour_utc: -1 })
        .limit(168) // Last 7 days of hourly data
        .toArray();
      
      res.json({
        success: true,
        data: docs,
        count: docs.length,
        monitor_id: id,
      });
    } catch (error) {
      console.error('Error fetching buckets:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch buckets',
      });
    }
  });

  // Backfill missing hourly buckets for a monitor
  // Uses real historical data from AccuWeather (Starter tier) for the past 24 hours
  // Hours beyond 24h window are filled with 0mm
  app.post('/monitoring/monitors/:id/backfill', async (req: Request, res: Response) => {
    try {
      const { id } = req.params; // Format: "market_id:policy_id"
      const monitors = getMonitors();
      const buckets = getBuckets();
      
      // Get the monitor
      const monitor = await monitors.findOne({ _id: id });
      if (!monitor) {
        return res.status(404).json({
          success: false,
          error: `Monitor ${id} not found`,
        });
      }
      
      console.log(`🔄 Backfilling monitor ${id} with historical data...`);
      
      // Calculate the time range: from coverage_start to min(coverage_end, now)
      const coverageStartMs = monitor.coverage_start * 1000;
      const coverageEndMs = monitor.coverage_end * 1000;
      const nowMs = Date.now();
      const endMs = Math.min(coverageEndMs, nowMs);
      
      // Round to hour boundaries
      const startHour = new Date(coverageStartMs);
      startHour.setMinutes(0, 0, 0);
      
      const endHour = new Date(endMs);
      endHour.setMinutes(0, 0, 0);
      
      // Get existing buckets
      const existingBuckets = await buckets.find({ monitor_id: id }).toArray();
      const existingHours = new Set(existingBuckets.map(b => b.hour_utc));
      
      // Fetch 24h historical data from AccuWeather
      let historicalRecords: Array<{ dateTime: string; precipitationMm: number; rawData: object }> = [];
      let historicalError: string | null = null;
      
      try {
        historicalRecords = await fetchHistorical24Hours(monitor.location_key);
        console.log(`   ✅ Fetched ${historicalRecords.length} hours of historical data`);
      } catch (err) {
        historicalError = err instanceof Error ? err.message : 'Unknown error';
        console.log(`   ⚠️  Failed to fetch historical data: ${historicalError}`);
      }
      
      // Build a map of historical data by hour
      const historicalByHour = new Map<string, { mm: number; rawData: object }>();
      for (const record of historicalRecords) {
        const hourUtc = normalizeToHour(record.dateTime);
        historicalByHour.set(hourUtc, {
          mm: Math.round(record.precipitationMm * 10), // Convert to tenths
          rawData: record.rawData,
        });
      }
      
      // Find missing hours
      const missingHours: Array<{ hour: Date; bucketId: string }> = [];
      const currentHour = new Date(startHour);
      
      while (currentHour <= endHour) {
        const hourUtc = currentHour.toISOString().slice(0, 13) + ':00:00.000Z';
        
        if (!existingHours.has(hourUtc)) {
          const hourKey = currentHour.toISOString().slice(0, 13).replace(/[-T:]/g, '').slice(0, 10);
          const bucketId = `${id}:${hourKey}`;
          missingHours.push({ hour: new Date(currentHour), bucketId });
        }
        
        currentHour.setHours(currentHour.getHours() + 1);
      }
      
      // Fill missing hours - use real data if available, otherwise 0mm
      let filledWithRealData = 0;
      let filledWithZero = 0;
      
      for (const missing of missingHours) {
        const hourUtc = missing.hour.toISOString().slice(0, 13) + ':00:00.000Z';
        const historical = historicalByHour.get(hourUtc);
        
        if (historical) {
          // Real historical data available
          await buckets.updateOne(
            { _id: missing.bucketId },
            {
              $set: {
                monitor_id: id,
                hour_utc: hourUtc,
                mm: historical.mm,
                backfilled: false, // Real data, not a placeholder
                fetched_at: new Date(),
                raw_data: historical.rawData,
              }
            },
            { upsert: true }
          );
          filledWithRealData++;
        } else {
          // No historical data - fill with 0mm
          await buckets.updateOne(
            { _id: missing.bucketId },
            {
              $set: {
                monitor_id: id,
                hour_utc: hourUtc,
                mm: 0,
                backfilled: true, // Placeholder, no real data
                fetched_at: new Date(),
                raw_data: { note: 'Backfilled - outside 24h historical window' },
              }
            },
            { upsert: true }
          );
          filledWithZero++;
        }
      }
      
      console.log(`📊 Backfill complete for monitor ${id}:`);
      console.log(`   - Filled with real data: ${filledWithRealData}`);
      console.log(`   - Filled with 0mm: ${filledWithZero}`);
      
      res.json({
        success: true,
        message: `Backfilled ${missingHours.length} missing hourly buckets (${filledWithRealData} with real data, ${filledWithZero} with 0mm)`,
        monitor_id: id,
        coverage_start: new Date(coverageStartMs).toISOString(),
        coverage_end: new Date(endMs).toISOString(),
        existing_buckets: existingBuckets.length,
        backfilled_with_real_data: filledWithRealData,
        backfilled_with_zero: filledWithZero,
        total_backfilled: missingHours.length,
        total_buckets: existingBuckets.length + missingHours.length,
        historical_fetch_error: historicalError,
      });
    } catch (error) {
      console.error('Error backfilling buckets:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to backfill buckets',
      });
    }
  });
  
  // Helper function to normalize datetime to hour start
  function normalizeToHour(dateTime: string): string {
    const d = new Date(dateTime);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 13) + ':00:00.000Z';
  }

  // Get stats summary
  app.get('/monitoring/stats', async (req: Request, res: Response) => {
    try {
      const monitors = getMonitors();
      
      const [total, monitoring, triggered, matured, reported] = await Promise.all([
        monitors.countDocuments({}),
        monitors.countDocuments({ state: 'monitoring' }),
        monitors.countDocuments({ state: 'triggered' }),
        monitors.countDocuments({ state: 'matured' }),
        monitors.countDocuments({ state: 'reported' }),
      ]);
      
      res.json({
        success: true,
        data: {
          total,
          monitoring,
          triggered,
          matured,
          reported,
          active: monitoring, // Alias
        },
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch stats',
      });
    }
  });

  // Trigger immediate evaluation for all active monitors
  app.post('/monitoring/monitors/trigger-all', async (req: Request, res: Response) => {
    try {
      console.log('🔔 Manual trigger: Evaluating all active monitors');
      await runEvaluationCycle();
      
      res.json({
        success: true,
        message: 'Evaluation cycle triggered for all active monitors',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error triggering evaluation cycle:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to trigger evaluation cycle',
      });
    }
  });

  // Trigger immediate evaluation for a specific monitor
  app.post('/monitoring/monitors/:id/trigger', async (req: Request, res: Response) => {
    try {
      const { id } = req.params; // Format: "market_id:policy_id"
      const monitors = getMonitors();
      
      const monitor = await monitors.findOne({ _id: id });
      
      if (!monitor) {
        return res.status(404).json({
          success: false,
          error: `Monitor ${id} not found`,
        });
      }
      
      console.log(`🔔 Manual trigger: Evaluating monitor ${id} (policy ${monitor.policy_id})`);
      await evaluateMonitor(monitor);
      
      // Fetch updated monitor state
      const updatedMonitor = await monitors.findOne({ _id: id });
      
      res.json({
        success: true,
        message: `Evaluation triggered for monitor ${id}`,
        monitor: updatedMonitor,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error triggering monitor evaluation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to trigger monitor evaluation',
      });
    }
  });

  // Admin endpoint to clear all database data (for debugging/testing)
  app.post('/monitoring/admin/clear-database', async (req: Request, res: Response) => {
    try {
      console.log('🗑️ Admin request: Clearing all Oracle V2 database data');
      await clearAllData();
      
      res.json({
        success: true,
        message: 'All Oracle V2 data has been cleared',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error clearing database:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear database',
      });
    }
  });

  // Test endpoint to check AccuWeather API response
  app.get('/monitoring/test/accuweather/:locationKey', async (req: Request, res: Response) => {
    try {
      const { locationKey } = req.params;
      
      console.log(`🧪 Testing AccuWeather API for location ${locationKey}`);
      
      // Fetch current conditions (available on Starter tier)
      const currentConditions = await fetchCurrentConditions(locationKey);
      
      if (!currentConditions) {
        return res.status(404).json({
          success: false,
          error: 'No current conditions data available',
        });
      }
      
      res.json({
        success: true,
        locationKey,
        observationTime: currentConditions.observationDateTime,
        epochTime: currentConditions.epochTime,
        precipitation: {
          pastHourMm: currentConditions.pastHourMm,
          past3HoursMm: currentConditions.past3HoursMm,
          past6HoursMm: currentConditions.past6HoursMm,
          past12HoursMm: currentConditions.past12HoursMm,
          past24HoursMm: currentConditions.past24HoursMm,
        },
        note: 'Using Current Conditions endpoint (Starter tier). Hourly buckets are built incrementally over time.',
      });
    } catch (error) {
      console.error('Error testing AccuWeather API:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Admin endpoint to reset a monitor state (for retrying failed submissions)
  app.post('/monitoring/admin/monitors/:id/reset', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const monitors = getMonitors();
      
      const monitor = await monitors.findOne({ _id: id });
      if (!monitor) {
        return res.status(404).json({
          success: false,
          error: `Monitor ${id} not found`,
        });
      }
      
      console.log(`🔄 Admin request: Resetting monitor ${id} to monitoring state`);
      
      await monitors.updateOne(
        { _id: id },
        {
          $set: {
            state: 'monitoring',
            updated_at: new Date(),
          },
          $unset: {
            trigger_time: 1,
          }
        }
      );
      
      const updatedMonitor = await monitors.findOne({ _id: id });
      
      res.json({
        success: true,
        message: `Monitor ${id} reset to monitoring state`,
        monitor: updatedMonitor,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error resetting monitor:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reset monitor',
      });
    }
  });

  // =========================================================================
  // Ingest API (/ingest/*) - V3 OCW data ingestion
  // =========================================================================

  // HMAC secret for V3 ingest authentication (from config)
  const V3_INGEST_HMAC_SECRET = config.v3IngestHmacSecret;
  const V3_NONCE_WINDOW_MS = config.v3NonceWindowMs;
  const V3_DEV_MODE = config.v3DevMode;
  const V3_RATE_LIMIT = config.v3RateLimitPerMinute;
  const V3_REQUEST_LOGGING = config.v3RequestLogging;
  const usedNonces = new Map<string, number>(); // In production, use Redis
  const requestCounts = new Map<string, { count: number; resetAt: number }>(); // Rate limiting
  
  if (config.isProduction) {
    console.log('🔒 V3 Ingest API running in PRODUCTION mode');
    console.log(`   Rate limit: ${V3_RATE_LIMIT} requests/minute per IP`);
    console.log(`   Nonce window: ${V3_NONCE_WINDOW_MS}ms`);
  } else if (V3_DEV_MODE) {
    console.log('⚠️  V3 Ingest API running in DEV MODE - auth validation disabled');
  }

  /**
   * Rate limiting for V3 endpoints
   */
  function checkRateLimit(req: Request): { allowed: boolean; error?: string } {
    if (V3_DEV_MODE) return { allowed: true };
    
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = requestCounts.get(ip);
    
    if (!entry || now > entry.resetAt) {
      // New window
      requestCounts.set(ip, { count: 1, resetAt: now + 60000 });
      return { allowed: true };
    }
    
    if (entry.count >= V3_RATE_LIMIT) {
      return { 
        allowed: false, 
        error: `Rate limit exceeded. Limit: ${V3_RATE_LIMIT}/minute. Retry after: ${Math.ceil((entry.resetAt - now) / 1000)}s`
      };
    }
    
    entry.count++;
    return { allowed: true };
  }

  /**
   * Log V3 request (if enabled)
   */
  function logV3Request(req: Request, endpoint: string, success: boolean): void {
    if (!V3_REQUEST_LOGGING) return;
    
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const timestamp = new Date().toISOString();
    console.log(`[V3] ${timestamp} ${success ? '✓' : '✗'} ${endpoint} from ${ip}`);
  }

  /**
   * Validate HMAC signature for V3 requests
   * Supports both Blake2 (from OCW) and HMAC-SHA256 signatures
   */
  function validateV3Signature(req: Request): { valid: boolean; error?: string } {
    // Skip auth in dev mode
    if (V3_DEV_MODE) {
      console.log('⚠️  V3 dev mode: skipping auth validation');
      return { valid: true };
    }

    const signature = req.headers['x-hmac-signature'] as string;
    const timestamp = req.headers['x-timestamp'] as string;
    const nonce = req.headers['x-nonce'] as string;

    if (!signature || !timestamp || !nonce) {
      return { valid: false, error: 'Missing required headers: x-hmac-signature, x-timestamp, x-nonce' };
    }

    // Validate timestamp
    const reqTime = parseInt(timestamp, 10);
    const now = Date.now();
    if (isNaN(reqTime) || Math.abs(now - reqTime) > V3_NONCE_WINDOW_MS) {
      return { valid: false, error: 'Timestamp out of acceptable window' };
    }

    // Check nonce uniqueness
    if (usedNonces.has(nonce)) {
      return { valid: false, error: 'Nonce already used' };
    }
    usedNonces.set(nonce, now);

    // Cleanup old nonces periodically
    if (usedNonces.size > 10000) {
      const cutoff = now - V3_NONCE_WINDOW_MS;
      for (const [key, time] of usedNonces) {
        if (time < cutoff) usedNonces.delete(key);
      }
    }

    // Get raw body for signature verification
    // The OCW sends: Blake2(secret || payload || timestamp || nonce)
    const rawBody = JSON.stringify(req.body);
    const signatureInput = V3_INGEST_HMAC_SECRET + rawBody + timestamp + nonce;
    
    // Try Blake2-256 signature (from Substrate OCW)
    const blake2Sig = computeBlake2Signature(signatureInput);
    if (signature === blake2Sig) {
      return { valid: true };
    }

    // Fallback to HMAC-SHA256 for testing tools
    const hmacSig = crypto
      .createHmac('sha256', V3_INGEST_HMAC_SECRET)
      .update(rawBody + timestamp + nonce)
      .digest('hex');

    if (signature === hmacSig) {
      return { valid: true };
    }

    console.log('Signature mismatch:');
    console.log('  Received:', signature);
    console.log('  Expected Blake2:', blake2Sig);
    console.log('  Expected HMAC:', hmacSig);

    return { valid: false, error: 'Invalid signature' };
  }

  /**
   * Compute Blake2-256 signature (matching Substrate's BlakeTwo256)
   */
  function computeBlake2Signature(input: string): string {
    // Use blake2b with 256-bit output to match Substrate's BlakeTwo256
    const blake2b = crypto.createHash('blake2b512');
    blake2b.update(input);
    // Take first 32 bytes (256 bits) to match Blake2-256
    return blake2b.digest('hex').slice(0, 64);
  }

  /**
   * POST /ingest/observations/batch
   * Receive observation batch from OCW
   * 
   * OCW sends samples with fields:
   * - epoch_time: number
   * - precip_1h_mm_x1000: number
   * - temp_c_x1000: number
   * - wind_gust_mps_x1000: number
   * - precip_type_mask: number
   * - sample_hash: string (hex)
   */
  app.post('/ingest/observations/batch', async (req: Request, res: Response) => {
    try {
      // Rate limiting
      const rateLimitResult = checkRateLimit(req);
      if (!rateLimitResult.allowed) {
        logV3Request(req, '/ingest/observations/batch', false);
        return res.status(429).json({
          success: false,
          error: rateLimitResult.error,
        });
      }

      // Validate HMAC signature
      const authResult = validateV3Signature(req);
      if (!authResult.valid) {
        logV3Request(req, '/ingest/observations/batch', false);
        return res.status(401).json({
          success: false,
          error: authResult.error,
        });
      }

      const { policy_id, location_key, samples, commitment_after } = req.body;

      // Validate required fields - oracle_id is optional for OCW
      if (policy_id === undefined || !samples || !Array.isArray(samples)) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: policy_id, samples',
        });
      }

      const observations = getObservationsV3();
      let inserted = 0;
      let alreadyPresent = 0;
      let rejectedInvalid = 0;

      for (const sample of samples) {
        if (!sample.epoch_time) {
          rejectedInvalid++;
          continue;
        }

        const docId = `${policy_id}:${sample.epoch_time}`;
        
        // Extract fields from OCW format
        const fields: Record<string, number> = {};
        if (sample.precip_1h_mm_x1000 !== undefined) fields.precip_1h_mm_x1000 = sample.precip_1h_mm_x1000;
        if (sample.temp_c_x1000 !== undefined) fields.temp_c_x1000 = sample.temp_c_x1000;
        if (sample.wind_gust_mps_x1000 !== undefined) fields.wind_gust_mps_x1000 = sample.wind_gust_mps_x1000;
        if (sample.precip_type_mask !== undefined) fields.precip_type_mask = sample.precip_type_mask;
        // Also support normalized_fields from test tools
        if (sample.normalized_fields) Object.assign(fields, sample.normalized_fields);
        
        try {
          const result = await observations.updateOne(
            { _id: docId },
            {
              $setOnInsert: {
                policy_id,
                epoch_time: sample.epoch_time,
                location_key: location_key || '',
                event_type: '', // Event type is in policy metadata, not per-observation
                fields,
                sample_hash: sample.sample_hash || '',
                commitment_after: commitment_after || '',
                inserted_at: new Date(),
              }
            },
            { upsert: true }
          );

          if (result.upsertedCount > 0) {
            inserted++;
          } else {
            alreadyPresent++;
          }
        } catch (err) {
          rejectedInvalid++;
        }
      }

      console.log(`📥 V3 Observations batch: policy=${policy_id}, inserted=${inserted}, dupe=${alreadyPresent}, rejected=${rejectedInvalid}`);
      logV3Request(req, '/ingest/observations/batch', true);

      res.json({
        success: true,
        inserted,
        already_present: alreadyPresent,
        rejected_invalid: rejectedInvalid,
        total_received: samples.length,
      });
    } catch (error) {
      console.error('Error processing observations batch:', error);
      logV3Request(req, '/ingest/observations/batch', false);
      res.status(500).json({
        success: false,
        error: 'Failed to process observations batch',
      });
    }
  });

  /**
   * POST /v1/snapshots
   * Receive snapshot from OCW
   * 
   * OCW sends:
   * - policy_id: number
   * - observed_until: number
   * - agg_state: string (hex-encoded SCALE bytes)
   * - commitment: string (hex)
   */
  app.post('/ingest/snapshots', async (req: Request, res: Response) => {
    try {
      // Rate limiting
      const rateLimitResult = checkRateLimit(req);
      if (!rateLimitResult.allowed) {
        logV3Request(req, '/ingest/snapshots', false);
        return res.status(429).json({
          success: false,
          error: rateLimitResult.error,
        });
      }

      // Validate HMAC signature
      const authResult = validateV3Signature(req);
      if (!authResult.valid) {
        logV3Request(req, '/ingest/snapshots', false);
        return res.status(401).json({
          success: false,
          error: authResult.error,
        });
      }

      const { policy_id, observed_until, agg_state, commitment } = req.body;

      // Validate required fields - oracle_id is optional for OCW
      if (policy_id === undefined || observed_until === undefined || !commitment) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: policy_id, observed_until, commitment',
        });
      }

      const snapshots = getSnapshotsV3();
      const docId = `${policy_id}:${observed_until}`;

      // Handle agg_state - can be hex string or object
      let parsedAggState: object;
      if (typeof agg_state === 'string') {
        // Hex-encoded SCALE bytes from OCW
        parsedAggState = { encoded: agg_state };
      } else {
        parsedAggState = agg_state || {};
      }

      const result = await snapshots.updateOne(
        { _id: docId },
        {
          $setOnInsert: {
            policy_id,
            observed_until,
            agg_state: parsedAggState,
            commitment,
            inserted_at: new Date(),
          }
        },
        { upsert: true }
      );

      const isNew = result.upsertedCount > 0;

      console.log(`📸 V3 Snapshot: policy=${policy_id}, observed_until=${observed_until}, new=${isNew}`);

      res.json({
        success: true,
        is_new: isNew,
        policy_id,
        observed_until,
      });
    } catch (error) {
      console.error('Error processing snapshot:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process snapshot',
      });
    }
  });

  /**
   * GET /v1/observations/:policyId
   * Retrieve observations for a policy
   */
  app.get('/ingest/observations/:policyId', async (req: Request, res: Response) => {
    try {
      const policyId = parseInt(req.params.policyId, 10);
      if (isNaN(policyId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid policy ID',
        });
      }

      const observations = getObservationsV3();
      const docs = await observations
        .find({ policy_id: policyId })
        .sort({ epoch_time: 1 })
        .toArray();

      res.json({
        success: true,
        data: docs,
        count: docs.length,
      });
    } catch (error) {
      console.error('Error fetching observations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch observations',
      });
    }
  });

  /**
   * GET /v1/snapshots/:policyId
   * Retrieve snapshots for a policy
   */
  app.get('/ingest/snapshots/:policyId', async (req: Request, res: Response) => {
    try {
      const policyId = parseInt(req.params.policyId, 10);
      if (isNaN(policyId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid policy ID',
        });
      }

      const snapshots = getSnapshotsV3();
      const docs = await snapshots
        .find({ policy_id: policyId })
        .sort({ observed_until: -1 })
        .toArray();

      res.json({
        success: true,
        data: docs,
        count: docs.length,
      });
    } catch (error) {
      console.error('Error fetching snapshots:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch snapshots',
      });
    }
  });

  /**
   * GET /v1/stats
   * Get V3 ingest statistics
   */
  app.get('/ingest/stats', async (req: Request, res: Response) => {
    try {
      const observations = getObservationsV3();
      const snapshots = getSnapshotsV3();

      const [obsCount, snapCount] = await Promise.all([
        observations.countDocuments({}),
        snapshots.countDocuments({}),
      ]);

      res.json({
        success: true,
        data: {
          observations_count: obsCount,
          snapshots_count: snapCount,
          nonces_cached: usedNonces.size,
        },
      });
    } catch (error) {
      console.error('Error fetching V3 stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch stats',
      });
    }
  });

  // =========================================================================
  // Admin API (/admin/*) - System health and monitoring
  // =========================================================================

  /**
   * GET /admin/health
   * Comprehensive health check endpoint for OCW system
   */
  app.get('/admin/health', async (req: Request, res: Response) => {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const services: {
      oracle_v2: { status: 'online' | 'offline'; last_check: number; policies_monitored?: number };
      oracle_v3: { status: 'online' | 'offline'; last_check: number; observations_24h?: number; snapshots_24h?: number };
      database: { status: 'online' | 'offline'; last_check: number };
      chain: { status: 'online' | 'offline'; last_check: number };
    } = {
      oracle_v2: { status: 'offline', last_check: now },
      oracle_v3: { status: 'offline', last_check: now },
      database: { status: 'offline', last_check: now },
      chain: { status: 'offline', last_check: now },
    };

    // Check Oracle V2 (monitoring service)
    try {
      const monitors = getMonitors();
      const monitoringCount = await monitors.countDocuments({ state: 'monitoring' });
      services.oracle_v2 = {
        status: 'online',
        last_check: now,
        policies_monitored: monitoringCount,
      };
    } catch (error) {
      console.error('Oracle V2 health check failed:', error);
      services.oracle_v2.status = 'offline';
    }

    // Check Oracle V3 (ingest service)
    try {
      const observations = getObservationsV3();
      const snapshots = getSnapshotsV3();
      
      const [obsCount24h, snapCount24h] = await Promise.all([
        observations.countDocuments({
          inserted_at: { $gte: new Date(oneDayAgo) }
        }),
        snapshots.countDocuments({
          inserted_at: { $gte: new Date(oneDayAgo) }
        }),
      ]);

      services.oracle_v3 = {
        status: 'online',
        last_check: now,
        observations_24h: obsCount24h,
        snapshots_24h: snapCount24h,
      };
    } catch (error) {
      console.error('Oracle V3 health check failed:', error);
      services.oracle_v3.status = 'offline';
    }

    // Check Database
    try {
      const dbHealthy = await checkDatabaseHealth();
      services.database = {
        status: dbHealthy ? 'online' : 'offline',
        last_check: now,
      };
    } catch (error) {
      console.error('Database health check failed:', error);
    }

    // Check Chain connection
    try {
      const api = getApi();
      // Try to get latest block (with timeout)
      const headerPromise = api.rpc.chain.getHeader();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      const header = await Promise.race([headerPromise, timeoutPromise]);
      if (header) {
        services.chain = {
          status: 'online',
          last_check: now,
        };
      }
    } catch (error) {
      console.error('Chain health check failed:', error);
      services.chain.status = 'offline';
    }

    // Calculate metrics
    let policiesMonitored = 0;
    let snapshotsLast24h = 0;
    let observationsLast24h = 0;
    let lastSuccessfulOperation = 0;

    try {
      // Count active V2 monitors
      const monitors = getMonitors();
      const v2Active = await monitors.countDocuments({ state: 'monitoring' });
      
      // Count active V3 policies (we need to query chain for this, but for now use snapshot count as proxy)
      // In a full implementation, we'd query the chain, but for health check we'll use available data
      
      policiesMonitored = v2Active; // Will be enhanced when we can query V3 policies from chain

      snapshotsLast24h = services.oracle_v3.snapshots_24h || 0;
      observationsLast24h = services.oracle_v3.observations_24h || 0;

      // Get last successful operation timestamp
      // Check BOTH on-chain oracle states AND database insertions
      // On-chain is the source of truth for actual OCW snapshot submissions
      let maxObservedUntil = 0;
      
      try {
        // Method 1: Check on-chain oracle states (most accurate - reflects actual OCW snapshot submissions)
        const chainApi = getApi();
        const policies = await chainApi.query.prmxPolicyV3.policies.entries();
        
        if (policies.length > 0) {
          // Query oracle states for all policies (limit to 50 to avoid timeout)
          // Query each policy's oracle state individually (same pattern as frontend uses oracleStates(policyId))
          const oracleStatePromises = policies.slice(0, 50).map(async ([key]) => {
            try {
              const policyId = (key.args[0] as any).toNumber();
              const oracleState = await chainApi.query.prmxOracleV3.oracleStates(policyId);
              
              if ((oracleState as any).isNone) {
                return 0;
              }
              
              const state = (oracleState as any).unwrap();
              const human = state.toHuman ? state.toHuman() : state;
              
              // Use same parsing as frontend
              const observedUntil = parseInt((human.observedUntil || human.observed_until || '0').toString().replace(/,/g, ''));
              
              return observedUntil > 0 ? observedUntil : 0;
            } catch (error) {
              // Skip if query fails for this policy
              return 0;
            }
          });
          
          const observedUntilValues = await Promise.all(oracleStatePromises);
          maxObservedUntil = Math.max(...observedUntilValues, 0);
        }
      } catch (error) {
        console.error('[Health Check] Error checking on-chain oracle states:', error);
      }
      
      // Method 2: Check database insertions (backup - reflects ingest API activity)
      const snapshots = getSnapshotsV3();
      const observations = getObservationsV3();
      
      const [lastSnapshot, lastObservation] = await Promise.all([
        snapshots.findOne(
          {},
          { sort: { inserted_at: -1 } }
        ),
        observations.findOne(
          {},
          { sort: { inserted_at: -1 } }
        ),
      ]);

      const snapshotTime = lastSnapshot?.inserted_at ? Math.floor(new Date(lastSnapshot.inserted_at).getTime() / 1000) : 0;
      const observationTime = lastObservation?.inserted_at ? Math.floor(new Date(lastObservation.inserted_at).getTime() / 1000) : 0;
      const dbMaxTime = Math.max(snapshotTime, observationTime);
      
      // Use the maximum of on-chain and database timestamps
      // On-chain is primary since that's where OCW submits snapshots directly
      lastSuccessfulOperation = Math.max(maxObservedUntil, dbMaxTime);

    } catch (error) {
      console.error('Error calculating metrics:', error);
    }

    // Calculate overall status
    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    const onlineServices = [
      services.oracle_v2.status,
      services.oracle_v3.status,
      services.database.status,
      services.chain.status,
    ].filter(s => s === 'online').length;

    if (onlineServices === 0) {
      overallStatus = 'down';
    } else if (onlineServices < 4 || lastSuccessfulOperation < now - 3600) {
      // Degraded if any service offline or no activity in last hour
      overallStatus = 'degraded';
    }

    res.json({
      success: true,
      data: {
        overall_status: overallStatus,
        timestamp: now,
        services,
        metrics: {
          policies_monitored: policiesMonitored,
          snapshots_last_24h: snapshotsLast24h,
          observations_last_24h: observationsLast24h,
          last_successful_operation: lastSuccessfulOperation,
        },
      },
    });
  });
}

