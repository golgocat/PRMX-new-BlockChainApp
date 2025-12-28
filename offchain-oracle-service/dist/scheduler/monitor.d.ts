/**
 * Scheduler for polling monitors and evaluating cumulative rainfall
 */
/**
 * Start the monitoring scheduler
 */
export declare function startScheduler(): Promise<void>;
/**
 * Run a single evaluation cycle for all active monitors
 * Exported for manual triggering via API
 */
export declare function runEvaluationCycle(): Promise<void>;
/**
 * Stop the scheduler
 */
export declare function stopScheduler(): void;
/**
 * Get scheduler status
 */
export declare function isSchedulerRunning(): boolean;
