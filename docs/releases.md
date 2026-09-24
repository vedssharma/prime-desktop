# Release support

## Supported targets and limitations

- macOS Apple Silicon: locally tested. Output `release/mac-arm64/Session Dock.app`.
- macOS Intel: build on Intel with `npm run package`; output `release/mac/Session Dock.app`.
  This project does not claim Intel runtime validation until its native tests pass there.
- Linux x64: CI build/native smoke target; review the latest CI results before distributing.
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
GitHub release. macOS Gatekeeper may block unsigned downloads; do not describe
these as signed or notarized. Never advise users to disable security globally.

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

## Manual release workflow

The `Release artifacts` workflow runs only on explicit dispatch. It tests, builds,
checks notices, runs a fake-daemon packaged smoke test, and uploads artifacts for
review. Signed jobs require protected environment secrets; unsigned jobs are labeled
as such. It intentionally does not create a public release automatically.
