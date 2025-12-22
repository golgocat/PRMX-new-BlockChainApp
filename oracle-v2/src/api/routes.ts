/**
 * REST API routes for V2 Oracle Service
 */

import { Application, Request, Response } from 'express';
import { getMonitors, getBuckets, getEvidence, clearAllData } from '../db/mongo.js';
import { runEvaluationCycle } from '../scheduler/monitor.js';
import { evaluateMonitor } from '../evaluator/cumulative.js';
import { fetchPrecipitation, fetchCurrentConditions, fetchHistorical24Hours } from '../accuweather/fetcher.js';

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
}

