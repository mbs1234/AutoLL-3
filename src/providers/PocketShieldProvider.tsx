import { useState } from 'react';

import PocketShield from '@/components/ll/PocketShield';
import PocketShieldContext from '@/contexts/PocketShieldContext';

/**
 * Owns whether the screen is guarded, and renders the guard.
 *
 * A provider rather than two lines in `Merlock`, because `Merlock`'s tree is
 * mirrored by hand in `harness/HarnessApp.tsx` and the first version of this
 * feature was added to only one of them -- so the harness exercised an app
 * without it and could not have caught a wiring mistake. Anything both trees
 * need belongs in one component that both mount.
 *
 * It must sit inside the autopilot providers, so the shield can report what the
 * engine is doing, and outside `NavProvider`'s stack, because that keeps pushed
 * screens mounted and merely hides them -- a shield rendered inside a screen
 * would be hidden along with it.
 */
export default function PocketShieldProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [shielded, setShielded] = useState(false);
  // Learned from a deliberate moving-target sequence and deliberately kept in
  // memory only. A wide thumb should not pay the escape cost every time the
  // phone is re-pocketed, while a reload starts from the strict defaults.
  const [wideTouchLearned, setWideTouchLearned] = useState(false);
  return (
    <PocketShieldContext value={{ shielded, setShielded }}>
      <div
        className="contents"
        inert={shielded}
        aria-hidden={shielded || undefined}
        data-testid="pocket-content"
      >
        {children}
      </div>
      {shielded && (
        <PocketShield
          onExit={() => setShielded(false)}
          wideTouchLearned={wideTouchLearned}
          onLearnWideTouch={() => setWideTouchLearned(true)}
        />
      )}
    </PocketShieldContext>
  );
}
