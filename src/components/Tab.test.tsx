import { AutopilotState } from '@/contexts/AutopilotContext';
import TabsContext from '@/contexts/TabContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';
import { render, screen } from '@/testing';

import Tab from './Tab';

const tab = (name: string) => ({ name, icon: null, component: () => null });
const tabs = [
  tab('Today'),
  tab('LL'),
  tab('Times'),
  tab('Plans'),
  tab('NextLL'),
];

function renderTab(
  title = 'LL',
  {
    active = tabs[0]!,
    footer,
    running = false,
  }: {
    active?: (typeof tabs)[0];
    footer?: React.ReactNode;
    running?: boolean;
  } = {}
) {
  return render(
    <TopAutopilotContext
      value={
        running
          ? ({
              enabled: true,
              status: { mode: 'idle', polls: 3, consecutiveFailures: 0 },
              targetsHere: [],
              dryRun: false,
            } as unknown as AutopilotState)
          : undefined
      }
    >
      <TabsContext
        value={{
          tabs,
          active,
          changeTab: () => {},
          scrollPos: { get: () => 0, set: () => {} },
          footer,
        }}
      >
        <Tab title={title}>content</Tab>
      </TabsContext>
    </TopAutopilotContext>
  );
}

describe('Tab', () => {
  // Text inside an <h1> joins its accessible name, which is how every screen
  // in the suite is found.
  it('leaves the heading naming only the screen', () => {
    renderTab('Magic Kingdom');
    expect(
      screen.getByRole('heading', { name: 'Magic Kingdom', level: 1 })
    ).toBeVisible();
  });

  // Titled off the tab names on purpose: the LL screen is headed "LL" and
  // there is also a tab called "LL", so a bare text query matches both.
  it('renders every tab button', () => {
    renderTab('Magic Kingdom');
    for (const { name } of tabs) expect(screen.getByText(name)).toBeVisible();
  });

  // The build label used to sit beside the tabs; five tabs left it no room,
  // so it moved to the settings menu, and nothing else must pose as a tab.
  it('adds nothing to the tab bar but the tabs', () => {
    renderTab('Magic Kingdom');
    expect(screen.getAllByRole('button')).toHaveLength(tabs.length);
  });

  // The status row appears only while Autopilot runs, and only off Today.
  // Below the tabs it lifted them 28 px on every other tab, where a thumb
  // aimed at a tab met the row instead -- and on NextLL that ended the search.
  it('keeps the tabs the bottom row while Autopilot runs', () => {
    renderTab('LL', { active: tabs[1]!, running: true });
    const status = screen.getByText('Autopilot:').closest('button')!;
    const tabRow = screen.getByText('NextLL').closest('button')!.parentElement!;
    expect(tabRow.parentElement!.lastElementChild).toBe(tabRow);
    expect(
      status.compareDocumentPosition(tabRow) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // Laid over the end of the row, the gear covered part of NextLL.
  it('puts the footer control in the tab row, beside the tabs', () => {
    renderTab('LL', {
      footer: <button title="Settings Menu">gear</button>,
    });
    const gear = screen.getByTitle('Settings Menu');
    const tabRow = screen.getByText('NextLL').closest('button')!.parentElement!;
    expect(gear.parentElement).toBe(tabRow);
    expect(tabRow.lastElementChild).toBe(gear);
  });
});
