# Release support

## Supported targets and limitations

- macOS Apple Silicon: locally tested. Output `release/mac-arm64/Session Dock.app`.
- macOS Intel: build on Intel with `npm run package`; output `release/mac/Session Dock.app`.
  This project does not claim Intel runtime validation until its native tests pass there.
- Linux x64: `.deb` (Ubuntu/Debian, with an AppArmor profile for Ubuntu 24.04) and AppImage.
  CI builds and smoke-tests the unpacked app; the `.deb` was also installed and smoke-tested
  on Ubuntu 24.04.
- Windows: **unsupported**. No installer target is offered until named-pipe transport and
  native tests are implemented.

Prime Agent must be installed separately. The current daemon adapter is read-only
for session changes; release signing does not remove this safety limitation.

## Local package and validation

```sh
npm ci
npx playwright install chromium
npm run package
npm run package:check
npm run test:electron
```

The pinned lockfile, `.nvmrc`, notice regeneration, full tests and package checks
make builds repeatable. They are not a promise of byte-identical archives: signing,
notarization, filesystem metadata and packaging timestamps can differ.

## Unsigned test distribution

Start from a clean checkout with no prior `release/` output:

```sh
npm run release:unsigned
```

This creates installers/archives and `release/SHA256SUMS`. It does not publish a
GitHub release. Unsigned macOS builds are ad-hoc signed with hardened runtime off, so
Gatekeeper offers **Open Anyway** (System Settings → Privacy & Security) on first launch
instead of reporting the app as damaged. Do not describe these as signed or notarized,
and never advise users to disable security globally.

## Signed and notarized macOS distribution

Provide these as private environment variables or protected GitHub environment secrets:

- `CSC_LINK`: Developer ID Application certificate (.p12, path or supported encoded value)
- `CSC_KEY_PASSWORD`: certificate password
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: notarization credentials

```sh
npm run release:signed
```

The script refuses to continue if any credential is missing, and requires code
signing instead of silently falling back. Electron Builder signs with hardened
runtime and notarizes using the Apple credentials. Protect the `release` GitHub
environment with approvals. Never put credentials in the repository or logs.

**Signing/notarization have not been validated locally:** no signing identity was
provided. Verify each resulting app with `codesign --verify --deep --strict` and
`spctl --assess --type execute`, then smoke-test the actual packaged app before
publishing. CI requires these checks for signed jobs. Do not publish an artifact
that fails them.

## Publishing a release

1. Set the new version in `package.json` (`npm version 0.2.0 --no-git-tag-version`), get
   that change merged to `main`, and make sure CI is green.
2. Tag the merged commit and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
   A tag with a pre-release suffix (`v0.2.0-beta.1`) creates a pre-release.
3. The `Release artifacts` workflow checks that the tag matches `package.json`, builds and
   tests the macOS and Linux installers, and creates a **draft** GitHub release with every
   installer, a combined `SHA256SUMS`, install notes from `docs/release-notes.md` and
   generated change notes.
4. Review the draft on GitHub (download and open at least one installer), then click
   **Publish release**. Users get it from the Releases page and the README's Install section.

To redo a release before publishing, delete the draft and the tag
(`git push --delete origin v0.2.0`), fix, and tag again.

## Manual release workflow

Running the `Release artifacts` workflow by hand (workflow dispatch) tests, builds,
checks notices, runs a fake-daemon packaged smoke test, and uploads artifacts for
review without creating a release. Signed jobs require protected environment secrets;
unsigned jobs are labeled as such.

## Required signed-artifact verification

`release:signed` now checks the packaged app before generating checksums. It requires
`codesign --verify --deep --strict`, a Developer ID Application identity with a team
and hardened runtime, Gatekeeper execution assessment, and `xcrun stapler validate`.
A failure prevents success reporting and checksum generation. The workflow repeats
verification after the packaged smoke test and uploads `SIGNING_VERIFICATION.json`
with the artifacts. This report records successful checks, not credential values.

The verifier locates the single built macOS app without assuming host architecture.
Policy and failure-path tests run on Linux with injected command results; they do
not establish actual Apple signing or notarization. That final validation requires
a macOS runner and the protected credentials listed above.
