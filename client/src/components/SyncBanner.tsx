import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import type { GardenStatus } from '../hooks/useGardenData';

export interface SyncBannerProps {
  status: GardenStatus;
  onRetry: () => void;
}

type Tone = 'amber' | 'rose';

/**
 * Full class strings per tone. Tailwind scans source text literally, so these
 * are never assembled from fragments — a constructed name silently vanishes
 * from a production build.
 */
const TONES: Record<Tone, { wrapper: string; badge: string; body: string; button: string }> = {
  amber: {
    wrapper:
      'flex flex-wrap items-start gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm sm:p-5',
    badge: 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800',
    body: 'mt-1 max-w-prose text-sm leading-relaxed text-amber-800',
    button:
      'inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50',
  },
  rose: {
    wrapper:
      'flex flex-wrap items-start gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 shadow-sm sm:p-5',
    badge: 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700',
    body: 'mt-1 max-w-prose text-sm leading-relaxed text-rose-800',
    button:
      'inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-100 px-3 py-1.5 text-sm font-semibold text-rose-900 transition-colors hover:bg-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-rose-50',
  },
};

interface Notice {
  tone: Tone;
  offline: boolean;
  title: string;
  body: string;
  issues: { path: string; message: string }[];
}

function noticeFor(status: GardenStatus): Notice | null {
  const { saveError } = status;

  if (!saveError) {
    if (!status.isOnline && status.hasUnsavedChanges) {
      return {
        tone: 'amber',
        offline: true,
        title: 'This device is offline',
        body: 'What you have typed is still here and still on screen. It will be saved to the garden server as soon as the connection is back.',
        issues: [],
      };
    }

    return null;
  }

  switch (saveError.kind) {
    case 'network':
      return {
        tone: 'amber',
        offline: true,
        title: 'Not saved yet',
        body: status.isOnline
          ? 'This device cannot reach the garden server at the moment. Nothing has been lost — your latest changes are still here and will be sent as soon as it answers.'
          : 'This device is offline. Nothing has been lost — your latest changes are still here and will be sent as soon as the connection is back.',
        issues: [],
      };
    case 'stale':
      return {
        tone: 'amber',
        offline: false,
        title: 'Still catching up with another device',
        body: 'The garden kept changing somewhere else while this page was saving. Your changes are still here; try again in a moment.',
        issues: [],
      };
    case 'rejected':
      return {
        tone: 'rose',
        offline: false,
        title: 'The garden server would not accept that',
        body: `${saveError.message} Your changes are still on screen, so nothing is lost — adjust what it named and it will save.`,
        issues: saveError.issues.slice(0, 4),
      };
    default:
      return {
        tone: 'rose',
        offline: false,
        title: 'The garden server had a problem',
        body: `${saveError.message} Your changes are still here. Trying again usually settles it.`,
        issues: [],
      };
  }
}

/**
 * The one place a save problem is reported.
 *
 * It never suggests anything was lost, because nothing is: a failed write keeps
 * the value in local state, on screen, and queued for the next attempt.
 */
export function SyncBanner({ status, onRetry }: SyncBannerProps) {
  const notice = noticeFor(status);

  if (!notice) return null;

  const tone = TONES[notice.tone];
  const Icon = notice.offline ? CloudOff : TriangleAlert;

  return (
    <div role="status" className={tone.wrapper}>
      <span className={tone.badge}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold sm:text-base">{notice.title}</h3>
        <p className={tone.body}>{notice.body}</p>

        {notice.issues.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-rose-800">
            {notice.issues.map((issue) => (
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

      <button type="button" onClick={onRetry} className={tone.button}>
        <RefreshCw className={`h-4 w-4 ${status.isSaving ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
