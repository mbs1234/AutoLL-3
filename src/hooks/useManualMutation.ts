import { useCallback, useEffect, useRef } from 'react';

import type { RequestControl } from '@/api/client';
import {
  type ManualMutation,
  runManualMutation,
} from '@/autopilot/manualMutation';
import { savedPartyScope } from '@/savedParty';

import useScreenState from './useScreenState';

/** Navigation may hide rather than unmount a screen. Neither may send stale work. */
export default function useManualMutation() {
  const { isActiveScreen } = useScreenState();
  const active = useRef(isActiveScreen);
  active.current = isActiveScreen;
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  return useCallback(
    <T>(
      mutation: ManualMutation,
      send: (control: RequestControl) => Promise<T>
    ) => {
      const party = savedPartyScope();
      return runManualMutation(mutation, send, {
        signal: controller.current.signal,
        authorize: () => active.current && savedPartyScope() === party,
      });
    },
    []
  );
}
