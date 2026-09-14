/**
 * The backup panel's data and actions.
 *
 * Deliberately independent of `useGardenData`. This is the one feature she
 * reaches for when things are going wrong, so it must not be downstream of the
 * garden having loaded successfully — an add-on whose garden will not load is
 * precisely when "save a copy" and "put my file back" need to work.
 *
 * The restore flow is two steps and stays two steps: `review` reads the file
 * and produces something to show her, and `confirm` is what actually sends it.
 * Nothing destructive happens between picking a file and pressing the second
 * button, and there is no code path where picking a file alone can change
 * anything.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BackupStatusBody, RestoreResultBody, SafetyCopySummary } from '../types';
import { ApiError, fetchBackupStatus, fetchSafetyCopyText, restoreGarden } from '../lib/apiClient';
import type { ApiIssue } from '../lib/apiClient';
import { formatDay, reviewBackupFile } from '../lib/backup';
import type { BackupPreview } from '../lib/backup';

export interface BackupState {
  /** `null` while loading, or when the server could not be asked. */
  status: BackupStatusBody | null;
  statusError: string | null;
  /** The file she has chosen, read and summarised, awaiting confirmation. */
  pending: { fileName: string; preview: BackupPreview } | null;
  /** Why the chosen file was refused, in words she can act on. */
  fileError: string | null;
  isRestoring: boolean;
  restoreError: string | null;
  restoreIssues: ApiIssue[];
  /** The server's report of what it actually stored, after a restore. */
  result: RestoreResultBody | null;
  reload: () => void;
  review: (file: { name: string; text: () => Promise<string> }) => Promise<void>;
  /** Stages a pre-restore safety copy for the same preview-then-confirm flow. */
  reviewSafetyCopy: (copy: SafetyCopySummary) => Promise<void>;
  cancel: () => void;
  confirm: () => Promise<boolean>;
}

/**
 * @param onRestored Called after a successful restore, so the app can reload the
 * garden it is holding. Without it the restoring device would sit there showing
 * the garden it had a moment ago, which is the one device that should never be
 * confused about what just happened.
 */
export function useBackup(onRestored?: () => void): BackupState {
  const [status, setStatus] = useState<BackupStatusBody | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupState['pending']>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreIssues, setRestoreIssues] = useState<ApiIssue[]>([]);
  const [result, setResult] = useState<RestoreResultBody | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const next = await fetchBackupStatus();

        if (!cancelled) {
          setStatus(next);
          setStatusError(null);
        }
      } catch (error) {
        if (cancelled) return;

        // Not fatal to the panel. "Save a copy" is a plain link to the server
        // and works whether or not this read succeeded, and that is the button
        // that matters most when things are going wrong.
        setStatus(null);
        setStatusError(
          error instanceof ApiError ? error.message : 'Could not reach the garden server.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const cancel = useCallback(() => {
    setPending(null);
    setFileError(null);
    setRestoreError(null);
    setRestoreIssues([]);
  }, []);

  const review = useCallback(
    async (file: { name: string; text: () => Promise<string> }): Promise<void> => {
      setPending(null);
      setFileError(null);
      setRestoreError(null);
      setRestoreIssues([]);
      setResult(null);

      let text: string;

      try {
        text = await file.text();
      } catch {
        setFileError('That file could not be read from your device. Nothing has been changed.');
        return;
      }

      const review = reviewBackupFile(text);

      if (!review.ok) {
        setFileError(review.message);
        return;
      }

      setPending({ fileName: file.name, preview: review.preview });
    },
    [],
  );

  const reviewSafetyCopy = useCallback(
    async (copy: SafetyCopySummary): Promise<void> => {
      let text: string;

      try {
        text = await fetchSafetyCopyText(copy.id);
      } catch (error) {
        setPending(null);
        setFileError(
          error instanceof ApiError
            ? `${error.message} Nothing has been changed.`
            : 'That saved copy could not be read back. Nothing has been changed.',
        );
        return;
      }

      // Handed to exactly the same reader as a file she picked herself, so a
      // safety copy gets the same preview, the same refusals and the same
      // confirm button. It also means a corrupted safety copy is refused rather
      // than trusted for being ours.
      await review({
        name: `Your garden as it was on ${formatDay(copy.takenAt.slice(0, 10))}`,
        text: () => Promise.resolve(text),
      });
    },
    [review],
  );

  const confirm = useCallback(async (): Promise<boolean> => {
    if (!pending) return false;

    setIsRestoring(true);
    setRestoreError(null);
    setRestoreIssues([]);

    try {
      const body = await restoreGarden(pending.preview.document);

      setResult(body);
      setPending(null);
      // Refreshed so the panel's counts, its "last saved a copy" line and the
      // new safety copy are all what the server says, not what we assumed.
      reload();
      onRestored?.();
      return true;
    } catch (error) {
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError('Could not reach the garden server.', { kind: 'network' });

      setRestoreError(failure.message);
      setRestoreIssues(failure.issues);
      return false;
    } finally {
      setIsRestoring(false);
    }
  }, [onRestored, pending, reload]);

  return {
    status,
    statusError,
    pending,
    fileError,
    isRestoring,
    restoreError,
    restoreIssues,
    result,
    reload,
    review,
    reviewSafetyCopy,
    cancel,
    confirm,
  };
}
