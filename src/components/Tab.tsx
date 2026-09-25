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
          {/* Above the tabs, never below them. Below, it appeared only while
              Autopilot ran and only off Today, so the tabs rode 28 px higher
              on every other tab and a thumb aimed at them met this row --
              which on NextLL ended the search. */}
          <AutopilotStatusRow />
          {/* The gear is the row's last item rather than laid over its end,
              where it covered part of NextLL. Five tabs and the gear fit a
              360 px phone. */}
          <div className="relative flex items-center justify-center">
            {tabs.map(tab => (
              <TabButton {...tab} key={tab.name} />
            ))}
            {footer}
          </div>
        </>
      }
      ref={ref}
    >
      {children}
    </Screen>
  );
}
