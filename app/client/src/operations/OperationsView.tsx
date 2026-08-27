/**
 * Plant Floor Operations page — the WRITE SURFACE for the Volta use case.
 *
 * Renders the at-risk-line backlog from Lakebase and stays in sync with the
 * agent's actions via the `dataMutated` pub/sub. When the agent writes a
 * maintenance action to `work_orders_app`, this page refetches automatically
 * — KPIs tick, lines show "action taken", and the work order list updates.
 *
 * Key behaviours:
 *   - Live line status enriched with the latest writeback (LEFT JOIN)
 *   - Manual work order insertion via the "New Work Order" form
 *   - Auto-refresh on every `dataMutated` event (agent or manual write)
 *   - Writeback → state linkage: committed work_orders_app rows appear in
 *     the enriched line_status view immediately on the next read.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sparkles, ArrowRight, Plus, RefreshCw, FileText } from 'lucide-react';
import {
  fetchLines,
  fetchSummary,
  createWorkOrder,
  fetchWorkOrders,
} from '@/lib/plantfloor';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type {
  PlantFloorLine,
  PlantFloorSummary,
  WorkOrderRow,
  LineStatus,
  MaintenanceAction,
} from '@/shared/types';
import { KpiCards } from './KpiCards';

export function OperationsView() {
  const [lines, setLines] = useState<PlantFloorLine[]>([]);
  const [summary, setSummary] = useState<PlantFloorSummary | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LineStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [showInsertForm, setShowInsertForm] = useState(false);
  const { config } = useSession();

  async function reload() {
    setLoading(true);
    try {
      const [lineData, summaryData, orderData] = await Promise.all([
        fetchLines({
          status: statusFilter === 'all' ? undefined : statusFilter,
        }),
        fetchSummary(),
        fetchWorkOrders(10),
      ]);
      setLines(lineData);
      setSummary(summaryData);
      setWorkOrders(orderData);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // Subscribe to dataMutated — auto-refresh when the agent writes.
  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        l.lineId.toLowerCase().includes(q) ||
        l.lineName.toLowerCase().includes(q) ||
        l.plantId.toLowerCase().includes(q) ||
        (l.plantName ?? '').toLowerCase().includes(q),
    );
  }, [lines, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Plant floor — operations queue
            </div>
            <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
              Work the at-risk lines.
            </h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Every red line is trending toward an unplanned stop — and every stop
            costs $22K an hour. Catch it before the shift ends.
          </p>
          <div className="flex flex-wrap gap-2">
            {config?.assistantScript?.[0] && (
              <button
                onClick={() =>
                  dockController.openAndSend(config.assistantScript[0].prompt)
                }
                className="text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-4 py-3 transition-all flex items-center gap-3 group"
              >
                <Sparkles className="size-4" style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-medium">Ask the assistant</span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </button>
            )}
            <button
              onClick={() => setShowInsertForm(!showInsertForm)}
              className="rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-4 py-3 transition-all flex items-center gap-2"
            >
              <Plus className="size-4" />
              <span className="text-sm font-medium">New Work Order</span>
            </button>
            <button
              onClick={() => void reload()}
              className="rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-4 py-3 transition-all flex items-center gap-2"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium">Refresh</span>
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        {summary && <KpiCards summary={summary} />}

        {/* Insert Work Order Form */}
        {showInsertForm && (
          <InsertWorkOrderForm
            lines={lines}
            onInserted={() => {
              setShowInsertForm(false);
              dataMutated.emit();
            }}
            onCancel={() => setShowInsertForm(false)}
          />
        )}

        {/* Status filter tabs */}
        <div className="flex gap-2">
          {(['all', 'critical', 'at_risk', 'healthy'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-lg border transition-all ${
                statusFilter === s
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card border-border text-muted-foreground hover:border-foreground/30'
              }`}
            >
              {s === 'all' ? 'All' : s === 'at_risk' ? 'At Risk' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lines by ID, name, or plant…"
          className="w-full max-w-md px-4 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Lines table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Line</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Plant</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Risk</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Downtime Exp.</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Action Taken</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Memo</th>
              </tr>
            </thead>
            <tbody>
              {loading && lines.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : filteredLines.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No lines found.</td></tr>
              ) : (
                filteredLines.map((line) => (
                  <tr key={line.lineId + ':' + line.plantId} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{line.lineName || line.lineId}</td>
                    <td className="px-4 py-3 text-muted-foreground">{line.plantName || line.plantId}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                        line.failureRiskScore >= 0.7 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        : line.failureRiskScore >= 0.4 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      }`}>
                        {(line.failureRiskScore * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      ${line.downtimeExposureUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={line.currentStatus} />
                    </td>
                    <td className="px-4 py-3">
                      {line.actionType ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                          {line.actionType.replace(/_/g, ' ')}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {line.actionMemo ? (
                        <span className="text-xs text-muted-foreground truncate block" title={line.actionMemo}>
                          <FileText className="size-3 inline mr-1" />
                          {line.actionMemo.length > 80
                            ? line.actionMemo.slice(0, 80) + '…'
                            : line.actionMemo}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Recent work orders */}
        {workOrders.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Recent work orders
            </h2>
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Line</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Action</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Approved By</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Memo</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map((wo) => (
                    <tr key={wo.id} className="border-b border-border/50">
                      <td className="px-4 py-2 font-medium">{wo.lineId}</td>
                      <td className="px-4 py-2">{wo.actionType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          {wo.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{wo.approvedBy ?? '—'}</td>
                      <td className="px-4 py-2 max-w-xs">
                        {wo.memo ? (
                          <span className="text-xs text-muted-foreground truncate block" title={wo.memo}>
                            {wo.memo.length > 60 ? wo.memo.slice(0, 60) + '…' : wo.memo}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground text-xs">
                        {new Date(wo.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LineStatus }) {
  const colors: Record<LineStatus, string> = {
    critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    at_risk: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    healthy: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${colors[status] ?? ''}`}>
      {status === 'at_risk' ? 'At Risk' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/** Inline form for inserting a new work order. */
function InsertWorkOrderForm({
  lines,
  onInserted,
  onCancel,
}: {
  lines: PlantFloorLine[];
  onInserted: () => void;
  onCancel: () => void;
}) {
  const [lineId, setLineId] = useState(lines[0]?.lineId ?? '');
  const [actionType, setActionType] = useState<MaintenanceAction>('pull_now');
  const [workOrderText, setWorkOrderText] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lineId || !workOrderText.trim()) {
      setErr('Line and work order text are required.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createWorkOrder({
        line_id: lineId,
        action_type: actionType,
        drafted_work_order: workOrderText,
        memo: memo || null,
      });
      onInserted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-5 space-y-4"
    >
      <div className="text-sm font-semibold">New Work Order</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Line</label>
          <select
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            {lines.map((l) => (
              <option key={l.lineId} value={l.lineId}>
                {l.lineName || l.lineId} ({l.plantId})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Action</label>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value as MaintenanceAction)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="pull_now">Pull Now</option>
            <option value="run_to_shift_end">Run to Shift End</option>
            <option value="expedite_parts_and_run">Expedite Parts</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1">Work Order</label>
        <textarea
          value={workOrderText}
          onChange={(e) => setWorkOrderText(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          placeholder="Describe the maintenance action…"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1">
          Memo / Analysis Summary (optional)
        </label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          placeholder="Brief summary of the analysis rationale…"
        />
      </div>
      {err && <div className="text-sm text-destructive">{err}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Inserting…' : 'Insert Work Order'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
