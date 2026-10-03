import type { ManualMutation } from '@/autopilot/manualMutation';
import { useMutationDoubts } from '@/hooks/useMutationDoubts';

import QuarantinePanel from './QuarantinePanel';

/** The same explicit reconciliation is available directly on manual screens. */
export default function MutationProtection({
  mutation,
}: {
  mutation: ManualMutation;
}) {
  return <QuarantinePanel doubts={useMutationDoubts(mutation)} />;
}
