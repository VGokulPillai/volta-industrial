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
  WorkOrderRow,
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

/** Insert a new work order row (manual insert from the UI). */
export async function createWorkOrder(args: {
  line_id: string;
  action_type: MaintenanceAction;
  part_id?: string | null;
  drafted_work_order: string;
  memo?: string | null;
  predicted_downtime_cost_avoided_usd?: number | null;
}): Promise<{ ok: boolean; action_id: string }> {
  const res = await okOrThrow(
    await fetch('/api/operations/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }),
    '/api/operations/work-orders',
  );
  return res.json();
}

/** Fetch recent work orders. */
export async function fetchWorkOrders(
  limit = 20,
): Promise<WorkOrderRow[]> {
  const res = await okOrThrow(
    await fetch(`/api/operations/work-orders?limit=${limit}`),
    '/api/operations/work-orders',
  );
  return res.json();
}
