import { AuthStatus } from '@/api/auth';
import { DateTime, formatDate, formatTime, parkDate } from '@/datetime';

/**
 * The sign-in in words, with when it ends. "Valid" alone said nothing about
 * whether it would last the park day, which is the question asked of it.
 */
export function describeSession(
  status: AuthStatus,
  expires: number | undefined
): string {
  const at = expires === undefined ? undefined : DateTime.from(expires);
  const when =
    at &&
    `${formatTime(at.time)}${at.date === parkDate() ? '' : `, ${formatDate(at.date, 'short')}`}`;
  if (status === 'missing') return 'Not signed in';
  if (!when) return `Session: ${status.replaceAll('-', ' ')}`;
  if (status === 'valid') return `Signed in until ${when}`;
  if (status === 'expires-before-park-close') {
    return `Sign-in ends at ${when}, before park close`;
  }
  if (status === 'expired') return `Sign-in ended at ${when}`;
  return `Session: ${status.replaceAll('-', ' ')}`;
}
