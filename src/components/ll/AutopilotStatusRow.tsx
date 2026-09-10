import { use } from 'react';

import { MODE_TEXT } from '@/autopilot/status';
import TabsContext from '@/contexts/TabContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';

const acts = (target: {
  autoBook?: boolean;
  autoModify?: boolean;
  bookThenMove?: boolean;
  autoSwap?: boolean;
}) =>
  !!(
    target.autoBook ||
    target.autoModify ||
    target.bookThenMove ||
    target.autoSwap
  );

/**
 * A compact, tappable day-plan summary for tabs other than Today.
 *
 * The actual on/off control remains on Today. This is deliberately navigation
 * only: a footer mis-tap should never change booking behaviour.
 */
export default function AutopilotStatusRow() {
  const autopilot = use(TopAutopilotContext);
  const { active, changeTab } = use(TabsContext);

  if (!autopilot?.enabled || active.name === 'Today') return null;

  const armed = autopilot.targetsHere.filter(
    target => acts(target) && !target.paused
  ).length;
  const actionText = `${autopilot.bookingsRemaining} action${
    autopilot.bookingsRemaining === 1 ? '' : 's'
  } left`;

  return (
    <button
      className="w-full border-t border-white/25 bg-black/10 px-3 py-1.5 text-center text-xs"
      onClick={() => changeTab('Today')}
    >
      <span className="font-semibold">Autopilot:</span>{' '}
      {MODE_TEXT[autopilot.status.mode]}
      {autopilot.dryRun && ' · Dry run'} · {armed} armed · {actionText}
    </button>
  );
}
