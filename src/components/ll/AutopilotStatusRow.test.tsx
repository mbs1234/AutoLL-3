import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import { AutopilotState } from '@/contexts/AutopilotContext';
import TabsContext from '@/contexts/TabContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';

import AutopilotStatusRow from './AutopilotStatusRow';

const state: AutopilotState = {
  enabled: true,
  setEnabled: () => {},
  status: { mode: 'approach', consecutiveFailures: 0, polls: 8 },
  targets: [],
  targetsHere: [{ experienceId: 'ride', autoBook: true }],
  isWatched: () => false,
  addTarget: () => {},
  removeTarget: () => {},
  replaceTargets: () => {},
  toggleAutoBook: () => {},
  toggleAutoModify: () => {},
  toggleBookThenMove: () => {},
  togglePaused: () => {},
  toggleAutoSwap: () => {},
  setTargetWindow: () => {},
  setTargetRank: () => {},
  togglePasskey: () => {},
  passkeyStatus: 'off',
  notifications: 'granted',
  requestNotifications: () => {},
  bookingLog: [],
  bookedCount: 0,
  bookingsRemaining: 2,
  actionBudget: 3,
  refillBudget: () => {},
  maxActionsPerDay: 3,
  setMaxActionsPerDay: () => {},
  requireWholeParty: false,
  setRequireWholeParty: () => {},
  dryRun: false,
  setDryRun: () => {},
  avoidOverlaps: true,
  setAvoidOverlaps: () => {},
  skipCounts: {},
  dropSummaries: [],
};

function setup(active = 'LL') {
  const changeTab = jest.fn();
  render(
    <TabsContext
      value={{
        tabs: [],
        active: { name: active, icon: null, component: () => null },
        changeTab,
        scrollPos: { get: () => 0, set: () => {} },
      }}
    >
      <TopAutopilotContext value={state}>
        <AutopilotStatusRow />
      </TopAutopilotContext>
    </TabsContext>
  );
  return changeTab;
}

describe('AutopilotStatusRow', () => {
  it('summarises the day plan and opens Today', () => {
    const changeTab = setup();
    const row = screen.getByRole('button', { name: /Autopilot:/ });
    expect(row).toHaveTextContent('Checking often · 1 armed · 2 actions left');
    fireEvent.click(row);
    expect(changeTab).toHaveBeenCalledWith('Today');
  });

  it('stays out of Today, where the full controls are already shown', () => {
    setup('Today');
    expect(
      screen.queryAllByRole('button', { name: /Autopilot:/ })
    ).toHaveLength(0);
  });
});
