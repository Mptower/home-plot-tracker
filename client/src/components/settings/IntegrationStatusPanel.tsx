import { Activity, CloudSun, Clock, Radio } from 'lucide-react';
import type { IntegrationStatusBody } from '../../types';
import type { ConnectionTone } from '../../lib/settings';
import { describeFrostRisk, describeObservedAt, summarizeConnection } from '../../lib/settings';

export interface IntegrationStatusPanelProps {
  status: IntegrationStatusBody | null;
}

/** Full literal class strings, one per tone — never assembled from parts. */
const DOTS: Record<ConnectionTone, string> = {
  ok: 'h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500',
  warn: 'h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500',
  quiet: 'h-2.5 w-2.5 shrink-0 rounded-full bg-stone-400',
};

interface StatusRowProps {
  icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
}

function StatusRow({ icon: Icon, label, value, hint }: StatusRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-panel-edge bg-panel-sunken px-4 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-panel text-stone-500">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
        <p className="mt-0.5 break-words text-sm font-semibold text-stone-800">{value}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * Read-only. Nothing here is a setting.
 *
 * It exists to answer one question: when no frost warning appears, is that
 * because nothing is coming, or because something is broken? From the garden
 * those look identical — a blank screen — and only one of them is worth
 * mentioning to anyone.
 *
 * Which is why "no frost forecast" is spelled out as an answer rather than left
 * as an absence, and why the timezone is here at all: a notification arriving at
 * the wrong hour is a timezone problem and nothing else, and this is the only
 * place that would say so.
 */
export function IntegrationStatusPanel({ status }: IntegrationStatusPanelProps) {
  const connection = summarizeConnection(status);
  const sensors = status?.sensors ?? [];

  return (
    <section className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900">Home Assistant</h3>
          <p className="text-sm text-stone-500">
            Nothing here is editable &mdash; it is for checking when something looks wrong.
          </p>
        </div>
      </div>

      <div
        role="status"
        className="mt-5 flex items-start gap-3 rounded-2xl border border-panel-edge bg-panel-sunken px-4 py-3.5"
      >
        <span className={`mt-1.5 ${DOTS[connection.tone]}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-800">{connection.label}</p>
          <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-stone-500">
            {connection.detail}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <StatusRow
          icon={CloudSun}
          label="Weather entity"
          value={status?.weatherEntity ?? 'None'}
          hint={
            status?.configured
              ? `Forecast last read ${describeObservedAt(status.forecastObservedAt ?? null).toLowerCase()}.`
              : undefined
          }
        />

        <StatusRow
          icon={Activity}
          label="Frost risk right now"
          value={describeFrostRisk(status)}
          hint="“None forecast” is an answer, not a failure: the forecast was read and nothing planted minds the low."
        />

        <StatusRow
          icon={Clock}
          label="Time zone"
          value={status?.timeZone ?? 'Unknown'}
          hint="Quiet hours are read against this clock."
        />

        <StatusRow
          icon={Radio}
          label="Notification service"
          value={status?.notifyService ?? 'None'}
        />
      </div>

      <div className="mt-3 rounded-2xl border border-panel-edge bg-panel-sunken px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Sensors published to Home Assistant
        </p>

        {sensors.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-500">
            None. Sensors are only published when the app runs as a Home Assistant add-on.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {sensors.map((sensor) => (
              <li
                key={sensor}
                className="rounded-lg bg-panel px-2 py-1 font-mono text-xs text-stone-600"
              >
                {sensor}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
