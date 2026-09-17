import { use, useState } from 'react';

import { resolveDoubt } from '@/autopilot/lease';
import type { QuarantinedMutation } from '@/autopilot/lease';
import Button from '@/components/Button';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import { ParkTime, formatDate, formatTime } from '@/datetime';

function shownTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return formatTime(ParkTime.from(value));
  } catch {
    return value;
  }
}

function description(
  doubt: QuarantinedMutation,
  nameOf: (id: string) => string
): string {
  const from = shownTime(doubt.from);
  const to = shownTime(doubt.to);
  const date = formatDate(doubt.date, 'short');
  if (doubt.kind === 'swap') {
    const gaining = doubt.gaining
      ? nameOf(doubt.gaining)
      : 'the replacement attraction';
    return `Swap ${nameOf(doubt.facilityId)} for ${gaining}${to ? ` at ${to}` : ''} on ${date}`;
  }
  if (doubt.kind === 'modify') {
    return `Move ${nameOf(doubt.facilityId)}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''} on ${date}`;
  }
  return `Change ${nameOf(doubt.facilityId)} on ${date}`;
}

/** Visible, operation-specific protection with an explicit manual escape. */
export default function QuarantinePanel({
  doubts,
}: {
  doubts: QuarantinedMutation[];
}) {
  const { experiences } = use(ExperiencesContext);
  const [confirming, setConfirming] = useState<string>();
  const [clearing, setClearing] = useState<string>();
  const [error, setError] = useState<string>();
  if (!doubts.length) return null;

  const nameOf = (id: string) =>
    experiences.find(experience => experience.id === id)?.name ?? id;
  const identity = (doubt: QuarantinedMutation) => `${doubt.key}:${doubt.id}`;

  async function clear(doubt: QuarantinedMutation) {
    setClearing(identity(doubt));
    setError(undefined);
    try {
      await resolveDoubt(doubt.key, doubt.id);
      setConfirming(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setClearing(undefined);
    }
  }

  return (
    <section
      aria-label="Unresolved Lightning Lane changes"
      className="mt-3 rounded-sm bg-red-100 p-2 text-sm text-red-900"
    >
      <p className="font-semibold">
        {doubts.length} unresolved Lightning Lane change
        {doubts.length === 1 ? '' : 's'} protected
      </p>
      <p className="mt-1">
        Disney did not return a definite answer. AutoLL-3 will not automatically
        move or swap these reservations until Plans shows the exact requested
        result or you confirm what happened.
      </p>
      <ul className="mt-2 space-y-2">
        {doubts.map(doubt => (
          <li className="rounded-sm bg-white/60 p-2" key={identity(doubt)}>
            <p>{description(doubt, nameOf)}</p>
            {confirming === identity(doubt) ? (
              <div className="mt-2">
                <p>
                  Clear this only after checking Disney's Plans. Clearing it
                  allows another automatic change to this reservation.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="small"
                    disabled={clearing === identity(doubt)}
                    onClick={() => void clear(doubt)}
                  >
                    {clearing === identity(doubt)
                      ? 'Clearing…'
                      : 'Clear this protection'}
                  </Button>
                  <Button
                    type="small"
                    disabled={clearing === identity(doubt)}
                    onClick={() => setConfirming(undefined)}
                  >
                    Keep protection
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="small"
                className="mt-2"
                onClick={() => setConfirming(identity(doubt))}
              >
                I checked Disney — resolve this
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2">Could not clear protection: {error}</p>}
    </section>
  );
}
