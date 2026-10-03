import { use, useState } from 'react';

import ScreensContext, {
  FIRST_SCREEN_KEY,
  ScreenKeyContext,
} from '@/contexts/ScreensContext';

export default function useScreenState() {
  const { activeKey, prevScreen } = use(ScreensContext);
  // The position this screen sits at, from the navigator. Compared by key
  // rather than by element, because `withTabs` hands the nav stack a fresh
  // element on every tab change while staying at the same position -- so an
  // identity check on the element went false at the first tab switch and never
  // came back, and Home stopped refreshing itself on return to the tab for the
  // rest of the session.
  const ownKey = use(ScreenKeyContext);
  // Outside a navigator, the position it mounted at stands in. Inside one that
  // guess is wrong for a screen opened straight after going back, which then
  // thought itself hidden for good -- and a hidden screen may not send, so a
  // return time changed by hand never went to Disney.
  const [mountedKey] = useState(activeKey);
  const [mountedFirst] = useState(!prevScreen);
  return {
    isActiveScreen: activeKey === (ownKey ?? mountedKey),
    isFirstScreen:
      ownKey === undefined ? mountedFirst : ownKey === FIRST_SCREEN_KEY,
  };
}
