import type { LucideIcon } from 'lucide-react';

export interface SummaryStat {
  id: string;
  label: string;
  value: string;
}

export interface ViewSummaryCardProps {
  icon: LucideIcon;
  headline: string;
  body: string;
  stats: SummaryStat[];
}

/** Card that surfaces the headline numbers a view already knows about. */
export function ViewSummaryCard({ icon: Icon, headline, body, stats }: ViewSummaryCardProps) {
  return (
    <section className="rounded-2xl border border-panel-edge bg-panel p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900">{headline}</h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-stone-600">{body}</p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.id} className="rounded-2xl border border-panel-edge bg-panel-sunken px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {stat.label}
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
