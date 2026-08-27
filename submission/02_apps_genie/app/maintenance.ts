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

import { desc, sql, type AnyColumn } from 'drizzle-orm';
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
