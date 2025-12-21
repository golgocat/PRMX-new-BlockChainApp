/**
 * Scheduler for polling monitors and evaluating cumulative rainfall
 */

import { getMonitors, Monitor } from '../db/mongo.js';
import { evaluateMonitor } from '../evaluator/cumulative.js';
import { config } from '../config.js';

let intervalId: NodeJS.Timeout | null = null;

/**
 * Start the monitoring scheduler
 */
export async function startScheduler(): Promise<void> {
  console.log(`⏰ Starting scheduler with ${config.pollingIntervalMs / 1000}s interval`);
  
  // Run immediately on start
  await runEvaluationCycle();
  
  // Then schedule periodic runs
  intervalId = setInterval(runEvaluationCycle, config.pollingIntervalMs);
}

/**
 * Run a single evaluation cycle for all active monitors
 */
async function runEvaluationCycle(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`🔄 Running evaluation cycle at ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════');
  
  try {
    const monitors = getMonitors();
    
    // Find all monitors in 'monitoring' state
    const activeMonitors = await monitors.find({ state: 'monitoring' }).toArray();
    
    if (activeMonitors.length === 0) {
      console.log('📭 No active monitors to evaluate');
      return;
    }
    
    console.log(`📋 Evaluating ${activeMonitors.length} active monitors`);
    
    for (const monitor of activeMonitors) {
      await evaluateMonitor(monitor);
    }
    
    console.log('✅ Evaluation cycle complete');
    
  } catch (error) {
    console.error('❌ Error in evaluation cycle:', error);
  }
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('Scheduler stopped');
  }
}

/**
 * Get scheduler status
 */
export function isSchedulerRunning(): boolean {
  return intervalId !== null;
}

