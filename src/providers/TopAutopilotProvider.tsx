import { use } from 'react';

import AutopilotContext from '@/contexts/AutopilotContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';

/** Makes the main day-plan state available below temporary nested providers. */
export default function TopAutopilotProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const autopilot = use(AutopilotContext);
  return (
    <TopAutopilotContext value={autopilot}>{children}</TopAutopilotContext>
  );
}
