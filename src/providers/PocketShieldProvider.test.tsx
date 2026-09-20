import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { use, useState } from 'react';

import PocketShieldContext from '@/contexts/PocketShieldContext';
import NavProvider from '@/providers/NavProvider';

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
 * The bug this provider exists to make impossible.
 *
 * `NavProvider` captures its `children` ONCE, at mount, into a ref
 * (`{ elem: children, key: 0 }`) and thereafter renders that captured element
 * rather than the one its parent passes. State held ABOVE it is therefore
 * frozen at the value it had when the app mounted: the setter runs, the parent
 * re-renders, and nothing on screen changes.
 *
 * That is how the shield shipped. `Merlock` owned the state and rendered the
 * guard as NavProvider's children, so pressing "Pocket it" called a real
 * setter and produced no shield, no flash and no error -- while every other
 * button on that screen kept working, because those go through `NavContext`.
 *
 * The state has to live in a component BELOW NavProvider. The captured element
 * is then that component, and its own state re-renders it in place.
 */
describe('state above NavProvider', () => {
  function Raiser2() {
    const { setShielded } = use(PocketShieldContext);
    return (
      <button type="button" onClick={() => setShielded(true)}>
        Raise
      </button>
    );
  }

  it('is frozen, which is why the provider owns it instead', () => {
    function Frozen() {
      const [shielded, setShielded] = useState(false);
      return (
        <NavProvider>
          <PocketShieldContext value={{ shielded, setShielded }}>
            <Raiser2 />
            {shielded && <div data-testid="frozen-shield" />}
          </PocketShieldContext>
        </NavProvider>
      );
    }
    render(<Frozen />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
    // Not a claim that this is desirable. It is the trap, pinned, so the next
    // person to hoist this state sees why it cannot go there.
    expect(screen.queryByTestId('frozen-shield')).not.toBeInTheDocument();
  });

  it('works when the provider owns it, below NavProvider', () => {
    render(
      <NavProvider>
        <PocketShieldProvider>
          <Raiser2 />
        </PocketShieldProvider>
      </NavProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
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
