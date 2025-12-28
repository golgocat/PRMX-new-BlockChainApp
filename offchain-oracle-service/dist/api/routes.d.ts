/**
 * REST API routes for PRMX Off-chain Oracle Service
 *
 * API Structure:
 *   /monitoring/* - V2 cumulative rainfall monitoring
 *   /ingest/*     - V3 OCW data ingestion
 *   /health       - Service health check
 */
import { Application } from 'express';
/**
 * Setup all API routes
 */
export declare function setupRoutes(app: Application): void;
