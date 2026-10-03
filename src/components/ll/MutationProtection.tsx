import type { ManualMutation } from '@/autopilot/manualMutation';
import useQuarantine from '@/autopilot/useQuarantine';

import QuarantinePanel from './QuarantinePanel';

/** The same explicit reconciliation is available directly on manual screens. */
export default function MutationProtection({
  mutation,
}: {
  mutation: ManualMutation;
}) {
  const doubts = useQuarantine();
  return (
    <QuarantinePanel
      doubts={doubts.filter(doubt =>
        mutation.keys.some(
          key => key === doubt.key || doubt.blockingKeys?.includes(key)
        )
      )}
    />
  );
}
