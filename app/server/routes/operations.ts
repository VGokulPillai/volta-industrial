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
  decideMaintenanceWorkflow,
  getBuild2Lines,
  getBuild2Summary,
  getWorkflow,
  proposeMaintenanceWorkflow,
} from '../db/queries/maintenance.js';
import { getCurrentUserEmail } from '../lib/user.js';

export function registerOperationsRoutes(
  app: Application,
  deps: { db: AppDb },
): void {
  const { db } = deps;

  // ── Enriched line status (state table + writeback join) ────────────────
  app.get('/api/operations/lines', async (req: Request, res: Response) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const plantId = req.query.plant_id ? String(req.query.plant_id) : undefined;
    const lines = await getBuild2Lines(db, { status, plantId });
    res.json(lines);
  });

  // ── KPI summary ───────────────────────────────────────────────────────
  app.get('/api/operations/summary', async (_req: Request, res: Response) => {
    const summary = await getBuild2Summary(db);
    res.json(summary);
  });

  // ── Draft a proposal. This does not approve or execute anything. ──────
  app.post('/api/operations/proposals', async (req: Request, res: Response) => {
    const {
      line_id,
      proposed_action,
      drafted_work_order,
      memo,
    } = req.body as {
      line_id: string;
      proposed_action: 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
      drafted_work_order: string;
      memo: string;
    };

    if (!line_id || !proposed_action || !drafted_work_order || !memo) {
      res.status(400).json({
        error: 'line_id, proposed_action, drafted_work_order, and memo are required.',
      });
      return;
    }
    const result = await proposeMaintenanceWorkflow(db, {
      lineId: line_id,
      proposedAction: proposed_action,
      draftedWorkOrder: drafted_work_order,
      memo,
      proposedBy: getCurrentUserEmail(req),
    });
    res.status(201).json({ ok: true, workflow_id: result.id });
  });

  // ── Explicit human approve / reject / correct transaction ────────────
  app.post('/api/operations/proposals/:id/decision', async (req, res) => {
    const { decision, correction, corrected_action } = req.body as {
      decision: 'approved' | 'rejected' | 'corrected';
      correction?: string | null;
      corrected_action?:
        | 'pull_now'
        | 'run_to_shift_end'
        | 'expedite_parts_and_run'
        | null;
    };
    if (!['approved', 'rejected', 'corrected'].includes(decision)) {
      res.status(400).json({ error: 'decision must be approved, rejected, or corrected' });
      return;
    }
    const committed = await decideMaintenanceWorkflow(db, {
      workflowId: req.params.id,
      decision,
      approver: getCurrentUserEmail(req),
      correction,
      correctedAction: corrected_action,
    });
    // Closed-loop verification reads the committed row back before responding.
    const nextRead = await getWorkflow(db, req.params.id);
    res.json({ ok: true, committed, next_read: nextRead });
  });

  app.get('/api/operations/proposals/:id', async (req, res) => {
    const workflow = await getWorkflow(db, req.params.id);
    if (!workflow) {
      res.status(404).json({ error: 'proposal not found' });
      return;
    }
    res.json(workflow);
  });
}
