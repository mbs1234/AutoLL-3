import { use, useState } from 'react';

import ScreensContext from '@/contexts/ScreensContext';

export default function useScreenState() {
  const { activeKey, prevScreen } = use(ScreensContext);
  // Captured once, like `isFirstScreen`: the position this screen mounted at.
  // Compared by key rather than by element, because `withTabs` hands the nav
  // stack a fresh element on every tab change while staying at the same
  // position -- so an identity check on the element went false at the first tab
  // switch and never came back, and Home stopped refreshing itself on return
  // to the tab for the rest of the session.
  const [thisKey] = useState(activeKey);
  const [isFirstScreen] = useState(!prevScreen);
  return { isActiveScreen: activeKey === thisKey, isFirstScreen };
}
