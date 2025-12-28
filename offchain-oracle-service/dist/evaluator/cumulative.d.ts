/**
 * Cumulative rainfall evaluator for V2 policies
 */
import { Monitor } from '../db/mongo.js';
/**
 * Evaluate a single monitor and trigger/mature if conditions are met
 */
export declare function evaluateMonitor(monitor: Monitor): Promise<void>;
