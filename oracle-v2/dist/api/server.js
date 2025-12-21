/**
 * Express.js REST API server for V2 Oracle Service
 */
import express from 'express';
import cors from 'cors';
import { setupRoutes } from './routes.js';
let app = null;
/**
 * Start the REST API server
 */
export async function startApiServer(port = 3001) {
    app = express();
    // Middleware
    app.use(cors());
    app.use(express.json());
    // Setup routes
    setupRoutes(app);
    // Start server
    return new Promise((resolve) => {
        app.listen(port, () => {
            console.log(`🌐 REST API server running on http://localhost:${port}`);
            resolve();
        });
    });
}
/**
 * Get Express app instance
 */
export function getApp() {
    return app;
}
