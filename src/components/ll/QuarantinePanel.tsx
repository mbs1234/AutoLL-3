import { use, useEffect, useId, useRef, useState } from 'react';

import { attractionName } from '@/autopilot/attractionName';
import { resolveDoubt } from '@/autopilot/lease';
import type { QuarantinedMutation } from '@/autopilot/lease';
import Button from '@/components/Button';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ResortContext from '@/contexts/ResortContext';
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
  const resort = use(ResortContext);
  const [confirming, setConfirming] = useState<string>();
  const [clearing, setClearing] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const warningId = useId();
  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus();
  }, [confirming]);
  if (!doubts.length) return null;

  const nameOf = (id: string) => attractionName(id, experiences, resort);
  const identity = (doubt: QuarantinedMutation) => `${doubt.key}:${doubt.id}`;

  async function clear(doubt: QuarantinedMutation) {
    const item = identity(doubt);
    setClearing(item);
    setErrors(current => {
      const next = { ...current };
      delete next[item];
      return next;
    });
    try {
      await resolveDoubt(doubt.key, doubt.id);
      setConfirming(undefined);
    } catch (caught) {
      setErrors(current => ({
        ...current,
        [item]: caught instanceof Error ? caught.message : String(caught),
      }));
    } finally {
      setClearing(undefined);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 rounded-sm bg-red-100 p-2 text-sm text-red-900"
    >
      <h3 id={headingId} className="font-semibold">
        {doubts.length} unresolved Lightning Lane change
        {doubts.length === 1 ? '' : 's'} protected
      </h3>
      <p className="mt-1">
        Disney did not return a definite answer. AutoLL-3 will not automatically
        move or swap these reservations until Plans shows the exact requested
        result or you confirm what happened.
      </p>
      <ul className="mt-2 space-y-2">
        {doubts.map(doubt => (
          <li className="rounded-sm bg-white/60 p-2" key={identity(doubt)}>
            <p>{description(doubt, nameOf)}</p>
            {!doubt.durable && (
              <p className="mt-1 font-semibold" role="status">
                This protection is available only while this page remains open.
                Keep other AutoLL-3 tabs closed and check Disney Plans now.
              </p>
            )}
            {confirming === identity(doubt) ? (
              <div
                aria-labelledby={warningId}
                className="mt-2"
                role="alertdialog"
              >
                <p id={warningId}>
                  Clear this only after checking Disney's Plans. Clearing it
                  allows another automatic change to this reservation.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    ref={confirmButtonRef}
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
                    onClick={() => {
                      const item = identity(doubt);
                      setConfirming(undefined);
                      setErrors(current => {
                        const next = { ...current };
                        delete next[item];
                        return next;
                      });
                    }}
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
            {errors[identity(doubt)] && (
              <p className="mt-2" role="alert">
                Could not clear protection: {errors[identity(doubt)]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
