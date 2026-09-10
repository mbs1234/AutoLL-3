import { createContext } from 'react';

import { AutopilotState } from './AutopilotContext';

/**
 * The day-plan Autopilot state, preserved above any temporary nested provider.
 *
 * NextLL deliberately mounts a second provider for its one-attraction search.
 * A shared status control must continue to describe the user's day plan, not
 * that short-lived search, so Merlock snapshots the outer provider here.
 */
export default createContext<AutopilotState | undefined>(undefined);
