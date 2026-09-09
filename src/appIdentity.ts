/**
 * What this build calls itself in the browser chrome.
 *
 * More than one bg1-derived build can be installed on the same phone, and
 * they all run injected into `disneyworld.disney.go.com` -- so two of them
 * open at once are two tabs on the same origin, showing the same page title
 * and the same blank favicon. Nothing distinguished them before you opened
 * one and looked at what was on screen.
 *
 * The tab strip is where that question is actually asked, so this is where it
 * is answered. It is the human half of the `autoll3.*` storage namespace: that
 * one stops two builds overwriting each other's data, this one stops you
 * mistaking which is which.
 */
export const APP_NAME = 'AutoLL-3';

/**
 * The name where space is tight.
 *
 * The tab bar has four buttons across a phone's width and has to stay on one
 * line, so the full name does not fit beside them. `aLL-3` keeps the `LL`
 * that every one of these builds is named for and says which this is.
 */
export const APP_SHORT = 'aLL-3';

/**
 * A one-glyph favicon.
 *
 * An emoji rather than an image because it has to survive as a data URI --
 * the bookmarklet has no origin of its own to serve a file from -- and
 * because a single glyph is what actually reads at 16px in a tab strip.
 *
 * A flask rather than AutoLL's bolt: this is the line where things are tried
 * first, and the two have to be distinguishable at a glance rather than on
 * inspection, which two similar glyphs would not be.
 */
export const APP_ICON = '🧪';

function iconHref(glyph: string): string {
  // `text` with a `dy` rather than a centred `dominant-baseline`: baseline
  // handling differs enough between engines that the glyph lands off-canvas
  // in some of them.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<text y=".9em" font-size="90">${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Name the tab and give it an icon.
 *
 * Replaces the blank favicon the bookmarklet used to install. Blanking it was
 * only ever about removing Disney's, and a distinct one does that just as
 * well while also saying which build this is.
 *
 * Set once, on load. If Disney's own scripts later rewrite the title this
 * will not fight them for it -- an observer to keep winning that argument
 * would cost more than the problem.
 */
export function applyAppIdentity(doc: Document = document): void {
  doc.title = APP_NAME;
  const link = doc.createElement('link');
  link.rel = 'icon';
  link.href = iconHref(APP_ICON);
  doc.head.appendChild(link);
}
