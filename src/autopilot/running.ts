/**
 * Whether any autopilot engine is running, anywhere in the page.
 *
 * The main engine and every Time Search run their own `AutopilotProvider`, and
 * a search keeps running under a pushed screen: the navigator hides screens
 * rather than unmounting them. Each engine holds its plan in memory and writes
 * it back when it changes, so a restore that rewrote the plan underneath a
 * running one could be silently undone by its next save. A restore therefore
 * needs to know about every engine, not only the one whose context it can read.
 */

let running = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Count one engine as running until the returned function is called. Calling it
 * twice is harmless, so it can be an effect's cleanup under StrictMode.
 */
export function markRunning(): () => void {
  running++;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running--;
    notify();
  };
}

export function anyRunning(): boolean {
  return running > 0;
}

/** For `useSyncExternalStore`. */
export function subscribeRunning(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
