/**
 * The Settings view.
 *
 * These three preferences used to live in Home Assistant's **Settings →
 * Add-ons → Configuration** tab, which is an administrator's screen: it shows
 * entity ids next to a restart button, and getting to it means leaving the
 * garden entirely. They live here now, and the entity plumbing stayed behind —
 * which is why this page has exactly one editable card and one read-only one.
 *
 * ## Why this page renders when the garden does not
 *
 * It used to be reachable only once the garden had loaded, which was a known
 * wart and is now a defect, because this page holds the backup panel. Reaching
 * for a backup is something people do when things are already going wrong, and
 * a recovery tool that requires a healthy system is not a recovery tool.
 *
 * Note the split inside: the notification form still waits for its own data,
 * because a form that displays a guess about what is stored is worse than a
 * form that says it cannot tell. The backup panel does not, because its primary
 * action is a plain link to the server that works regardless.
 */
import { useCallback } from 'react';
import { SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { ViewHeader } from './ViewHeader';
import { NotificationSettingsForm } from './settings/NotificationSettingsForm';
import { IntegrationStatusPanel } from './settings/IntegrationStatusPanel';
import { BackupPanel } from './settings/BackupPanel';
import { useSettings } from '../hooks/useSettings';
import type { GardenSettings } from '../types';

export interface SettingsViewProps {
  /** Reloads the garden the app is holding once a restore has landed. */
  onRestored?: () => void;
}

export function SettingsView({ onRestored }: SettingsViewProps) {
  const settings = useSettings();
  const { save } = settings;

  const handleSave = useCallback(
    (next: GardenSettings) => {
      void save(next);
    },
    [save],
  );

  return (
    <div className="space-y-6">
      <ViewHeader
        icon={SlidersHorizontal}
        title="Settings"
        description="Decide whether a coming frost is worth a notification, keep a copy of your garden, and put one back."
      />

      {settings.phase === 'loading' && (
        <div
          role="status"
          className="rounded-2xl border border-panel-edge bg-panel p-6 text-sm text-stone-500 shadow-sm"
        >
          Reading your settings from the garden server…
        </div>
      )}

      {settings.phase === 'failed' && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-900 shadow-sm"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800">
            <TriangleAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold sm:text-base">Your settings could not be read</h3>
            <p className="mt-1 max-w-prose text-sm leading-relaxed">
              {settings.loadError} Nothing has been changed. Whatever was saved before is still
              what the frost warnings are using.
            </p>
          </div>
          <button
            type="button"
            onClick={settings.reload}
            className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50"
          >
            Try again
          </button>
        </div>
      )}

      {settings.phase === 'ready' && settings.saved !== null && (
        <NotificationSettingsForm
          saved={settings.saved}
          isSaving={settings.isSaving}
          saveError={settings.saveError}
          saveIssues={settings.saveIssues}
          savedAt={settings.savedAt}
          onSave={handleSave}
        />
      )}

      <IntegrationStatusPanel status={settings.status} />

      {/*
        Outside every conditional above. This is the one card on the page that
        has to render when the rest of the app is broken, because that is when
        somebody needs it.
      */}
      <BackupPanel onRestored={onRestored} />
    </div>
  );
}
