/**
 * Plant-floor operations routes.
 *
 * Exposes the enriched line-status view (line_status LEFT JOIN work_orders_app),
 * KPI summary, manual work-order insertion, and a recent work-orders list.
 *
 * Key behaviours:
 *   - GET  /api/operations/lines          → enriched line status (state + action taken)
 *   - GET  /api/operations/summary        → KPI aggregates
 *   - POST /api/operations/work-orders    → manual insert (insert new rows)
 *   - GET  /api/operations/work-orders    → recent work orders
 */
import type { Application, Request, Response } from 'express';
import type { AppDb } from '../db/index.js';
import {
  getEnrichedLineStatus,
  getLinesSummary,
  insertWorkOrder,
  getRecentWorkOrders,
} from '../db/queries/maintenance.js';

export function registerOperationsRoutes(
  app: Application,
  deps: { db: AppDb },
): void {
  const { db } = deps;

  // ── Enriched line status (state table + writeback join) ────────────────
  app.get('/api/operations/lines', async (req: Request, res: Response) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const plantId = req.query.plant_id ? String(req.query.plant_id) : undefined;
    const lines = await getEnrichedLineStatus(db, { status, plantId });
    res.json(lines);
  });

  // ── KPI summary ───────────────────────────────────────────────────────
  app.get('/api/operations/summary', async (_req: Request, res: Response) => {
    const summary = await getLinesSummary(db);
    res.json(summary);
  });

  // ── Insert a new work order (manual row insertion from the UI) ────────
  app.post('/api/operations/work-orders', async (req: Request, res: Response) => {
    const {
      line_id,
      action_type,
      part_id,
      drafted_work_order,
      memo,
      predicted_downtime_cost_avoided_usd,
    } = req.body as {
      line_id: string;
      action_type: 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
      part_id?: string | null;
      drafted_work_order: string;
      memo?: string | null;
      predicted_downtime_cost_avoided_usd?: number | null;
    };

    if (!line_id || !action_type || !drafted_work_order) {
      res.status(400).json({
        error: 'line_id, action_type, and drafted_work_order are required.',
      });
      return;
    }

    // Derive user email from the OBO context (Express request).
    const userEmail =
      (req as unknown as { userEmail?: string }).userEmail ??
      (req.headers['x-forwarded-email'] as string | undefined) ??
      'unknown';

    const result = await insertWorkOrder(db, {
      lineId: line_id,
      actionType: action_type,
      partId: part_id ?? null,
      draftedWo: drafted_work_order,
      memo: memo ?? null,
      predictedDowntimeCostAvoidsUsd: predicted_downtime_cost_avoided_usd ?? null,
      userEmail,
    });

    res.status(201).json({ ok: true, action_id: result.actionId });
  });

  // ── Recent work orders ────────────────────────────────────────────────
  app.get('/api/operations/work-orders', async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const orders = await getRecentWorkOrders(db, limit);
    res.json(orders);
  });
}
