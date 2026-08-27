/**
 * REST helpers for the plant-floor operations domain.
 *
 * Hits the /api/operations/* routes registered in server/routes/operations.ts.
 * All data comes from Lakebase (enriched line status = line_status LEFT JOIN
 * work_orders_app).
 */
import { okOrThrow } from './api';
import type {
  PlantFloorLine,
  PlantFloorSummary,
  WorkflowDecision,
  MaintenanceAction,
} from '@/shared/types';

/** Enriched line status: line_status LEFT JOIN latest work_orders_app row. */
export async function fetchLines(
  filters: { status?: string; plantId?: string } = {},
): Promise<PlantFloorLine[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.plantId) qs.set('plant_id', filters.plantId);
  const res = await okOrThrow(
    await fetch(`/api/operations/lines?${qs}`),
    '/api/operations/lines',
  );
  return res.json();
}

/** KPI summary aggregates. */
export async function fetchSummary(): Promise<PlantFloorSummary> {
  const res = await okOrThrow(
    await fetch('/api/operations/summary'),
    '/api/operations/summary',
  );
  return res.json();
}

/** Save an assistant/operator draft as a proposal; this does not approve it. */
export async function createProposal(args: {
  line_id: string;
  proposed_action: MaintenanceAction;
  drafted_work_order: string;
  memo: string;
}): Promise<{ ok: boolean; workflow_id: string }> {
  const res = await okOrThrow(
    await fetch('/api/operations/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }),
    '/api/operations/proposals',
  );
  return res.json();
}

export async function decideProposal(args: {
  workflowId: string;
  decision: 'approved' | 'rejected' | 'corrected';
  correction?: string | null;
  corrected_action?: MaintenanceAction | null;
}): Promise<{ ok: boolean; next_read: WorkflowDecision }> {
  const res = await okOrThrow(
    await fetch(`/api/operations/proposals/${args.workflowId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: args.decision,
        correction: args.correction ?? null,
        corrected_action: args.corrected_action ?? null,
      }),
    }),
    '/api/operations/proposals/:id/decision',
  );
  return res.json();
}
