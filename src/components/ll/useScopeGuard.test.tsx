import { ep, hm, mk, renderResort } from '@/__fixtures__/ll';
import { WatchTarget } from '@/autopilot/watchlist';
import { AutopilotState } from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ParkContext from '@/contexts/ParkContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';
import { TODAY, TOMORROW, click, screen, see, setTime } from '@/testing';

import BookingDateSelect from './screens/Home/BookingDateSelect';
import ParkSelect from './screens/Home/ParkSelect';

/**
 * As found in the usability review: the park and date pickers are one setting
 * for the whole app and the engine follows them, so looking at another park's
 * times pointed a running Autopilot there, where nothing was armed.
 */
function renderPicker(
  picker: React.ReactNode,
  { enabled, targets }: { enabled: boolean; targets: WatchTarget[] }
) {
  const setPark = jest.fn();
  const setBookingDate = jest.fn();
  renderResort(
    <BookingDateContext value={{ bookingDate: TODAY, setBookingDate }}>
      <ParkContext value={{ park: mk, setPark }}>
        <TopAutopilotContext
          value={{ enabled, targetsHere: targets } as unknown as AutopilotState}
        >
          {picker}
        </TopAutopilotContext>
      </ParkContext>
    </BookingDateContext>
  );
  return { setPark, setBookingDate };
}

const armed: WatchTarget[] = [{ experienceId: hm.id, autoBook: true }];
const watchOnly: WatchTarget[] = [{ experienceId: hm.id }];

function pickPark(name: string) {
  click(see('Park'));
  click(name);
}

describe('useScopeGuard', () => {
  beforeEach(() => setTime('10:00'));

  it('switches park at once while Autopilot is off', () => {
    const { setPark } = renderPicker(<ParkSelect />, {
      enabled: false,
      targets: armed,
    });
    pickPark(ep.name);
    expect(setPark).toHaveBeenCalledWith(ep);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks first while Autopilot runs with something armed', () => {
    const { setPark } = renderPicker(<ParkSelect />, {
      enabled: true,
      targets: armed,
    });
    pickPark(ep.name);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      `It is watching 1 armed at ${mk.name} for today. Switching to ${ep.name} points it there instead`
    );
    expect(setPark).not.toHaveBeenCalled();

    click('Stay');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(setPark).not.toHaveBeenCalled();

    pickPark(ep.name);
    click('Switch');
    expect(setPark).toHaveBeenCalledWith(ep);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('switches at once when nothing running is armed', () => {
    const { setPark } = renderPicker(<ParkSelect />, {
      enabled: true,
      targets: watchOnly,
    });
    pickPark(ep.name);
    expect(setPark).toHaveBeenCalledWith(ep);
  });

  it('asks before changing the day while Autopilot runs', () => {
    const { setBookingDate } = renderPicker(<BookingDateSelect />, {
      enabled: true,
      targets: armed,
    });
    click('Today');
    click('2');
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(setBookingDate).not.toHaveBeenCalled();
    click('Switch');
    expect(setBookingDate).toHaveBeenCalledWith(TOMORROW);
  });
});
