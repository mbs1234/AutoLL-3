# Building, verifying and releasing AutoLL-3

Moved out of `README.md` on 2026-09-21, when that file was cut back to an
introduction. Nothing here changed in the move; the branch-policy note in
particular is recorded nowhere else.

## Development

```bash
npm ci
npm run checkall     # tests, lint, typecheck
npm run harness      # the real screens against fake clients
npm run build
```

[FORK.md](../FORK.md) explains why a plain upstream build does not run and how
the deploy assembles one. [docs/PLAN.md](PLAN.md) is the booking-intelligence
roadmap and the record of what was decided; [docs/UX-PLAN.md](UX-PLAN.md) is the
same for the screens; [docs/FUTURE.md](FUTURE.md) is what remains, and
[ROADMAP.md](../ROADMAP.md) is what to do about it next.
[docs/USER-GUIDE.md](USER-GUIDE.md) is the guide written for whoever is holding
the phone, rather than for whoever is changing the code.
[SECURITY.md](../SECURITY.md) covers token handling.
[docs/SYNC.md in AutoLL-4](https://github.com/mbs1234/AutoLL-4/blob/main/docs/SYNC.md)
governs syncing the two builds.

## Verifying a build

Every deploy writes
[`autoll3-release.json`](https://mbs1234.github.io/AutoLL-3/autoll3-release.json)
and `autoll3-files.sha256` into the published site: the exact revisions the site
is assembled from, plus a SHA-256 of every file served. Point a browser at it
before a park day and confirm the build on your phone is the one the repository
says it is — or read the revision off the Settings menu, which names the commit
the bundle was built from.

The strongest check is that a local build of the same commit reproduces the
served bundle byte for byte:

```bash
npm run build
shasum -a 256 dist/bg1.js
curl -s https://mbs1234.github.io/AutoLL-3/bg1.js | shasum -a 256
```

Build the commit the manifest names, not a branch — the build embeds its own
revision, so a build of a different commit will differ for that reason alone.

## Releasing, and rolling back

A tagged release is that pair of manifest files together with the tag, and both
are attached to the
[release](https://github.com/mbs1234/AutoLL-3/releases) as well as served from
the site. Re-running the deploy workflow against a tag rebuilds the same site,
which is what makes a rollback a one-command operation rather than a rebuild
from memory:

```bash
gh workflow run deploy.yml --ref autoll3-v1.2.8
```

The release is not complete until `gh release view` lists both manifest files; a
pushed tag on its own does not satisfy the promise above.

A tag deploy restores the *served* site. It does not revert `main` — if the
build being rolled back is wrong rather than merely unlucky, revert the commit
too, or the next push to `main` re-ships it.

That rollback needs one repository setting that is easy to miss, because nothing
in this tree records it: the `github-pages` environment has a deployment branch
policy, and it permitted `main` only. A workflow dispatched against a tag
therefore built correctly and was then refused at the deploy step, with no steps
recorded and nothing naming the cause. A `tag: autoll3-v*` policy was added
beside the branch one. Anything forking this to a new repository has to add it
again.

## It depends on AutoLL-2 to publish

The inherited assets the published site is assembled from come from immutable
AutoLL-2 revisions pinned in the deploy workflow. AutoLL-2 must stay public for
AutoLL-3 to build a site; moving those pins is an explicit reviewed release
change rather than an implicit branch update.

## What the pipeline guarantees

`main` is protected: a pull request, a passing `check` run, linear history, no
force-pushes. The deploy gates independently on typecheck and the full test
suite, and if either fails the publish is skipped and Pages keeps serving the
build already on your phone.

A green pipeline is not evidence about the sensor path. No test in this
repository loads `src/api/sensor-data.ts` — `jest.config.js` maps it to a mock —
so that file can be wrong in every way and the suite stays green. Read it by eye
whenever it changes.
