/**
 * Maintenance / plant-floor Lakebase query helpers.
 *
 * These back the plant-floor agent's tools (server/agent/plantfloor.ts) and
 * the Operations write-surface. Everything here runs against Lakebase Postgres
 * (`app.*`). Reads hit the synced read-only mirrors (line_status, open_atrisk,
 * maintenance_recommendations, parts); the ONE write path is
 * `recordMaintenanceAction`, which is transactional and writes only to
 * `app.work_orders_app`.
 */

import { desc, eq, sql, type AnyColumn } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  lineStatus,
  openAtrisk,
  maintenanceRecommendations,
  workOrdersApp,
  type MaintenanceActionOption,
  type MaintenanceAuditEntry,
} from '../schema.js';

export type AtriskLine = {
  lineId: string;
  plantId: string;
  lineName: string;
  failureRiskScore: number;
  downtimeExposureUsd: number;
  partLocal: boolean;
  candidatePartId: string | null;
  partLeadTimeDays: number | null;
};

export type LineStatus = {
  lineId: string;
  plantId: string;
  lineName: string;
  plantName: string | null;
  region: string | null;
  failureRiskScore: number;
  downtimeExposureUsd: number;
  currentStatus: 'healthy' | 'at_risk' | 'critical';
};

export type Recommendation = {
  lineId: string;
  recommendedAction: 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
  predictedDowntimeCostUsd: number | null;
  actionRanking: MaintenanceActionOption[];
};

export type PartMatch = {
  partId: string;
  partName: string;
  partCategory: string | null;
  partLocal: boolean;
  leadTimeDays: number | null;
};

/**
 * The worst at-risk production line by downtime exposure. Reads
 * `app.open_atrisk` ordered by `downtime_exposure_usd DESC`.
 */
export async function worstAtriskLine(db: AppDb): Promise<AtriskLine | null> {
  const rows = await db
    .select({
      lineId: openAtrisk.lineId,
      plantId: openAtrisk.plantId,
      lineName: openAtrisk.lineName,
      failureRiskScore: openAtrisk.failureRiskScore,
      downtimeExposureUsd: openAtrisk.downtimeExposureUsd,
      partLocal: openAtrisk.partLocal,
      candidatePartId: openAtrisk.candidatePartId,
      partLeadTimeDays: openAtrisk.partLeadTimeDays,
    })
    .from(openAtrisk)
    .orderBy(desc(openAtrisk.downtimeExposureUsd))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The at-risk record for a specific line. Matches on `line_id` (the story uses
 * `LINE-04`; the generated id is `LINE-0004`, so match on either exact or the
 * zero-padded form). Falls back to null if the line is not in the at-risk set.
 */
export async function getAtriskLine(
  db: AppDb,
  lineId: string,
): Promise<AtriskLine | null> {
  const rows = await db
    .select({
      lineId: openAtrisk.lineId,
      plantId: openAtrisk.plantId,
      lineName: openAtrisk.lineName,
      failureRiskScore: openAtrisk.failureRiskScore,
      downtimeExposureUsd: openAtrisk.downtimeExposureUsd,
      partLocal: openAtrisk.partLocal,
      candidatePartId: openAtrisk.candidatePartId,
      partLeadTimeDays: openAtrisk.partLeadTimeDays,
    })
    .from(openAtrisk)
    .where(matchLineId(openAtrisk.lineId, lineId))
    .orderBy(desc(openAtrisk.downtimeExposureUsd))
    .limit(1);
  return rows[0] ?? null;
}

/** Current status row for a line from `app.line_status`. */
export async function getLineStatus(
  db: AppDb,
  lineId: string,
): Promise<LineStatus | null> {
  const rows = await db
    .select({
      lineId: lineStatus.lineId,
      plantId: lineStatus.plantId,
      lineName: lineStatus.lineName,
      plantName: lineStatus.plantName,
      region: lineStatus.region,
      failureRiskScore: lineStatus.failureRiskScore,
      downtimeExposureUsd: lineStatus.downtimeExposureUsd,
      currentStatus: lineStatus.currentStatus,
    })
    .from(lineStatus)
    .where(matchLineId(lineStatus.lineId, lineId))
    .orderBy(desc(lineStatus.failureRiskScore))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The ML model's ranked maintenance actions for a line from
 * `app.maintenance_recommendations`. Returns null if the line has not been
 * scored yet (the ML step / heuristic Gold table may not be built).
 */
export async function getRecommendation(
  db: AppDb,
  lineId: string,
): Promise<Recommendation | null> {
  const rows = await db
    .select({
      lineId: maintenanceRecommendations.lineId,
      recommendedAction: maintenanceRecommendations.recommendedAction,
      predictedDowntimeCostUsd: maintenanceRecommendations.predictedDowntimeCostUsd,
      actionRanking: maintenanceRecommendations.actionRanking,
    })
    .from(maintenanceRecommendations)
    .where(matchLineId(maintenanceRecommendations.lineId, lineId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Hybrid search over the parts catalog (`app.parts`) — the Lakebase Search
 * play. Combines keyword relevance (Postgres full-text `ts_rank` over
 * name + description) with a substring/trigram fallback so short queries still
 * match. Returns the top matches ranked by relevance.
 *
 * This is the app-portable implementation (standard Postgres FTS — works on any
 * Lakebase instance with no extra provisioning). The submission build
 * `submission/01_lakebase/search/setup_search.sql` shows the fuller native
 * hybrid setup (BM25 keyword via pg_search + pgvector semantic) that this query
 * upgrades to transparently once those extensions are enabled.
 */
export async function searchParts(
  db: AppDb,
  query: string,
): Promise<PartMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const result = await db.execute(sql`
    SELECT
      part_id,
      part_name,
      part_category,
      part_local,
      lead_time_days,
      ts_rank(
        to_tsvector('english', coalesce(part_name, '') || ' ' || coalesce(description, '')),
        websearch_to_tsquery('english', ${trimmed})
      ) AS rank
    FROM app.parts
    WHERE
      to_tsvector('english', coalesce(part_name, '') || ' ' || coalesce(description, ''))
        @@ websearch_to_tsquery('english', ${trimmed})
      OR part_name ILIKE ${'%' + trimmed + '%'}
      OR description ILIKE ${'%' + trimmed + '%'}
    ORDER BY rank DESC, part_local DESC, lead_time_days ASC NULLS LAST
    LIMIT 10
  `);
  const rows = result.rows as Array<{
    part_id: string;
    part_name: string;
    part_category: string | null;
    part_local: boolean;
    lead_time_days: number | null;
  }>;
  return rows.map((r) => ({
    partId: r.part_id,
    partName: r.part_name,
    partCategory: r.part_category,
    partLocal: r.part_local,
    leadTimeDays: r.lead_time_days === null ? null : Number(r.lead_time_days),
  }));
}

/**
 * Record an approved maintenance action to `app.work_orders_app`. Transactional;
 * the ONLY write path the app exposes. Inputs are a FILTER + drafted text (never
 * a list of ids). Stamps the approving user (OBO) and an append-only audit entry.
 */
export async function recordMaintenanceAction(
  db: AppDb,
  args: {
    lineId: string;
    actionType: 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
    partId: string | null;
    draftedWo: string;
    memo?: string | null;
    predictedDowntimeCostAvoidsUsd: number | null;
    userEmail: string;
  },
): Promise<{ actionId: string }> {
  const auditEntry: MaintenanceAuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: 'approved',
    notes: 'Maintenance action recorded',
    tool: 'execute_maintenance_action',
  };

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workOrdersApp)
      .values({
        lineId: args.lineId,
        actionType: args.actionType,
        partId: args.partId,
        draftedWo: args.draftedWo,
        memo: args.memo ?? null,
        predictedDowntimeCostAvoidsUsd: args.predictedDowntimeCostAvoidsUsd,
        status: 'approved',
        approvedBy: args.userEmail,
        auditTrail: [auditEntry],
        decidedAt: new Date(),
      })
      .returning({ id: workOrdersApp.id });
    return { actionId: inserted[0].id };
  });
}

/**
 * Match a line id column against a caller-supplied id, tolerating the story's
 * short form (`LINE-04`) vs the generated zero-padded id (`LINE-0004`). Compares
 * on the trailing numeric run so both forms resolve to the same line.
 */
function matchLineId(column: AnyColumn, lineId: string) {
  const digits = lineId.replace(/\D/g, '').replace(/^0+/, '') || '0';
  return sql`regexp_replace(${column}, '^\\D+0*', '') = ${digits}`;
}

// ============================================================================
// Enriched queries — line_status LEFT JOIN work_orders_app
// ============================================================================

export type EnrichedLine = {
  lineId: string;
  plantId: string;
  lineName: string;
  plantName: string | null;
  region: string | null;
  failureRiskScore: number;
  downtimeExposureUsd: number;
  currentStatus: 'healthy' | 'at_risk' | 'critical';
  /** From LEFT JOIN work_orders_app — null means no action taken yet. */
  actionType: string | null;
  actionStatus: string | null;
  actionMemo: string | null;
  actionId: string | null;
  actionAt: string | null;
};

/**
 * Line status enriched with the latest work-order action. The LEFT JOIN with
 * `work_orders_app` is the mechanism by which a committed writeback row is
 * reflected in the next read of the state table — requirement #3.
 */
export async function getEnrichedLineStatus(
  db: AppDb,
  filters?: { status?: string; plantId?: string },
): Promise<EnrichedLine[]> {
  const statusFilter = filters?.status
    ? sql` AND ls.current_status = ${filters.status}`
    : sql``;
  const plantFilter = filters?.plantId
    ? sql` AND ls.plant_id = ${filters.plantId}`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      ls.line_id,
      ls.plant_id,
      ls.line_name,
      ls.plant_name,
      ls.region,
      ls.failure_risk_score,
      ls.downtime_exposure_usd,
      ls.current_status,
      wo.action_type,
      wo.status         AS action_status,
      wo.memo           AS action_memo,
      wo.id             AS action_id,
      wo.created_at     AS action_at
    FROM app.line_status ls
    LEFT JOIN LATERAL (
      SELECT id, action_type, status, memo, created_at
      FROM   app.work_orders_app
      WHERE  line_id = ls.line_id
      ORDER  BY created_at DESC
      LIMIT  1
    ) wo ON true
    WHERE 1=1 ${statusFilter} ${plantFilter}
    ORDER BY ls.failure_risk_score DESC
  `);

  return (result.rows as Array<Record<string, unknown>>).map((r) => ({
    lineId: String(r.line_id),
    plantId: String(r.plant_id),
    lineName: String(r.line_name),
    plantName: r.plant_name ? String(r.plant_name) : null,
    region: r.region ? String(r.region) : null,
    failureRiskScore: Number(r.failure_risk_score),
    downtimeExposureUsd: Number(r.downtime_exposure_usd),
    currentStatus: String(r.current_status) as 'healthy' | 'at_risk' | 'critical',
    actionType: r.action_type ? String(r.action_type) : null,
    actionStatus: r.action_status ? String(r.action_status) : null,
    actionMemo: r.action_memo ? String(r.action_memo) : null,
    actionId: r.action_id ? String(r.action_id) : null,
    actionAt: r.action_at ? String(r.action_at) : null,
  }));
}

export type LinesSummary = {
  totalLines: number;
  criticalLines: number;
  atRiskLines: number;
  totalDowntimeExposure: number;
  actionsTaken: number;
};

/**
 * KPI aggregates for the plant-floor page.
 */
export async function getLinesSummary(db: AppDb): Promise<LinesSummary> {
  const result = await db.execute(sql`
    SELECT
      count(*)::int                                                  AS total_lines,
      count(*) FILTER (WHERE ls.current_status = 'critical')::int    AS critical_lines,
      count(*) FILTER (WHERE ls.current_status = 'at_risk')::int     AS at_risk_lines,
      coalesce(sum(ls.downtime_exposure_usd), 0)                     AS total_downtime_exposure,
      count(wo.id)::int                                              AS actions_taken
    FROM app.line_status ls
    LEFT JOIN LATERAL (
      SELECT id FROM app.work_orders_app
      WHERE line_id = ls.line_id
      ORDER BY created_at DESC LIMIT 1
    ) wo ON true
  `);
  const r = (result.rows as Array<Record<string, unknown>>)[0] ?? {};
  return {
    totalLines: Number(r.total_lines ?? 0),
    criticalLines: Number(r.critical_lines ?? 0),
    atRiskLines: Number(r.at_risk_lines ?? 0),
    totalDowntimeExposure: Number(r.total_downtime_exposure ?? 0),
    actionsTaken: Number(r.actions_taken ?? 0),
  };
}

/**
 * Insert a work order from the UI (manual row insertion).
 */
export async function insertWorkOrder(
  db: AppDb,
  args: {
    lineId: string;
    actionType: 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
    partId?: string | null;
    draftedWo: string;
    memo?: string | null;
    predictedDowntimeCostAvoidsUsd?: number | null;
    userEmail: string;
  },
): Promise<{ actionId: string }> {
  const auditEntry: MaintenanceAuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: 'approved',
    notes: 'Manually created via Plant Floor UI',
    tool: 'manual_insert',
  };
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workOrdersApp)
      .values({
        lineId: args.lineId,
        actionType: args.actionType,
        partId: args.partId ?? null,
        draftedWo: args.draftedWo,
        memo: args.memo ?? null,
        predictedDowntimeCostAvoidsUsd: args.predictedDowntimeCostAvoidsUsd ?? null,
        status: 'approved',
        approvedBy: args.userEmail,
        auditTrail: [auditEntry],
        decidedAt: new Date(),
      })
      .returning({ id: workOrdersApp.id });
    return { actionId: inserted[0].id };
  });
}

/**
 * Fetch recent work orders for display.
 */
export async function getRecentWorkOrders(
  db: AppDb,
  limit = 20,
): Promise<Array<{
  id: string;
  lineId: string;
  actionType: string;
  status: string;
  memo: string | null;
  draftedWo: string;
  approvedBy: string | null;
  createdAt: string;
}>> {
  const rows = await db
    .select({
      id: workOrdersApp.id,
      lineId: workOrdersApp.lineId,
      actionType: workOrdersApp.actionType,
      status: workOrdersApp.status,
      memo: workOrdersApp.memo,
      draftedWo: workOrdersApp.draftedWo,
      approvedBy: workOrdersApp.approvedBy,
      createdAt: workOrdersApp.createdAt,
    })
    .from(workOrdersApp)
    .orderBy(desc(workOrdersApp.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
}
