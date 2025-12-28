/**
 * REST API routes for V2 Oracle Service
 * Extended with V3 Ingest API endpoints
 */

import { Application, Request, Response } from 'express';
import { getMonitors, getBuckets, getEvidence, clearAllData, getObservationsV3, getSnapshotsV3 } from '../db/mongo.js';
import { runEvaluationCycle } from '../scheduler/monitor.js';
import { evaluateMonitor } from '../evaluator/cumulative.js';
import { fetchPrecipitation, fetchCurrentConditions, fetchHistorical24Hours } from '../accuweather/fetcher.js';
import crypto from 'crypto';

/**
 * Setup all API routes
 */
export function setupRoutes(app: Application): void {
  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'prmx-oracle-v2',
      timestamp: new Date().toISOString(),
    });
  });

  // Get all V2 monitors
  app.get('/v2/monitors', async (req: Request, res: Response) => {
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
  app.get('/v2/monitors/:id', async (req: Request, res: Response) => {
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
  app.get('/v2/policies/:policyId/monitor', async (req: Request, res: Response) => {
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
  app.get('/v2/monitors/:id/buckets', async (req: Request, res: Response) => {
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
  app.post('/v2/monitors/:id/backfill', async (req: Request, res: Response) => {
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
  app.get('/v2/stats', async (req: Request, res: Response) => {
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
  app.post('/v2/monitors/trigger-all', async (req: Request, res: Response) => {
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
  app.post('/v2/monitors/:id/trigger', async (req: Request, res: Response) => {
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
  app.post('/v2/admin/clear-database', async (req: Request, res: Response) => {
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
  app.get('/v2/test/accuweather/:locationKey', async (req: Request, res: Response) => {
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
  app.post('/v2/admin/monitors/:id/reset', async (req: Request, res: Response) => {
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
  // V3 Ingest API Endpoints
  // =========================================================================

  // HMAC secret for V3 ingest authentication
  const V3_INGEST_HMAC_SECRET = process.env.V3_INGEST_HMAC_SECRET || 'default-dev-secret-change-in-production';
  const V3_NONCE_WINDOW_MS = 5 * 60 * 1000; // 5 minute window for timestamp validation
  const usedNonces = new Map<string, number>(); // In production, use Redis

  /**
   * Validate HMAC signature for V3 requests
   */
  function validateV3Signature(req: Request): { valid: boolean; error?: string } {
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

    // Compute expected signature
    const payload = JSON.stringify(req.body) + timestamp + nonce;
    const expectedSig = crypto
      .createHmac('sha256', V3_INGEST_HMAC_SECRET)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSig) {
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true };
  }

  /**
   * POST /v1/observations/batch
   * Receive observation batch from OCW
   */
  app.post('/v1/observations/batch', async (req: Request, res: Response) => {
    try {
      // Validate HMAC signature
      const authResult = validateV3Signature(req);
      if (!authResult.valid) {
        return res.status(401).json({
          success: false,
          error: authResult.error,
        });
      }

      const { oracle_id, policy_id, location_key, event_type, samples, commitment_after, nonce } = req.body;

      // Validate required fields
      if (!oracle_id || policy_id === undefined || !samples || !Array.isArray(samples)) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: oracle_id, policy_id, samples',
        });
      }

      const observations = getObservationsV3();
      let inserted = 0;
      let alreadyPresent = 0;
      let rejectedInvalid = 0;

      for (const sample of samples) {
        if (!sample.epoch_time || !sample.sample_hash) {
          rejectedInvalid++;
          continue;
        }

        const docId = `${policy_id}:${sample.epoch_time}`;
        
        try {
          const result = await observations.updateOne(
            { _id: docId },
            {
              $setOnInsert: {
                policy_id,
                epoch_time: sample.epoch_time,
                location_key: location_key || '',
                event_type: event_type || '',
                fields: sample.normalized_fields || {},
                sample_hash: sample.sample_hash,
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

      res.json({
        success: true,
        inserted,
        already_present: alreadyPresent,
        rejected_invalid: rejectedInvalid,
        total_received: samples.length,
      });
    } catch (error) {
      console.error('Error processing observations batch:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process observations batch',
      });
    }
  });

  /**
   * POST /v1/snapshots
   * Receive snapshot from OCW
   */
  app.post('/v1/snapshots', async (req: Request, res: Response) => {
    try {
      // Validate HMAC signature
      const authResult = validateV3Signature(req);
      if (!authResult.valid) {
        return res.status(401).json({
          success: false,
          error: authResult.error,
        });
      }

      const { oracle_id, policy_id, observed_until, agg_state, commitment, nonce } = req.body;

      // Validate required fields
      if (!oracle_id || policy_id === undefined || observed_until === undefined || !commitment) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: oracle_id, policy_id, observed_until, commitment',
        });
      }

      const snapshots = getSnapshotsV3();
      const docId = `${policy_id}:${observed_until}`;

      const result = await snapshots.updateOne(
        { _id: docId },
        {
          $setOnInsert: {
            policy_id,
            observed_until,
            agg_state: agg_state || {},
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
  app.get('/v1/observations/:policyId', async (req: Request, res: Response) => {
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
  app.get('/v1/snapshots/:policyId', async (req: Request, res: Response) => {
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
  app.get('/v1/stats', async (req: Request, res: Response) => {
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
}

