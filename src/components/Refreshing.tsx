/**
 * The small sign that data already on screen is being refreshed: a thin bar
 * pulsing along the top edge.
 *
 * Not `Spinner`, which covers the screen. That is right for a first load,
 * when there is nothing yet to read or tap, and was wrong for every refresh
 * after it: each one hid the screen being read, and blocked a tap on it, for
 * at least half a second. This leaves the screen alone and takes no taps. An
 * edge rather than a badge, because the header's height differs from screen
 * to screen, and a badge placed in it covered whatever sat there.
 */
export default function Refreshing() {
  return (
    <div
      role="status"
      aria-label="Refreshing…"
      className="pointer-events-none fixed inset-x-0 top-0 z-10 h-1 animate-pulse bg-white/80"
    />
  );
}
