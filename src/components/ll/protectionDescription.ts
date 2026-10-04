import type { QuarantinedMutation, SettledMutation } from '@/autopilot/lease';
import { ParkTime, formatDate, formatTime } from '@/datetime';

function shownTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return formatTime(ParkTime.from(value));
  } catch {
    return value;
  }
}

/** What a protection is or was about, for the panel and Activity's record. */
export function description(
  doubt: QuarantinedMutation | SettledMutation,
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
  if (doubt.kind === 'book') {
    return `Book ${nameOf(doubt.facilityId)}${to ? ` at ${to}` : ''} on ${date}`;
  }
  if (doubt.kind === 'cancel') {
    if (doubt.das) {
      return `Cancel a DAS selection at ${nameOf(doubt.facilityId)} on ${date}`;
    }
    // Saved before 1.9.0, which recorded a DAS cancellation like any other.
    if (doubt.v === undefined) {
      return `Cancel guests or a DAS selection at ${nameOf(doubt.facilityId)} on ${date}`;
    }
    return `Cancel guests at ${nameOf(doubt.facilityId)} on ${date}`;
  }
  return `Change ${nameOf(doubt.facilityId)} on ${date}`;
}
