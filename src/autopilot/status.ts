import { PollerStatus } from './usePoller';

/** Plain-language names for the poller's current cadence or stop state. */
export const MODE_TEXT: Record<PollerStatus['mode'], string> = {
  off: 'Off',
  idle: 'Watching',
  approach: 'Checking often',
  burst: 'Checking rapidly',
  stopped: 'Stopped after repeated errors',
};
