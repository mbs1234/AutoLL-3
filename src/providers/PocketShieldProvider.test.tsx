import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { use } from 'react';

import PocketShieldContext from '@/contexts/PocketShieldContext';

import PocketShieldProvider from './PocketShieldProvider';

function Raiser() {
  const { setShielded } = use(PocketShieldContext);
  return (
    <button type="button" onClick={() => setShielded(true)}>
      Pocket it
    </button>
  );
}

describe('raising the shield from a screen inside it', () => {
  // The first version of this feature wired the context in `Merlock` by hand
  // and the button in `Today` separately. Nothing tested the two together, so
  // a screen reading the default no-op context would have looked exactly like
  // a button that does nothing.
  it('puts the shield on screen', () => {
    render(
      <PocketShieldProvider>
        <Raiser />
      </PocketShieldProvider>
    );
    expect(screen.queryByTestId('pocket-shield')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pocket it' }));
    expect(screen.getByTestId('pocket-shield')).toBeInTheDocument();
  });
});

/**
 * `Merlock` and `harness/HarnessApp.tsx` are two hand-mirrored provider trees.
 * The shield was added to one and not the other, so the harness -- the only
 * place this app can be driven without a Disney session -- exercised a build
 * without the feature and could not have caught a wiring mistake in it.
 *
 * Reading the sources is crude, and it is the only thing that fails when the
 * two drift apart.
 */
describe('the two provider trees', () => {
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8');

  it.each([['src/components/ll/Merlock.tsx'], ['harness/HarnessApp.tsx']])(
    'mounts the shield in %s',
    path => {
      expect(source(path)).toContain('<PocketShieldProvider>');
    }
  );

  // Without it the shield reads the default context and reports "Off" beside
  // an engine that is running.
  it.each([['src/components/ll/Merlock.tsx'], ['harness/HarnessApp.tsx']])(
    'mounts the top autopilot context in %s',
    path => {
      expect(source(path)).toContain('<TopAutopilotProvider>');
    }
  );
});
