/**
 * Plant-floor KPI cards: downtime exposure / critical lines / actions taken.
 * Drives the "live update" demo moment — when the agent writes a work order,
 * `dataMutated` fires, OperationsView refetches summary, and these cards tick.
 */
import { AlertTriangle, CheckCircle2, Activity } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { PlantFloorSummary } from '@/shared/types';

export function KpiCards({ summary }: { summary: PlantFloorSummary }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <Card
        label="Downtime Exposure"
        count={summary.criticalLines + summary.atRiskLines}
        value={summary.totalDowntimeExposure}
        icon={<AlertTriangle className="size-4" />}
        tone="danger"
        prefix="$"
      />
      <Card
        label="Critical Lines"
        count={summary.criticalLines}
        value={null}
        icon={<Activity className="size-4" />}
        tone="neutral"
      />
      <Card
        label="Actions Taken"
        count={summary.actionsTaken}
        value={null}
        icon={<CheckCircle2 className="size-4" />}
        tone="success"
      />
    </div>
  );
}

function Card({
  label,
  count,
  value,
  icon,
  tone,
  prefix,
}: {
  label: string;
  count: number;
  value: number | null;
  icon: React.ReactNode;
  tone: 'neutral' | 'success' | 'danger';
  prefix?: string;
}) {
  const pulse = usePulseOnChange(count);
  const toneClass =
    tone === 'success'
      ? 'text-[var(--success-subtle-foreground)]'
      : tone === 'danger'
        ? 'text-destructive'
        : 'text-foreground';
  const compactVal =
    value != null
      ? new Intl.NumberFormat(undefined, {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(value)
      : null;
  const fullVal =
    value != null
      ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : null;
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 sm:p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.12em] sm:tracking-[0.15em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 sm:mt-2 flex flex-col sm:flex-row sm:items-baseline gap-0 sm:gap-2">
        <div className="display text-2xl sm:text-3xl font-semibold text-foreground">
          {count.toLocaleString()}
        </div>
        {fullVal && (
          <div className="text-xs sm:text-sm text-muted-foreground">
            <span className="sm:hidden">{prefix}{compactVal}</span>
            <span className="hidden sm:inline">· {prefix}{fullVal}</span>
          </div>
        )}
      </div>
    </div>
  );
}
