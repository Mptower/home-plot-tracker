/**
 * Saving a copy of the garden, and putting one back.
 *
 * ## Why this is in Settings, and why it is not gated behind a loaded garden
 *
 * Supervisor deletes an add-on's `/data` on uninstall, with no confirmation
 * step. Her whole garden — every seed packet, every bed layout, every harvest —
 * lives in one SQLite file in that directory. Until now the only copies anyone
 * was certain existed were two JSON files on the maintainer's laptop, which he
 * had to fetch with an access token and a Node script. This panel is the
 * difference between that and her being able to do it herself.
 *
 * The rest of Settings waits for its data to load before it renders a form,
 * which is right for a form: showing "notifications: on" when the server says
 * otherwise would be worse than showing nothing. This panel does the opposite
 * and renders whatever happens, because the moment somebody reaches for a
 * backup is the moment things are already going wrong. "Save a copy" is a plain
 * link to the server and works even if every other request on this page failed.
 */
import { useCallback, useRef, useState } from 'react';
import { Archive, Check, Download, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { exportUrl, fetchExportText, safetyCopyUrl } from '../../lib/apiClient';
import { describeAge, describeCounts, describeRestore, formatDay, suggestedFilename } from '../../lib/backup';
import { useBackup } from '../../hooks/useBackup';
import type { BackupCounts } from '../../lib/backup';

export interface BackupPanelProps {
  /** Reloads the garden the app is holding once a restore has landed. */
  onRestored?: () => void;
}

const EMPTY_COUNTS: BackupCounts = { seeds: 0, beds: 0, harvests: 0 };

export function BackupPanel({ onRestored }: BackupPanelProps) {
  const backup = useBackup(onRestored);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { review } = backup;

  const handleFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (file) void review(file);

      // Cleared so choosing the same file twice in a row still fires a change
      // event — which is exactly what happens when she picks the wrong file,
      // reads the summary, cancels and tries the same one again.
      event.target.value = '';
    },
    [review],
  );

  const showFile = useCallback(async () => {
    setCopied(false);

    try {
      setFileText(await fetchExportText());
    } catch {
      setFileText('The garden server could not be reached to produce a copy just now.');
    }
  }, []);

  const copyFile = useCallback(async () => {
    if (!fileText) return;

    try {
      await navigator.clipboard.writeText(fileText);
      setCopied(true);
    } catch {
      // Clipboard access can be refused, and there is nothing to be done about
      // it — but the text is already on screen and selectable, which was always
      // the part that could not fail.
      setCopied(false);
    }
  }, [fileText]);

  const counts = backup.status?.counts ?? EMPTY_COUNTS;
  const safetyCopies = backup.status?.safetyCopies ?? [];

  return (
    <section className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Archive className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900">Your garden, as a file</h3>
          <p className="text-sm text-stone-500">
            Keep a copy somewhere safe, and put it back if you ever need to.
          </p>
        </div>
      </div>

      {/* Save a copy ------------------------------------------------------ */}
      <div className="mt-5 rounded-2xl border border-panel-edge bg-panel-sunken p-4">
        <h4 className="text-sm font-bold text-stone-800">Save a copy</h4>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-stone-600">
          {backup.status
            ? `Your garden holds ${describeCounts(counts)}. `
            : 'This will save everything in your garden. '}
          The file is plain text — you can open it in Notepad and read it.
        </p>

        <p className="mt-2 text-sm font-medium text-stone-700">
          {backup.status ? describeAge(backup.status.lastExportAt) : ''}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/*
            A plain relative link to the server. Three things here are load-bearing
            and each was nearly got wrong:

            - **Not a Blob.** Android's companion app only handles `blob:` through
              an injected script that re-fetches the object URL asynchronously,
              which is why Home Assistant's own download helper has to defer
              `revokeObjectURL` by ten seconds on Android. A plain http(s) URL
              goes straight to the system download manager and skips all of it.
            - **No `target`, and no `window.open`.** On iOS any navigation with a
              null target frame is handed to *external Safari*, which has a
              different cookie store and no `ingress_session` — so it would
              silently save a sign-in page under a `.json` name. That is the exact
              shape of corruption this feature must not produce.
            - **Built with `apiUrl`,** so it resolves under the per-session ingress
              prefix. The Android companion app copies the page's cookies onto the
              download request, and the `ingress_session` cookie is scoped to
              `path=/api/hassio_ingress/`. A hardcoded `/api/export` would escape
              that path, arrive unauthenticated, and save the 401 body.

            `download` and `Content-Disposition` are both supplied: Android reads
            the header, iOS needs the attribute.
          */}
          <a
            href={exportUrl()}
            download={suggestedFilename()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Save a copy
          </a>

          <button
            type="button"
            onClick={() => void showFile()}
            className="inline-flex items-center gap-2 rounded-xl border border-panel-edge bg-panel px-3 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-panel-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            Show me the file
          </button>
        </div>

        {fileText !== null && (
          <div className="mt-3">
            <label htmlFor="backup-text" className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Your garden, in full
            </label>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-stone-500">
              Worth looking at once: if you can see your own varieties listed here, the file is
              really your garden. That is the one check that would catch a download that saved
              the wrong thing. If a download ever fails on your phone, save a copy from a
              computer instead.
            </p>
            <textarea
              id="backup-text"
              readOnly
              value={fileText}
              rows={10}
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-panel-edge bg-panel p-3 font-mono text-xs text-stone-700"
            />
            <button
              type="button"
              onClick={() => void copyFile()}
              className="mt-2 inline-flex items-center gap-2 rounded-xl border border-panel-edge bg-panel px-3 py-1.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-panel-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              {copied ? 'Copied' : 'Copy all of it'}
            </button>
          </div>
        )}
      </div>

      {/* Put a copy back -------------------------------------------------- */}
      <div className="mt-4 rounded-2xl border border-panel-edge bg-panel-sunken p-4">
        <h4 className="text-sm font-bold text-stone-800">Put a copy back</h4>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-stone-600">
          Choose a file and you will be shown what is in it before anything changes. Restoring
          replaces your whole garden, and a copy of what you have now is always saved first.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          className="sr-only"
        />

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-panel-edge bg-panel px-4 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-panel-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Choose a backup file
        </button>

        {backup.fileError && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="max-w-prose">{backup.fileError}</p>
          </div>
        )}

        {backup.pending && (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
            <p className="text-sm font-bold text-emerald-900">{backup.pending.fileName}</p>
            <p className="mt-1 text-sm text-emerald-900">
              This file holds {backup.pending.preview.summary}.
              {backup.pending.preview.includesSettings
                ? ' It also carries your notification settings.'
                : ''}
            </p>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-emerald-900">
              {describeRestore(backup.pending.preview.counts, counts)}
            </p>

            {!backup.pending.preview.recognised && (
              /*
                An older snapshot — the shape the maintainer's export script has
                been writing before every rollout — carries no header at all.
                Those files are the oldest certain copies of this garden, so the
                one thing this note must not do is imply something is wrong with
                them. It says what is missing and then says it does not matter.
              */
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-emerald-800">
                This file has no Home Plot Tracker header, so it is probably an older
                snapshot. That is fine — the garden inside it reads correctly and it can
                be restored.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={backup.isRestoring}
                onClick={() => void backup.confirm()}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {backup.isRestoring ? 'Restoring…' : 'Yes, replace my garden'}
              </button>
              <button
                type="button"
                onClick={backup.cancel}
                className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {backup.restoreError && (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900"
          >
            <p className="max-w-prose font-semibold">{backup.restoreError}</p>
            {backup.restoreIssues.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {backup.restoreIssues.slice(0, 5).map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>
                    <code className="font-mono">{issue.path}</code> — {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {backup.result && (
          <div
            role="status"
            className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-900"
          >
            <p className="max-w-prose">{backup.result.message}</p>
          </div>
        )}
      </div>

      {/* Undo ------------------------------------------------------------- */}
      {safetyCopies.length > 0 && (
        <div className="mt-4 rounded-2xl border border-panel-edge bg-panel-sunken p-4">
          <h4 className="text-sm font-bold text-stone-800">Undo a restore</h4>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-stone-600">
            Each of these is your garden exactly as it was, saved the moment before a restore
            replaced it. Putting one back asks you to confirm first, just like any other file —
            and saves another copy of what you have now, so this is never a one-way door.
          </p>
          <ul className="mt-3 space-y-2">
            {safetyCopies.map((copy) => (
              <li
                key={copy.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-panel-edge bg-panel px-3 py-2"
              >
                <span className="text-sm text-stone-700">
                  {formatDay(copy.takenAt.slice(0, 10))} — {describeCounts(copy.counts)}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void backup.reviewSafetyCopy(copy)}
                    className="inline-flex items-center gap-2 rounded-xl border border-panel-edge bg-panel-sunken px-3 py-1.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Put this back
                  </button>
                  <a
                    href={safetyCopyUrl(copy.id)}
                    download={`home-plot-tracker-${copy.takenAt.slice(0, 10)}-before-restore.json`}
                    className="inline-flex items-center gap-2 rounded-xl border border-panel-edge bg-panel-sunken px-3 py-1.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {backup.statusError && (
        <p className="mt-3 text-sm text-stone-500">
          {backup.statusError} Saving a copy still works — the button above asks the server
          directly.
        </p>
      )}
    </section>
  );
}
