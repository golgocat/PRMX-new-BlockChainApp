/**
 * Scheduler for polling monitors and evaluating cumulative rainfall
 */
/**
 * Start the monitoring scheduler
 */
export declare function startScheduler(): Promise<void>;
/**
 * Stop the scheduler
 */
export declare function stopScheduler(): void;
/**
 * Get scheduler status
 */
export declare function isSchedulerRunning(): boolean;
