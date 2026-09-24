import { useState } from 'react';

import {
  createBackup,
  describeLastBackup,
  describeSummary,
  lastBackupAt,
  recordBackup,
  shareBackup,
  summarize,
} from '@/autopilot/backup';
import Button from '@/components/Button';
import Screen from '@/components/Screen';

/**
 * Get what this phone knows off it, before Safari deletes it.
 *
 * Its own screen rather than an item in the Settings menu, because iOS opens the
 * share sheet only as the direct result of a tap and the menu runs its items
 * fifty milliseconds after it closes. Here "Back up now" calls the share sheet
 * from inside the tap itself. See `shareBackup`.
 *
 * Restore arrives beside this in the next step (ROADMAP item 12); this screen is
 * where it will live.
 */
export default function BackupRestore() {
  const [summary] = useState(() =>
    describeSummary(summarize(createBackup().data))
  );
  const [lastAt, setLastAt] = useState(lastBackupAt);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();

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
    </Screen>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
