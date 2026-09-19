import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import { ParkTime } from '@/datetime';

import {
  NextLLBookingActivity,
  NextLLTimeSearchActivity,
} from './NextLLActivity';

const idle = {
  running: false,
  cycles: 0,
  moves: 0,
  phase: 'idle' as const,
};

describe('NextLL booking activity', () => {
  it('renders an unknown outcome as a warning to check Disney Plans', () => {
    render(
      <NextLLBookingActivity
        active
        polls={1}
        entries={[
          {
            name: 'Big Thunder',
            at: new ParkTime(9, 47),
            status: 'unknown',
            detail: 'Network request failed',
          },
        ]}
        skipCounts={{}}
      />
    );
    fireEvent.click(screen.getByText('Activity'));
    expect(screen.getByText('no answer')).toBeVisible();
    expect(screen.getByText(/check Disney Plans/)).toHaveTextContent(
      'Big Thunder: Network request failed -- check Disney Plans'
    );
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
    expect(screen.queryByText(/skipped Big Thunder/)).not.toBeInTheDocument();
  });
});

describe('NextLL held-reservation activity', () => {
  it('stays out of the setup screen before a search starts', () => {
    render(<NextLLTimeSearchActivity search={idle} />);
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
  });

  it('summarises checks, changes and the live state', () => {
    render(
      <NextLLTimeSearchActivity
        search={{ ...idle, running: true, cycles: 8, moves: 1 }}
      />
    );
    fireEvent.click(screen.getByText('Activity'));
    expect(screen.getByText('8')).toBeVisible();
    expect(screen.getByText('1')).toBeVisible();
    expect(screen.getByText(/Searching for an acceptable/)).toBeVisible();
  });

  it('shows an offer waiting for approval', () => {
    render(
      <NextLLTimeSearchActivity
        search={{
          ...idle,
          running: true,
          pending: new ParkTime(14, 20),
        }}
      />
    );
    fireEvent.click(screen.getByText('Activity'));
    expect(screen.getByText(/Waiting for your approval/)).toHaveTextContent(
      '2:20 PM'
    );
  });

  it('keeps an unknown outcome and its error visible', () => {
    render(
      <NextLLTimeSearchActivity
        search={{
          ...idle,
          unresolved: new ParkTime(12, 40),
          stop: 'failed',
          phase: 'unknown',
          lastError: 'Network request failed',
        }}
      />
    );
    fireEvent.click(screen.getByText('Activity'));
    expect(screen.getByText(/Outcome unknown/)).toHaveTextContent('12:40 PM');
    expect(screen.getByText(/Last error/)).toHaveTextContent(
      'Network request failed'
    );
  });

  it('describes an unconfirmed stop as stopped, not still waiting', () => {
    render(
      <NextLLTimeSearchActivity
        search={{ ...idle, stop: 'unconfirmed', phase: 'awaiting' }}
        requested={new ParkTime(12, 40)}
      />
    );
    fireEvent.click(screen.getByText('Activity'));
    expect(screen.getByText(/accepted but is not yet confirmed/)).toBeVisible();
    expect(screen.queryByText(/Waiting for Plans/)).not.toBeInTheDocument();
  });
});
