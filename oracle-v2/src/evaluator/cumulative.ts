/**
 * Cumulative rainfall evaluator for V2 policies
 */

import { getBuckets, getMonitors, Bucket, Monitor } from '../db/mongo.js';
import { fetchPrecipitation } from '../accuweather/fetcher.js';
import { submitV2Report, checkV2ReportExists, V2Outcome } from '../chain/reporter.js';

/**
 * Evaluate a single monitor and trigger/mature if conditions are met
 */
export async function evaluateMonitor(monitor: Monitor): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  
  // Skip if not in monitoring state
  if (monitor.state !== 'monitoring') {
    return;
  }
  
  // Skip if coverage hasn't started yet
  if (now < monitor.coverage_start) {
    console.log(`⏳ Policy ${monitor.policy_id} coverage not started yet`);
    return;
  }
  
  // Check if report already submitted on-chain
  const alreadyReported = await checkV2ReportExists(monitor.policy_id);
  if (alreadyReported) {
    console.log(`⚠️ Policy ${monitor.policy_id} already has a report on-chain`);
    await getMonitors().updateOne(
      { _id: monitor._id },
      { $set: { state: 'reported', updated_at: new Date() } }
    );
    return;
  }
  
  // Fetch latest precipitation data
  const overlapStart = Math.max(
    monitor.coverage_start,
    monitor.last_fetch_at > 0 ? monitor.last_fetch_at - 7200 : monitor.coverage_start // 2h overlap
  );
  const fetchEnd = Math.min(now, monitor.coverage_end);
  
  console.log(`📡 Fetching precipitation for policy ${monitor.policy_id}:`);
  console.log(`   Location: ${monitor.location_key}`);
  console.log(`   Window: ${new Date(overlapStart * 1000).toISOString()} to ${new Date(fetchEnd * 1000).toISOString()}`);
  console.log(`   Coverage: ${new Date(monitor.coverage_start * 1000).toISOString()} to ${new Date(monitor.coverage_end * 1000).toISOString()}`);
  
  try {
    const records = await fetchPrecipitation(monitor.location_key, overlapStart, fetchEnd);
    console.log(`   ✅ Received ${records.length} records from AccuWeather API`);
    
    if (records.length === 0) {
      console.log(`   ⚠️  No precipitation records found in time window. This might be normal if there was no rain.`);
    }
    
    // Update buckets
    const buckets = getBuckets();
    let bucketsCreated = 0;
    for (const record of records) {
      const hourUtc = normalizeToHour(record.dateTime);
      const bucketId = `${monitor._id}:${hourUtc.replace(/[-:TZ]/g, '').slice(0, 10)}`;
      
      await buckets.updateOne(
        { _id: bucketId },
        {
          $set: {
            monitor_id: monitor._id,
            hour_utc: hourUtc,
            mm: Math.round(record.precipitationMm * 10), // Convert to tenths of mm
            raw_data: record.rawData,  // Store raw AccuWeather response
            fetched_at: new Date(),    // When this bucket was last updated
          }
        },
        { upsert: true }
      );
      bucketsCreated++;
      console.log(`   📦 Created/updated bucket ${bucketId}: ${record.precipitationMm}mm at ${record.dateTime}`);
    }
    
    console.log(`   📊 Created/updated ${bucketsCreated} buckets`);
    
    // Recompute cumulative rainfall
    const allBuckets = await buckets.find({ monitor_id: monitor._id }).toArray();
    const cumulativeMm = allBuckets.reduce((sum, b) => sum + b.mm, 0);
    console.log(`   💧 Total cumulative: ${cumulativeMm / 10}mm (from ${allBuckets.length} buckets)`);
    
    // Update monitor
    const monitors = getMonitors();
    await monitors.updateOne(
      { _id: monitor._id },
      {
        $set: {
          cumulative_mm: cumulativeMm,
          last_fetch_at: now,
          updated_at: new Date(),
        }
      }
    );
    
    console.log(`📊 Policy ${monitor.policy_id}: cumulative=${cumulativeMm/10}mm, strike=${monitor.strike_mm/10}mm`);
    
    // Check early trigger condition
    if (cumulativeMm >= monitor.strike_mm && now <= monitor.coverage_end) {
      console.log(`🎯 Policy ${monitor.policy_id} TRIGGERED! cumulative=${cumulativeMm/10}mm >= strike=${monitor.strike_mm/10}mm`);
      
      await monitors.updateOne(
        { _id: monitor._id },
        {
          $set: {
            state: 'triggered',
            trigger_time: now,
            updated_at: new Date(),
          }
        }
      );
      
      // Submit report
      const evidence = buildEvidence(monitor, allBuckets, cumulativeMm, now, 'Triggered');
      await submitV2Report(monitor.policy_id, 'Triggered', now, cumulativeMm, evidence);
      return;
    }
    
    // Check matured no-event condition
    if (now >= monitor.coverage_end) {
      console.log(`📅 Policy ${monitor.policy_id} MATURED (no event). cumulative=${cumulativeMm/10}mm < strike=${monitor.strike_mm/10}mm`);
      
      await monitors.updateOne(
        { _id: monitor._id },
        {
          $set: {
            state: 'matured',
            updated_at: new Date(),
          }
        }
      );
      
      // Submit report
      const evidence = buildEvidence(monitor, allBuckets, cumulativeMm, monitor.coverage_end, 'MaturedNoEvent');
      await submitV2Report(monitor.policy_id, 'MaturedNoEvent', monitor.coverage_end, cumulativeMm, evidence);
      return;
    }
    
  } catch (error) {
    console.error(`❌ Error evaluating policy ${monitor.policy_id}:`, error);
  }
}

/**
 * Build evidence JSON for a V2 report
 */
function buildEvidence(
  monitor: Monitor,
  buckets: Bucket[],
  cumulativeMm: number,
  observedAt: number,
  outcome: V2Outcome
): object {
  return {
    version: '2.0',
    policy_id: monitor.policy_id,
    market_id: monitor.market_id,
    outcome,
    observed_at: observedAt,
    observed_at_iso: new Date(observedAt * 1000).toISOString(),
    cumulative_mm: cumulativeMm,
    strike_mm: monitor.strike_mm,
    coverage_start: monitor.coverage_start,
    coverage_end: monitor.coverage_end,
    location_key: monitor.location_key,
    buckets: buckets.map(b => ({
      hour: b.hour_utc,
      mm: b.mm,
    })),
    generated_at: new Date().toISOString(),
  };
}

/**
 * Normalize datetime to hour start (ISO format)
 */
function normalizeToHour(dateTime: string): string {
  const d = new Date(dateTime);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13) + ':00:00Z';
}

