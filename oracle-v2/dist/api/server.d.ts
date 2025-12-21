/**
 * Express.js REST API server for V2 Oracle Service
 */
import { Application } from 'express';
/**
 * Start the REST API server
 */
export declare function startApiServer(port?: number): Promise<void>;
/**
 * Get Express app instance
 */
export declare function getApp(): Application | null;
