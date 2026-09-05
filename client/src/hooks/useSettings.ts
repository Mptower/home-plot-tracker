/**
 * The Settings page's data.
 *
 * Two things are fetched here and they behave differently on purpose.
 *
 * **Her settings** are load-bearing: if they cannot be read, the form must not
 * pretend, because showing "notifications: on" when the server actually says
 * off would be worse than showing nothing. So this one has a real loading state
 * and a real error state.
 *
 * **The integration status** is not. It is a diagnostic panel, and a server too
 * old to have the endpoint, or a dropped request, is indistinguishable to a
 * gardener from "there is no Home Assistant here". So it resolves to `null` and
 * the panel says so calmly, in the same spirit as `useFrostWatch`.
 *
 * Saving is explicit rather than as-you-type. A toggle that saved on every
 * keystroke would fire a request per digit of a time field, and — worse —
 * "21:0" is a moment every two-key edit passes through, which the server
 * rightly rejects. So the form holds a draft and one button sends it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { GardenSettings, IntegrationStatusBody } from '../types';
import { ApiError, fetchIntegrationStatus, fetchSettings, saveSettings } from '../lib/apiClient';
import type { ApiIssue } from '../lib/apiClient';

/** Matches the server's own poll interval; nothing here changes faster. */
const STATUS_POLL_MS = 5 * 60 * 1000;

export type SettingsPhase = 'loading' | 'ready' | 'failed';

export interface SettingsState {
  phase: SettingsPhase;
  /** What the server last confirmed it has stored. `null` until loaded. */
  saved: GardenSettings | null;
  status: IntegrationStatusBody | null;
  isSaving: boolean;
  /** Why the initial load failed, when it did. */
  loadError: string | null;
  saveError: string | null;
  saveIssues: ApiIssue[];
  /** Set after a successful save, so the page can confirm it landed. */
  savedAt: number | null;
  reload: () => void;
  save: (settings: GardenSettings) => Promise<boolean>;
}

export function useSettings(): SettingsState {
  const [phase, setPhase] = useState<SettingsPhase>('loading');
  const [saved, setSaved] = useState<GardenSettings | null>(null);
  const [status, setStatus] = useState<IntegrationStatusBody | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveIssues, setSaveIssues] = useState<ApiIssue[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    setPhase('loading');
    setLoadError(null);

    void (async () => {
      try {
        const settings = await fetchSettings();

        if (cancelled) return;

        setSaved(settings);
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;

        setLoadError(
          error instanceof ApiError ? error.message : 'Could not reach the garden server.',
        );
        setPhase('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Polled rather than read once, so a Home Assistant that comes back while she
  // is looking at the page stops claiming to be down.
  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      const next = await fetchIntegrationStatus();

      if (!cancelled) setStatus(next);
    };

    void poll();

    const timer = setInterval(() => void poll(), STATUS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [reloadToken]);

  const save = useCallback(async (settings: GardenSettings): Promise<boolean> => {
    setIsSaving(true);
    setSaveError(null);
    setSaveIssues([]);

    try {
      const stored = await saveSettings(settings);

      // The server's copy, not the draft that was sent. They agree today; if
      // they ever stop agreeing, the page should show what is actually stored.
      setSaved(stored);
      setSavedAt(Date.now());
      return true;
    } catch (error) {
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError('Could not reach the garden server.', { kind: 'network' });

      setSaveError(failure.message);
      setSaveIssues(failure.issues);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    phase,
    saved,
    status,
    isSaving,
    loadError,
    saveError,
    saveIssues,
    savedAt,
    reload,
    save,
  };
}
