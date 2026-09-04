/**
 * The Settings view.
 *
 * These three preferences used to live in Home Assistant's **Settings →
 * Add-ons → Configuration** tab, which is an administrator's screen: it shows
 * entity ids next to a restart button, and getting to it means leaving the
 * garden entirely. They live here now, and the entity plumbing stayed behind —
 * which is why this page has exactly one editable card and one read-only one.
 */
import { useCallback } from 'react';
import { SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { ViewHeader } from './ViewHeader';
import { NotificationSettingsForm } from './settings/NotificationSettingsForm';
import { IntegrationStatusPanel } from './settings/IntegrationStatusPanel';
import { useSettings } from '../hooks/useSettings';
import type { GardenSettings } from '../types';

export function SettingsView() {
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
        description="Decide whether a coming frost is worth a notification, and when it should wait until morning."
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
    </div>
  );
}
