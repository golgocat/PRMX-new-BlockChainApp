/**
 * REST API routes for V2 Oracle Service
 */

import { Application, Request, Response } from 'express';
import { getMonitors, getBuckets, getEvidence } from '../db/mongo.js';

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
}

