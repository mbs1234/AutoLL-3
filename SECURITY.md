# Security notes

AutoLL-3 is a browser-resident client. A Disney OneID access token is used
only from the user's browser to make Disney requests; AutoLL-3 does not run an
application server or collect Disney passwords.

The token is retained in browser storage by default so a normal page reload
does not require another sign-in. **Session-only login** in Settings keeps the
current result in memory instead. This is a privacy convenience, not a way to
protect a token from code already executing on the same browser origin.

Before publishing, review the source revision, the required Check workflow,
and the generated `autoll3-release.json` / `autoll3-files.sha256` on the Pages
site. Do not paste tokens, OneID callback data, request headers, or browser
storage exports into issues.

The OneID responder bridge follows Disney's SDK protocol. Its message-origin
behavior must not be narrowed without a compatibility review of that protocol.
