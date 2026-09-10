import { use, useLayoutEffect } from 'react';

import TabsContext from '@/contexts/TabContext';

import Screen, { ScreenProps } from './Screen';
import TabButton from './TabButton';
import AutopilotStatusRow from './ll/AutopilotStatusRow';

export default function Tab({
  title,
  buttons,
  subhead,
  children,
  ref,
}: ScreenProps) {
  const { tabs, scrollPos, footer } = use(TabsContext);

  useLayoutEffect(() => {
    const elem = ref?.current;
    if (!elem) return;
    elem.scroll(0, scrollPos.get());
    const updateScrollPos = () => scrollPos.set(elem.scrollTop);
    elem.addEventListener('scroll', updateScrollPos);
    return () => elem.removeEventListener('scroll', updateScrollPos);
  }, [scrollPos, ref]);

  return (
    <Screen
      title={title}
      buttons={buttons}
      subhead={subhead}
      footer={
        <>
          {/* Five tabs across a 360 px phone leave no room beside them, so
              which build this is now says so in the settings menu. */}
          <div className="relative flex items-center justify-center">
            {tabs.map(tab => (
              <TabButton {...tab} key={tab.name} />
            ))}
          </div>
          <AutopilotStatusRow />
          {footer}
        </>
      }
      ref={ref}
    >
      {children}
    </Screen>
  );
}
