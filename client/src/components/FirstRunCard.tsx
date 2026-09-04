import { Import, Sprout } from 'lucide-react';
import type { ApiIssue } from '../lib/apiClient';
import type { LocalGarden } from '../lib/localSnapshot';

export type FirstRunPhase = 'offer' | 'working' | 'merged' | 'failed';

export interface FirstRunCardProps {
  /** The copy sitting in this browser, or `null` when there is none. */
  local: LocalGarden | null;
  phase: FirstRunPhase;
  message: string | null;
  issues: ApiIssue[];
  /** Hand the offered garden to the server. */
  onImport: () => void;
  onDismiss: () => void;
}

const PRIMARY_BUTTON =
  'inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

const SECONDARY_BUTTON =
  'inline-flex items-center gap-2 rounded-xl border border-panel-edge bg-panel px-4 py-2.5 text-sm font-semibold text-stone-600 transition-colors hover:bg-panel-sunken hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-60';

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "6 seed packets, 2 beds and 5 harvest entries", skipping anything empty. */
function describeCounts(counts: LocalGarden['counts']): string {
  const parts = [
    counts.seeds > 0 ? plural(counts.seeds, 'seed packet', 'seed packets') : null,
    counts.beds > 0 ? plural(counts.beds, 'bed', 'beds') : null,
    counts.harvests > 0 ? plural(counts.harvests, 'harvest entry', 'harvest entries') : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0];

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The one-time offer to move a browser's garden onto the server.
 *
 * It appears only while the server is empty, and only until it is accepted. The
 * browser copy is never touched — not before, and not after — so an import that
 * goes wrong costs nothing and can simply be tried again.
 *
 * With no browser copy to move it offers the sample garden instead, which is
 * what the app used to open with. Both are opt-in: a garden tracker that
 * invents rows on first launch is a garden tracker you cannot trust.
 */
export function FirstRunCard({
  local,
  phase,
  message,
  issues,
  onImport,
  onDismiss,
}: FirstRunCardProps) {
  const busy = phase === 'working';

  // The server already had records — another device, or a bed added while
  // looking around — so the browser copy was added to them rather than
  // replacing anything. Nothing here failed, so nothing here is alarming.
  if (phase === 'merged') {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-200 text-emerald-800">
            <Sprout className="h-5 w-5" aria-hidden="true" />
          </span>

          <div className="min-w-0">
            <h3 className="text-base font-semibold text-emerald-900">
              Everything from this browser is now on your garden server
            </h3>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-emerald-800">
              There was already something saved there, so this browser&rsquo;s
              {local ? ` ${describeCounts(local.counts)}` : ' garden'} joined it. Nothing was
              replaced, and nothing was removed from this browser.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={onDismiss} className={SECONDARY_BUTTON}>
            Got it
          </button>
        </div>
      </section>
    );
  }

  const heading = local ? 'There is a garden saved in this browser' : 'Start with a sample garden?';

  const body = local
    ? `${describeCounts(local.counts)} were saved in this browser before the garden server existed. Copy them across and every device — the phone in the garden, the laptop indoors — sees the same garden.`
    : 'Your garden server is empty. Add a few example packets, beds and harvests to see how the three views fit together, or just start adding your own.';

  return (
    <section className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          {local ? (
            <Import className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Sprout className="h-5 w-5" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0">
          <h3 className="text-base font-semibold text-stone-900">{heading}</h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-stone-600">{body}</p>

          {local && (
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-stone-500">
              Nothing is deleted from this browser. Its copy stays exactly where it is as a
              fallback, whatever happens next.
            </p>
          )}

          {phase === 'failed' && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <p className="font-semibold">That did not go through.</p>
              <p className="mt-0.5 leading-relaxed">
                {message ?? 'The garden server would not accept it.'} Nothing was changed, on the
                server or in this browser.
              </p>

              {issues.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {issues.slice(0, 4).map((issue) => (
                    <li key={`${issue.path}-${issue.message}`} className="flex gap-2">
                      <code className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold">
                        {issue.path}
                      </code>
                      <span className="min-w-0">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onImport} disabled={busy} className={PRIMARY_BUTTON}>
          {busy
            ? 'Copying…'
            : local
              ? phase === 'failed'
                ? 'Try again'
                : 'Copy it to the server'
              : 'Plant the sample garden'}
        </button>
        <button type="button" onClick={onDismiss} disabled={busy} className={SECONDARY_BUTTON}>
          {local ? 'Not now' : 'No thanks'}
        </button>
      </div>
    </section>
  );
}
