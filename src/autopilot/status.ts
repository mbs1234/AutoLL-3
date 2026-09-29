import { PollerStatus, StopReason } from './usePoller';

/** Plain-language names for the poller's current cadence or stop state. */
export const MODE_TEXT: Record<PollerStatus['mode'], string> = {
  off: 'Off',
  idle: 'Watching',
  approach: 'Checking often',
  burst: 'Checking rapidly',
  stopped: 'Stopped after repeated errors',
  waiting: 'Waiting: Disney asked to slow down',
};

/** A stopped loop in words, by why it stopped. */
const STOP_TEXT: Record<StopReason, string> = {
  failures: 'Stopped after repeated errors',
  refused: 'Stopped: Disney refused a request',
  throttled: 'Stopped: Disney asked to slow down',
  session: 'Stopped after a long search',
};

/** The status in words, naming why a stopped loop stopped. */
export function modeText(
  status: Pick<PollerStatus, 'mode' | 'stopReason'>
): string {
  return status.mode === 'stopped' && status.stopReason
    ? STOP_TEXT[status.stopReason]
    : MODE_TEXT[status.mode];
}
