# AutoLL-3

AutoLL-3 is a public testing line of
[AutoLL-2](https://github.com/mbs1234/AutoLL-2). It keeps AutoLL-2's Walt
Disney World Lightning Lane features, behavior, and limitations. This README
documents only what changed in AutoLL-3; use the
[AutoLL-2 README](https://github.com/mbs1234/AutoLL-2#readme) for normal
installation and feature instructions.

AutoLL-3 is unofficial, experimental software. It is not affiliated with or
endorsed by Disney, may stop working at any time, and is provided without
warranty. Keep the official Disney app as the source of truth for plans and
reservations.

## Install

Open the [AutoLL-3 setup page](https://mbs1234.github.io/AutoLL-3/) on the
phone you will use in the park, then install its bookmarklet or userscript.

AutoLL-3 is a separate build. It has its own sign-in and uses the `autoll3.*`
browser-storage namespace and `autoll3-` notification tags. It can therefore
be installed alongside AutoLL-2 without overwriting AutoLL-2's saved party,
watch list, budget, booking tracking, diagnostics, or alerts.

## Changes from AutoLL-2

### Safer, clearer sign-in

AutoLL-3 still signs in through Disney's OneID page and does not handle a
Disney password. The ordinary session flow has been tightened:

- OneID loading has a timeout, a useful error message, and a retry control.
- Closing Disney's sign-in sheet leaves it closed; it no longer immediately
  reopens.
- Saved session data is validated before use and includes a format version,
  issuing resort, and receipt time.
- A session that expires before 5:00 PM park time is rejected before an
  Autopilot run starts, with an explanation of why a fresh sign-in is needed.
- Several simultaneous unauthorized responses produce one clean transition
  back to sign-in rather than competing error states.
- Settings shows the current session state.

These changes concern normal session lifecycle only. They do not change the
protected device-validation behavior or booking rules inherited from
AutoLL-2.

### Session-only login option

The default remains persistent login: the OneID result is retained in browser
storage so a reload does not require signing in again.

Choose **Settings → Session-only login: On** to retain the current result only
in memory. It is removed when the page reloads or the browser restarts, so the
next session requires a new sign-in. This is a privacy choice, not protection
against a malicious script already executing on the same browser origin.

### Separate release identity

AutoLL-3 has its own:

- bookmarklet and GitHub Pages origin;
- responder-page URL;
- app name, short label, and browser tab identity;
- browser-storage and notification namespaces; and
- package/release-manifest names.

This avoids the accidental cross-loading and shared-state risks of using two
similar bookmarklet builds on one phone.

### NextLL held-reservation options

NextLL now starts by asking whether to book a new Lightning Lane or modify one
already held for the selected date. A held reservation can either use the
full return-time grid to seek a better time for the same attraction, or search
for a different Multi Pass attraction. Every attraction replacement requires
an explicit confirmation, and the search stops if its result cannot be safely
confirmed in Plans.

### Release and deployment controls

The AutoLL-3 release pipeline is independently verified and published:

- `main` is protected by the required `check` status check, linear-history
  rules, no force-pushes or deletion, and resolved-conversation requirements.
- CI runs the test suite, lint, typecheck, and production build.
- Deployment independently gates publication on typecheck and tests. If they
  fail, GitHub Pages continues serving the previous successful build.
- The deployed site includes `autoll3-release.json` and
  `autoll3-files.sha256`, recording the precise source revisions and hashes of
  the published payload.
- AutoLL-3 explicitly reads the inherited installer assets and runtime module
  from AutoLL-2 during deployment, rather than assuming those branches exist
  in this repository.
- Dependabot reviews npm and GitHub Actions dependency updates weekly.

The live release manifest is available at
<https://mbs1234.github.io/AutoLL-3/autoll3-release.json>.

## What did not change

Other than the NextLL held-reservation flow above, AutoLL-3 does not add new
booking, Autopilot, passkey, plan-check, timeline, drop-learning, polling, or
attraction-data features beyond AutoLL-2. Refer to AutoLL-2 for those features
and their operating instructions.

## Development

```bash
npm ci
npm run checkall
npm run test:ci
npm run build
```

See [SECURITY.md](SECURITY.md) for token-handling and release-verification
notes, and [FORK.md](FORK.md) for the inherited project structure and upstream
synchronization notes.

## License and acknowledgments

AutoLL-3 is **GPL-3.0-only** and is a modified AutoLL-2/BG1-derived build.
See AutoLL-2 and [FORK.md](FORK.md) for the fuller acknowledgments and upstream
history.
