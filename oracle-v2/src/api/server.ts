/**
 * Express.js REST API server for V2 Oracle Service
 */

import express, { Application } from 'express';
import cors from 'cors';
import { config } from '../config.js';
import { setupRoutes } from './routes.js';

let app: Application | null = null;

/**
 * Start the REST API server
 */
export async function startApiServer(port: number = 3001): Promise<void> {
  app = express();
  
  // Middleware
  app.use(cors());
  app.use(express.json());
  
  // Setup routes
  setupRoutes(app);
  
  // Start server
  return new Promise((resolve) => {
    app!.listen(port, () => {
      console.log(`🌐 REST API server running on http://localhost:${port}`);
      resolve();
    });
  });
}

/**
 * Get Express app instance
 */
export function getApp(): Application | null {
  return app;
}

