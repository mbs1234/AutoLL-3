import { useId, useRef, useState, useSyncExternalStore } from 'react';

import { APP_NAME } from '@/appIdentity';
import {
  type Backup,
  RestoreRecoveryError,
  createBackup,
  describeLastBackup,
  describeSummary,
  getRestoreRecovery,
  lastBackupAt,
  readBackup,
  readFileText,
  recordBackup,
  recoverOriginalPlan,
  restoreBackup,
  shareBackup,
  summarize,
} from '@/autopilot/backup';
import { anyRunning, subscribeRunning } from '@/autopilot/running';
import Button from '@/components/Button';
import Overlay from '@/components/Overlay';
import Screen from '@/components/Screen';

interface Props {
  /** Reloads the page once a restore has landed. A seam: jsdom cannot navigate. */
  reload?: () => void;
}

/**
 * Get what this phone knows off it, before Safari deletes it -- and put it back.
 *
 * Its own screen rather than an item in the Settings menu, because iOS opens the
 * share sheet only as the direct result of a tap and the menu runs its items
 * fifty milliseconds after it closes. Here "Back up now" calls the share sheet
 * from inside the tap itself. See `shareBackup`.
 *
 * Restore shows what a picked file holds before it writes anything, and ends in
 * a reload: every screen already open still holds the plan it loaded, and would
 * write it back over the restored one. See `restoreBackup`.
 */
export default function BackupRestore({
  reload = () => location.reload(),
}: Props) {
  const [summary] = useState(() =>
    describeSummary(summarize(createBackup().data))
  );
  const [lastAt, setLastAt] = useState(lastBackupAt);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();

  const running = useSyncExternalStore(subscribeRunning, anyRunning);
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ name: string; backup: Backup }>();
  const [problem, setProblem] = useState<string>();
  const [restored, setRestored] = useState(false);
  // A failed restore that could not put the original plan back either. Module
  // state in `backup.ts`, so it is still here after leaving this screen.
  const [recovery, setRecovery] = useState(getRestoreRecovery);
  // What the last tap in the recovery notice did. Without it an export said
  // nothing, and a retry that failed again left the screen exactly as it was,
  // as though the tap had not registered.
  const [recoveryNote, setRecoveryNote] = useState<{
    text: string;
    error?: boolean;
  }>();
  const [failedRetries, setFailedRetries] = useState(0);
  const [recovered, setRecovered] = useState(false);
  const recoveryTitle = useId();
  // No second restore while the first one's original plan is still out: it
  // would be refused anyway, and the button said otherwise.
  const blocked = running || !!recovery;

  // Deliberately not async, and nothing before `shareBackup`. `Button` calls
  // this synchronously inside the tap (it awaits only when given `back`), so the
  // share sheet is opened by the gesture itself.
  const backUp = () => {
    const now = new Date();
    let backup;
    try {
      backup = createBackup(now);
    } catch (error) {
      setStatus({
        text: `Couldn't read this phone's data: ${message(error)}`,
        error: true,
      });
      return;
    }
    shareBackup(backup, now).then(
      outcome => {
        if (outcome === 'cancelled') {
          setStatus(undefined);
          return;
        }
        recordBackup(now);
        setLastAt(now);
        setStatus({
          text:
            outcome === 'shared'
              ? 'Backed up.'
              : 'Backed up to your downloads.',
        });
      },
      error => {
        setStatus({ text: `Couldn't back up: ${message(error)}`, error: true });
      }
    );
  };

  // Also inside the tap: a file picker opens only from a gesture too.
  const choose = () => {
    setProblem(undefined);
    fileInput.current?.click();
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Cleared so that picking the same file again still reports a change.
    input.value = '';
    if (!file) return;
    readFileText(file).then(
      text => {
        const reading = readBackup(text);
        if (reading.ok) {
          setPicked({ name: file.name, backup: reading.backup });
          setProblem(undefined);
        } else {
          setPicked(undefined);
          setProblem(reading.reason);
        }
      },
      error => {
        setPicked(undefined);
        setProblem(`Couldn't read that file: ${message(error)}`);
      }
    );
  };

  const restore = () => {
    if (!picked) return;
    try {
      restoreBackup(picked.backup);
      setRestored(true);
    } catch (error) {
      if (error instanceof RestoreRecoveryError) {
        // The recovery notice says what happened and what to do next. Saying
        // it here as well put the same message on the screen twice.
        setProblem(undefined);
        setRecovery(error);
        return;
      }
      setProblem(
        `Couldn't restore: ${message(error)} This phone's plan is as it was.`
      );
    }
  };

  // Inside the tap, like "Back up now": the share sheet opens only from one.
  const exportOriginal = () => {
    if (!recovery) return;
    shareBackup(recovery.backup).then(
      outcome => {
        // Closing the sheet exports nothing, and changes nothing here either.
        if (outcome === 'cancelled') return;
        setRecoveryNote({
          text:
            outcome === 'shared'
              ? 'Original plan exported.'
              : 'Original plan saved to your downloads.',
        });
      },
      error => {
        setRecoveryNote({
          text: `Couldn't export the original plan: ${message(error)}`,
          error: true,
        });
      }
    );
  };

  const retryRecovery = () => {
    try {
      recoverOriginalPlan();
    } catch (error) {
      if (error instanceof RestoreRecoveryError) {
        // Counted, so that each failed retry reads differently from the last.
        const tries = failedRetries + 1;
        setFailedRetries(tries);
        setRecoveryNote({
          text: `Still not recovered after ${tries} ${tries === 1 ? 'retry' : 'retries'}: storage refused part of the plan again.`,
          error: true,
        });
      } else {
        setRecoveryNote({
          text: `Couldn't retry: ${message(error)}`,
          error: true,
        });
      }
      return;
    }
    setRecovery(undefined);
    setRecoveryNote(undefined);
    setRecovered(true);
  };

  const now = new Date();
  return (
    <Screen title="Backup and Restore">
      <h3>On this phone</h3>
      <p>{summary}</p>
      <p className="text-sm text-gray-600">
        Last backup: {describeLastBackup(lastAt, now)}
        {lastAt &&
          `, ${lastAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
      </p>
      <Button type="full" className="mt-4" onClick={backUp}>
        Back up now
      </Button>
      <p className="mt-2 text-sm text-gray-600">
        Opens the share sheet, so you can save the file to Files, AirDrop it, or
        send it to a computer. Your Disney sign-in is never included.
      </p>
      {status && (
        <p
          role="status"
          className={`mt-3 text-sm ${status.error ? 'font-semibold text-red-700' : 'text-gray-700'}`}
        >
          {status.text}
        </p>
      )}
      <p className="mt-6 text-sm text-gray-600">
        Safari deletes what a website has stored after about a week of Safari
        use without a visit, and nothing warns you when it does. A backup is the
        only copy that survives that.
      </p>

      <h3 className="mt-8">Restore</h3>
      <p className="text-sm text-gray-600">
        Replaces this phone’s plan — the watch list, Time Search’s list, the
        party and starred attractions — with the file’s, and adds the drops the
        file has seen to this phone’s. The sign-in and the settings, dry run
        included, stay as they are.
      </p>
      {running && (
        <p className="mt-2 text-sm font-semibold text-red-700">
          Turn off Autopilot, and stop any Time Search, to restore.
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        aria-label="Backup file"
        tabIndex={-1}
        className="sr-only"
        onChange={onPick}
      />
      {picked ? (
        <div className="mt-3 rounded-lg border border-gray-300 p-3">
          <p className="font-semibold break-all">{picked.name}</p>
          <p className="text-sm text-gray-600">
            {describeExport(picked.backup)}
          </p>
          <p className="mt-1 text-sm">
            {describeSummary(summarize(picked.backup.data))}
          </p>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={restore} disabled={blocked}>
              Replace this phone’s plan
            </Button>
            <Button
              className="flex-1"
              color="bg-white text-gray-800"
              onClick={() => setPicked(undefined)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="full"
          className="mt-3"
          onClick={choose}
          disabled={blocked}
        >
          Choose a backup file
        </Button>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
          {problem}
        </p>
      )}
      {recovery && (
        <section
          role="alert"
          aria-labelledby={recoveryTitle}
          className="mt-3 rounded-sm bg-red-100 p-2 text-sm text-red-900"
        >
          <h3 id={recoveryTitle} className="font-semibold">
            The original plan isn’t fully back
          </h3>
          <p className="mt-1">
            The restore failed, and this phone’s plan could only partly be put
            back. Keep this page open: until the plan is recovered, this page
            holds its only complete copy, so export it first.
          </p>
          <p className="mt-1">
            Recovering puts the plan, and the drops seen, back exactly as they
            were before the restore, replacing any changes made since.
          </p>
          <p className="mt-1 text-xs">{recovery.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="small" onClick={exportOriginal}>
              Export original plan
            </Button>
            <Button type="small" onClick={retryRecovery}>
              Retry recovering original plan
            </Button>
          </div>
          {recoveryNote && (
            <p
              role="status"
              className={`mt-2 ${recoveryNote.error ? 'font-semibold' : ''}`}
            >
              {recoveryNote.text}
            </p>
          )}
        </section>
      )}

      {restored && (
        <ReloadPrompt title="Restored" reload={reload}>
          This phone now has the backup’s plan and party, and every drop either
          of them had seen. Reload the page to use them: the screens behind this
          one still show the old plan.
        </ReloadPrompt>
      )}
      {recovered && (
        <ReloadPrompt title="Original plan recovered" reload={reload}>
          This phone has its plan back as it was before the restore. Reload the
          page to use it: the screens behind this one may still show the failed
          restore.
        </ReloadPrompt>
      )}
    </Screen>
  );
}

/**
 * Holds the screen until a reload, after anything that rewrote the plan under
 * screens already open: each still holds the plan it loaded, and would write
 * it back over the new one.
 */
function ReloadPrompt({
  title,
  reload,
  children,
}: {
  title: string;
  reload: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <Overlay
      color="bg-white"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="max-w-sm text-center">
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <p className="mt-2">{children}</p>
        <p className="mt-2 text-sm text-gray-600">
          If you open {APP_NAME} from a bookmark, tap it again once the page has
          reloaded.
        </p>
        <Button type="full" className="mt-4" onClick={reload}>
          Reload now
        </Button>
      </div>
    </Overlay>
  );
}

/** "Backed up Feb 14, 3:04 PM · build abc1234" -- whatever of that the file says. */
function describeExport({ exportedAt, rev }: Backup): string {
  const at = new Date(exportedAt);
  const when = Number.isNaN(at.getTime())
    ? 'Backed up at an unknown time'
    : `Backed up ${at.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`;
  return rev ? `${when} · build ${rev.slice(0, 7)}` : when;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
