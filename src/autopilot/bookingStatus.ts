/** Every activity-log outcome, in one runtime and compile-time source. */
export const BOOKING_LOG_STATUSES = [
  'booked',
  'modified',
  'swapped',
  'failed',
  'unknown',
  'skipped',
  'dry-run',
] as const;

export type BookingLogStatus = (typeof BOOKING_LOG_STATUSES)[number];

const BOOKING_LOG_STATUS_SET = new Set<string>(BOOKING_LOG_STATUSES);

export function isBookingLogStatus(value: unknown): value is BookingLogStatus {
  return typeof value === 'string' && BOOKING_LOG_STATUS_SET.has(value);
}
